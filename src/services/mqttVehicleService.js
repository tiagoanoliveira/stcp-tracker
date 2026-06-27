/**
 * MQTT Vehicle Service
 *
 * Substitui o polling HTTP do stcp.live por uma ligação event-driven via
 * MQTT sobre WebSocket ao broker do Porto Digital:
 *   wss://mmt.portodigital.pt/websocket/
 *
 * O tópico "/gtfsrt/vp/#" entrega todas as posições de veículos.
 * As mensagens chegam em protobuf no formato GTFS-RT.
 *
 * Depois de ligar, passa o client e o protoRoot ao mqttTripUpdateService
 * para que este adicione uma segunda subscrição (/gtfsrt/tu/#) à mesma
 * ligação WebSocket, evitando uma segunda ligação ao broker.
 *
 * ─── FORMATO DO TÓPICO (Porto Digital) ─────────────────────────────────────
 *
 *   /gtfsrt/vp/{feedId}/{agencyId}/{mode}/{routeId}/{directionId}/{headsign}/{tripDescriptor}//{hora}/{vehicleNumber}/{coords}/{bearing}/{?}/{speed_raw}/{routeId2}/{plate}/
 *
 *   Exemplo real:
 *   /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
 *
 *   Mapa de índices (split por '/', 0-based, tópico começa por '/'):
 *   idx  9 = "Cordoaria"   (headsign / destino)
 *   idx 13 = "3261"        (número do veículo = ID único)
 *   idx 17 = "70"          (velocidade RAW — ver nota abaixo)
 *   idx 19 = "FCD116"      (matrícula)
 *
 * ─── VELOCIDADE ─────────────────────────────────────────────────────────────
 *
 *   O campo idx 17 do tópico não está em km/h nem em m/s de forma consistente.
 *   O broker Porto Digital publica os valores do GTFS-RT pos.speed que está
 *   definido pela especificação como m/s (float).
 *   Conversão: speed_kmh = round(speed_raw * 3.6)
 *   Cap de segurança: 90 km/h máximo (velocidade máxima legal de autocarro urbano
 *   em Portugal é 50-90 km/h; valores acima indicam erro de telemetria).
 *
 * ─── NO-DATA TIMEOUT ────────────────────────────────────────────────────────
 *
 *   Se passarem NO_DATA_TIMEOUT_MS (15s) após conectar sem nenhum veículo
 *   ser processado com sucesso, emite 'mqtt:noDataTimeout' no eventBus.
 *   O UI deve mostrar um banner informando o utilizador que os dados de
 *   tempo real não estão disponíveis (falha no serviço externo).
 *   O banner desaparece ao receber o primeiro veículo ('mqtt:vehicleUpdate').
 *
 * ─── DEDUPLICAÇÃO ───────────────────────────────────────────────────────────
 *
 *   O campo id usa o número do veículo do tópico (idx 13), que coincide com
 *   o ID de entidade FIWARE (legado). Garante que marcadores são actualizados
 *   em vez de duplicados.
 *
 * ─── TTL ─────────────────────────────────────────────────────────────────────
 *
 *   Cada veículo recebe um timestamp ao ser recebido.
 *   A cada 5 s: veículos sem update há mais de 30 s são removidos.
 *
 * ─── DEBUG ───────────────────────────────────────────────────────────────────
 *
 *   localStorage.setItem('MQTT_DEBUG', '1')  → activar logs
 *   localStorage.removeItem('MQTT_DEBUG')    → desactivar
 *
 *   Logs: [MQTT RAW] [MQTT PROTO] [MQTT PROTO→RAW] [MQTT VEHICLE]
 *         [MQTT SKIP] [MQTT STATS] [MQTT TTL] [MQTT SPEED]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus }              from '../core/eventBus.js';
import { vehicleService }        from './vehicleService.js';
import { mqttTripUpdateService } from './mqttTripUpdateService.js';

// ─── Constantes ──────────────────────────────────────────────────────────────
const BROKER_URL          = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC               = '/gtfsrt/vp/#';
const PROTO_PATH          = './resources/gtfs-realtime.proto';
const VEHICLE_TTL         = 30_000; // ms
const TTL_CHECK_MS        = 5_000;  // ms
const NO_DATA_TIMEOUT_MS  = 15_000; // ms antes de emitir noDataTimeout

// Índices dos segmentos do tópico
const TIDX_HEADSIGN    = 9;
const TIDX_VEHICLE_NUM = 13;
const TIDX_SPEED       = 17;  // valor raw em m/s (spec GTFS-RT)
const TIDX_PLATE       = 19;

// ─── Estado interno ───────────────────────────────────────────────────────────
let _client           = null;
let _protoRoot        = null;
let _vehicles         = {};
let _vehicleTimestamp = {};
let _isConnected      = false;
let _isStarted        = false;
let _ttlInterval      = null;
let _noDataTimer      = null;
let _hasReceivedData  = false;
let _onVehicleExpired = null;

// ─── Debug ────────────────────────────────────────────────────────────────────
const _debug = () => {
  try { return localStorage.getItem('MQTT_DEBUG') === '1'; } catch { return false; }
};

let _stats = { received: 0, decoded: 0, processed: 0, skipped: 0 };
let _statsInterval = null;

function _startStats() {
  if (_statsInterval) return;
  _statsInterval = setInterval(() => {
    if (!_debug()) return;
    const total = Object.keys(_vehicles).length;
    console.groupCollapsed(
      `%c[MQTT STATS] ⏱ últimos 10s: ${_stats.received} recebidas | ` +
      `${_stats.decoded} descodificadas | ${_stats.processed} aceites | ` +
      `${_stats.skipped} descartadas | ${total} veículos em memória`,
      'color:#0c4e54;font-weight:bold'
    );
    console.table({ ..._stats, veiculos_em_memoria: total });
    console.groupEnd();
    _stats = { received: 0, decoded: 0, processed: 0, skipped: 0 };
  }, 10_000);
}

function _stopStats() {
  if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
}

// ─── No-data timeout ─────────────────────────────────────────────────────────

function _startNoDataTimer() {
  _clearNoDataTimer();
  _noDataTimer = setTimeout(() => {
    if (!_hasReceivedData) {
      console.warn(
        '%c[MQTT] ⚠ Timeout de 15s sem dados de veículos — broker não está a enviar dados',
        'color:#964219;font-weight:bold'
      );
      eventBus.emit('mqtt:noDataTimeout');
    }
  }, NO_DATA_TIMEOUT_MS);
}

function _clearNoDataTimer() {
  if (_noDataTimer) { clearTimeout(_noDataTimer); _noDataTimer = null; }
}

// ─── TTL ──────────────────────────────────────────────────────────────────────

function _startTtlCheck() {
  if (_ttlInterval) return;
  _ttlInterval = setInterval(() => {
    const now     = Date.now();
    const expired = Object.keys(_vehicleTimestamp).filter(
      id => now - _vehicleTimestamp[id] > VEHICLE_TTL
    );
    for (const id of expired) {
      if (_debug()) {
        console.log(
          `%c[MQTT TTL] 🗑 veículo ${id} removido (sem update há ` +
          `${Math.round((now - _vehicleTimestamp[id]) / 1000)}s)`,
          'color:#964219'
        );
      }
      delete _vehicles[id];
      delete _vehicleTimestamp[id];
      _onVehicleExpired?.(id);
      eventBus.emit('mqtt:vehicleExpired', id);
    }
  }, TTL_CHECK_MS);
}

function _stopTtlCheck() {
  if (_ttlInterval) { clearInterval(_ttlInterval); _ttlInterval = null; }
}

// ─── Carregamento dinâmico ───────────────────────────────────────────────────

async function loadMqttLib() {
  if (window.mqtt) return window.mqtt;
  await _loadScript('https://unpkg.com/mqtt/dist/mqtt.min.js');
  if (!window.mqtt) throw new Error('mqtt.js não foi carregado corretamente');
  return window.mqtt;
}

async function loadProtobufLib() {
  if (window.protobuf) return window.protobuf;
  await _loadScript('https://cdn.jsdelivr.net/npm/protobufjs@7/dist/protobuf.min.js');
  if (!window.protobuf) throw new Error('protobufjs não foi carregado corretamente');
  return window.protobuf;
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Falha ao carregar script: ${src}`));
    document.head.appendChild(s);
  });
}

async function loadProtoSchema() {
  if (_protoRoot) return _protoRoot;
  const protobuf = await loadProtobufLib();
  const response = await fetch(PROTO_PATH);
  if (!response.ok) throw new Error(`Não foi possível carregar ${PROTO_PATH}`);
  const protoText = await response.text();
  _protoRoot = protobuf.parse(protoText, { keepCase: true }).root;
  return _protoRoot;
}

// ─── Parsing do tópico MQTT ──────────────────────────────────────────────────

function _parseTopicMeta(topic) {
  const parts = topic.split('/');

  const seg = (idx) => {
    const s = parts[idx];
    return (s && s.trim() !== '') ? decodeURIComponent(s.trim()) : null;
  };

  const headsign      = seg(TIDX_HEADSIGN);
  const vehicleNumber = seg(TIDX_VEHICLE_NUM);
  const plate         = seg(TIDX_PLATE);

  // idx 17: valor raw em m/s conforme especificação GTFS-RT pos.speed
  // Conversão: km/h = m/s × 3.6, cap 90 km/h
  const speedRaw = seg(TIDX_SPEED);
  let speed = null;
  if (speedRaw && !isNaN(Number(speedRaw))) {
    const ms = Number(speedRaw);
    // Detectar se o valor já foi convertido incorrectamente para km/h:
    // valores > 30 m/s (~108 km/h) são improváveis num autocarro urbano,
    // mas o broker pode já ter enviado em km/h em alguns feeds.
    // Heurística: se ms < 35, assumir m/s e converter; caso contrário, já é km/h.
    const kmh = ms < 35 ? Math.round(ms * 3.6) : Math.round(ms);
    speed = Math.min(kmh, 90); // cap de segurança
    if (_debug() && ms >= 35) {
      console.log(`%c[MQTT SPEED] idx17=${ms} → assumido km/h directo → cap ${speed}`, 'color:#888');
    }
  }

  return { headsign, vehicleNumber, speed, plate };
}

// ─── Descodificação de mensagens ─────────────────────────────────────────────

function decodeGtfsRtMessage(payload, topic) {
  _stats.received++;

  const meta = _parseTopicMeta(topic);

  if (_debug()) {
    console.log(
      `%c[MQTT RAW] tópico: ${topic} | bytes: ${payload.byteLength}`,
      'color:#888'
    );
    console.log('%c[MQTT RAW] metadados do tópico:', 'color:#888', meta);
  }

  try {
    const FeedMessage = _protoRoot.lookupType('transit_realtime.FeedMessage');
    const feed = FeedMessage.decode(payload);

    if (_debug() && (feed.entity || []).length === 0) {
      console.warn('%c[MQTT SKIP] feed sem entidades', 'color:#b07a00', { topic });
      _stats.skipped++;
      return null;
    }

    for (const entity of (feed.entity || [])) {
      const vp = entity.vehicle;

      if (!vp) {
        _stats.skipped++;
        continue;
      }

      const pos  = vp.position;
      const trip = vp.trip;

      const vehicleId = meta.vehicleNumber || vp.vehicle?.id || entity.id;

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
        _stats.skipped++;
        continue;
      }

      _stats.decoded++;

      const raw = {
        id:          String(vehicleId),
        busNumber:   String(vehicleId),
        plate:       meta.plate,
        lat:         pos.latitude,
        lng:         pos.longitude,
        destination: meta.headsign,
        speed:       meta.speed,
        routeId:     trip?.route_id                                        || null,
        directionId: trip?.direction_id != null ? Number(trip.direction_id) : null,
        tripId:      trip?.trip_id                                         || null,
      };

      if (_debug()) {
        console.log(
          `%c[MQTT PROTO→RAW] id:${raw.id} linha:${raw.routeId} dir:${raw.directionId} ` +
          `speed:${raw.speed}km/h destino:"${raw.destination}" mat:${raw.plate} trip:${raw.tripId}`,
          'color:#006494',
          raw
        );
      }

      return raw;
    }
    return null;
  } catch (err) {
    _stats.skipped++;
    if (_debug()) {
      console.error('%c[MQTT SKIP] erro ao descodificar protobuf', 'color:#a12c7b', err);
    }
    return null;
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export const mqttVehicleService = {

  async start({ onVehicleUpdate, onVehicleExpired, onConnected, onDisconnected } = {}) {
    if (_isStarted) {
      console.warn('⚠ MQTT já iniciado');
      return;
    }
    _isStarted = true;
    _hasReceivedData  = false;
    _onVehicleExpired = onVehicleExpired || null;

    console.info(
      '%c[MQTT] Para activar logs detalhados: localStorage.setItem(\'MQTT_DEBUG\', \'1\') e recarrega a página',
      'color:#01696f;font-style:italic'
    );

    try {
      await Promise.all([loadMqttLib(), loadProtoSchema()]);

      _client = window.mqtt.connect(BROKER_URL, {
        clean:           true,
        reconnectPeriod: 3000,
        connectTimeout:  8000,
      });

      _client.on('connect', () => {
        _isConnected = true;
        console.info('✅ MQTT ligado ao Porto Digital broker');

        _client.subscribe(TOPIC, { qos: 0 }, (err) => {
          if (err) console.error('❌ Erro ao subscrever tópico MQTT:', err);
          else     console.info(`📡 Subscrito ao tópico: ${TOPIC}`);
        });

        // Activar TripUpdate na mesma ligação WebSocket
        mqttTripUpdateService.attach(_client, _protoRoot);

        // Iniciar timer de no-data
        _startNoDataTimer();

        _startStats();
        _startTtlCheck();
        eventBus.emit('mqtt:connected');
        onConnected?.();
      });

      _client.on('reconnect', () => {
        console.info('🔄 MQTT a reconectar…');
        eventBus.emit('mqtt:reconnecting');
      });

      _client.on('disconnect', () => {
        _isConnected = false;
        _stopStats();
        _clearNoDataTimer();
        eventBus.emit('mqtt:disconnected');
        onDisconnected?.();
      });

      _client.on('error', (err) => {
        console.error('❌ Erro MQTT:', err);
        eventBus.emit('mqtt:error', err);
      });

      _client.on('message', (topic, payload) => {
        // Mensagens /tu são tratadas exclusivamente pelo mqttTripUpdateService
        if (topic.startsWith('/gtfsrt/tu/')) return;

        const raw = decodeGtfsRtMessage(payload, topic);
        if (!raw) return;

        const vehicle = vehicleService.processBusData(raw);

        if (!vehicle) {
          _stats.skipped++;
          if (_debug()) {
            console.warn(
              '%c[MQTT SKIP] processBusData devolveu null',
              'color:#b07a00',
              raw
            );
          }
          return;
        }

        // Primeiro veículo com sucesso — cancelar timeout e limpar banner
        if (!_hasReceivedData) {
          _hasReceivedData = true;
          _clearNoDataTimer();
          eventBus.emit('mqtt:dataRestored');
        }

        _stats.processed++;
        _vehicles[vehicle.id]         = vehicle;
        _vehicleTimestamp[vehicle.id] = Date.now();

        if (_debug()) {
          console.log(
            `%c[MQTT VEHICLE] ✔ id:${vehicle.id} linha:${vehicle.displayLine} ` +
            `dir:${vehicle.direction} lat:${vehicle.latitude?.toFixed(5)} ` +
            `lng:${vehicle.longitude?.toFixed(5)} speed:${vehicle.speed}km/h ` +
            `destino:"${vehicle.destination}" trip:${vehicle.tripId}`,
            'color:#437a22',
            vehicle
          );
        }

        onVehicleUpdate?.(vehicle);
        eventBus.emit('mqtt:vehicleUpdate', vehicle);
      });

    } catch (err) {
      _isStarted = false;
      console.error('❌ Falha ao iniciar MQTT:', err);
      eventBus.emit('mqtt:error', err);
      throw err;
    }
  },

  stop() {
    if (_client) {
      _client.end(true);
      _client = null;
    }
    _isConnected      = false;
    _isStarted        = false;
    _hasReceivedData  = false;
    _vehicles         = {};
    _vehicleTimestamp = {};
    _onVehicleExpired = null;
    _clearNoDataTimer();
    _stopStats();
    _stopTtlCheck();
    mqttTripUpdateService.detach();
    eventBus.emit('mqtt:stopped');
  },

  removeVehicle(vehicleId) {
    delete _vehicles[vehicleId];
    delete _vehicleTimestamp[vehicleId];
  },

  /**
   * Devolve o veículo em memória por tripId.
   * Usado pelo UI ao abrir uma paragem para localizar os autocarros
   * que irão passar, a partir dos tripIds das chegadas previstas.
   * @param {string} tripId
   * @returns {object|null}
   */
  getVehicleByTripId(tripId) {
    if (!tripId) return null;
    return Object.values(_vehicles).find(v => v.tripId === tripId) || null;
  },

  /**
   * Devolve todos os veículos em memória cujo tripId está na lista fornecida.
   * @param {string[]} tripIds
   * @returns {object[]}
   */
  getVehiclesByTripIds(tripIds) {
    if (!tripIds?.length) return [];
    const set = new Set(tripIds);
    return Object.values(_vehicles).filter(v => v.tripId && set.has(v.tripId));
  },

  getAllVehicles() { return Object.values(_vehicles); },
  isConnected()   { return _isConnected; },
  isStarted()     { return _isStarted;   },
  hasData()       { return _hasReceivedData; },
};
