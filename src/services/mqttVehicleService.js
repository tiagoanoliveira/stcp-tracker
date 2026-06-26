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
 * ─── FORMATO DO TÓPICO (Porto Digital) ──────────────────────────────────────
 *
 *   /gtfsrt/vp/{feedId}/{agencyId}/{mode}/{routeId}/{directionId}/{headsign}/{tripDescriptor}//{hora}/{vehicleNumber}/{coords}/{bearing}/{?}/{speed_kmh}/{routeId2}/{plate}/
 *
 *   Exemplo real:
 *   /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
 *
 *   Mapa de índices (split por '/', 0-based, tópico começa por '/'):
 *   idx  0 = ""            (antes do primeiro /)
 *   idx  1 = "gtfsrt"
 *   idx  2 = "vp"
 *   idx  3 = "2"           (feedId)
 *   idx  4 = ""            (agencyId vazio)
 *   idx  5 = ""            (modo antigo vazio)
 *   idx  6 = "BUS"         (modo)
 *   idx  7 = "507"         (routeId / linha)
 *   idx  8 = "1"           (directionId: 0 ou 1)  ← NÃO é o destino!
 *   idx  9 = "Cordoaria"   (headsign / destino)   ← DESTINO
 *   idx 10 = "507_0_2|..." (trip descriptor)
 *   idx 11 = ""            (campo vazio)
 *   idx 12 = "11:18"       (hora de partida)
 *   idx 13 = "3261"        (número do veículo = ID único)  ← ID + busNumber
 *   idx 14 = "41;-8"       (coordenadas lat;lng no tópico)
 *   idx 15 = "16"          (bearing em graus)
 *   idx 16 = "42"          (campo desconhecido)
 *   idx 17 = "70"          (velocidade em km/h no tópico)   ← SPEED
 *   idx 18 = "507"         (routeId repetido)
 *   idx 19 = "FCD116"      (matrícula)                       ← PLATE
 *
 * ─── FONTES DOS CAMPOS ───────────────────────────────────────────────────────
 *
 *   campo id / busNumber : idx 13 do tópico ("3261")
 *     O mesmo número que o FIWARE usa como ID de entidade — garante
 *     deduplicar correctamente quando o MQTT substitui o bootstrap FIWARE.
 *
 *   destination (destino): idx 9 do tópico ("Cordoaria")
 *     O protobuf Porto Digital não preenche trip.headsign; o tópico é a
 *     única fonte fidedigna. Não usar idx 8 (direction_id).
 *
 *   speed (km/h)         : idx 17 do tópico ("70")
 *     A velocidade vem directamente em km/h no tópico.
 *     pos.speed do protobuf pode estar a 0 ou ausente neste broker.
 *
 *   plate (matrícula)    : idx 19 do tópico ("FCD116")
 *     Campo apenas visual — não usado para identificação.
 *
 *   routeId, directionId,
 *   tripId, lat, lng     : protobuf GTFS-RT (fonte canonica para estes campos)
 *
 * ─── DEDUPLICAÇÃO ────────────────────────────────────────────────────────────
 *
 *   O campo id usa o número do veículo do tópico (idx 13), que coincide com
 *   o ID de entidade FIWARE. Assim, quando o MQTT actualiza um veículo já
 *   criado pelo bootstrap FIWARE, o BusMarkerManager move o marcador existente
 *   em vez de criar um duplicado.
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
 *         [MQTT SKIP] [MQTT STATS] [MQTT TTL]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus }              from '../core/eventBus.js';
import { vehicleService }        from './vehicleService.js';
import { mqttTripUpdateService } from './mqttTripUpdateService.js';

// ─── Constantes ────────────────────────────────────────────────────────────
const BROKER_URL   = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC        = '/gtfsrt/vp/#';
const PROTO_PATH   = './resources/gtfs-realtime.proto';
const VEHICLE_TTL  = 30_000; // ms
const TTL_CHECK_MS = 5_000;  // ms

// Índices dos segmentos do tópico (split por '/', 0-based)
// Tópico: /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|...//11:18/3261/41;-8/16/42/70/507/FCD116/
const TIDX_HEADSIGN    = 9;   // "Cordoaria" — destino
const TIDX_VEHICLE_NUM = 13;  // "3261" — número/ID do veículo
const TIDX_SPEED       = 17;  // "70" — velocidade em km/h
const TIDX_PLATE       = 19;  // "FCD116" — matrícula

// ─── Estado interno ─────────────────────────────────────────────────────────
let _client           = null;
let _protoRoot        = null;
let _vehicles         = {};
let _vehicleTimestamp = {};
let _isConnected      = false;
let _isStarted        = false;
let _ttlInterval      = null;
let _onVehicleExpired = null;

// ─── Debug ───────────────────────────────────────────────────────────────────
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

// ─── TTL ───────────────────────────────────────────────────────────────────

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

// ─── Carregamento dinâmico ──────────────────────────────────────────────────────

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

// ─── Parsing do tópico MQTT ────────────────────────────────────────────────────

/**
 * Extrai todos os metadados relevantes do tópico MQTT.
 *
 * Tópico: /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
 * Índices (0-based após split por '/'):
 *   9  → headsign (destino)    ex: "Cordoaria"
 *   13 → vehicleNumber (ID)    ex: "3261"
 *   17 → speed em km/h         ex: "70"
 *   19 → plate (matrícula)     ex: "FCD116"
 *
 * @returns {{ vehicleNumber, headsign, speed, plate }}
 */
function _parseTopicMeta(topic) {
  const parts = topic.split('/');

  const seg = (idx) => {
    const s = parts[idx];
    return (s && s.trim() !== '') ? decodeURIComponent(s.trim()) : null;
  };

  const headsign      = seg(TIDX_HEADSIGN);    // idx 9 → "Cordoaria"
  const vehicleNumber = seg(TIDX_VEHICLE_NUM); // idx 13 → "3261"
  const plate         = seg(TIDX_PLATE);       // idx 19 → "FCD116"

  // Velocidade: idx 17 já em km/h
  const speedRaw = seg(TIDX_SPEED);
  const speed    = (speedRaw && !isNaN(Number(speedRaw))) ? Number(speedRaw) : null;

  return { headsign, vehicleNumber, speed, plate };
}

// ─── Descodificação de mensagens ─────────────────────────────────────────────

/**
 * Descodifica um payload protobuf GTFS-RT e devolve o objecto raw normalizado.
 *
 * FONTES DE CADA CAMPO (pós-correcção):
 *   id / busNumber  → idx 13 do tópico ("3261") — coincide com ID FIWARE
 *   destination     → idx 9 do tópico ("Cordoaria")
 *   speed (km/h)    → idx 17 do tópico (já em km/h)
 *   plate           → idx 19 do tópico ("FCD116") — apenas visual
 *   routeId         → protobuf trip.route_id
 *   directionId     → protobuf trip.direction_id
 *   tripId          → protobuf trip.trip_id
 *   lat / lng       → protobuf pos.latitude / pos.longitude
 */
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
        if (_debug()) {
          console.warn('%c[MQTT SKIP] entidade sem VehiclePosition', 'color:#b07a00', { entity_id: entity.id });
        }
        _stats.skipped++;
        continue;
      }

      const pos  = vp.position;
      const trip = vp.trip;

      // ID: usar o número do veículo do tópico (idx 13, ex: "3261").
      // Este número coincide com o ID de entidade FIWARE e permite deduplicar
      // correctamente quando o MQTT substitui o bootstrap FIWARE.
      // Fallback para vp.vehicle.id ou entity.id se o tópico não tiver o campo.
      const vehicleId = meta.vehicleNumber
        || vp.vehicle?.id
        || entity.id;

      if (_debug()) {
        console.groupCollapsed(
          `%c[MQTT PROTO] veículo ${vehicleId} | rota ${trip?.route_id ?? '?'} | ` +
          `lat ${pos?.latitude?.toFixed(5)} lng ${pos?.longitude?.toFixed(5)}`,
          'color:#006494'
        );
        console.log('VehiclePosition completo:', JSON.parse(JSON.stringify(vp)));
        console.groupEnd();
      }

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
        if (_debug()) {
          console.warn('%c[MQTT SKIP] posição inválida ou em falta', 'color:#b07a00', { vehicleId, pos });
        }
        _stats.skipped++;
        continue;
      }

      _stats.decoded++;

      const raw = {
        // Identificação — número do veículo do tópico (mesmo que FIWARE)
        id:          String(vehicleId),
        busNumber:   String(vehicleId),   // campo visual no popup
        plate:       meta.plate,           // matrícula (ex: "FCD116") — só visual

        // Localização — do protobuf
        lat:         pos.latitude,
        lng:         pos.longitude,

        // Destino — idx 9 do tópico
        // O broker Porto Digital não preenche trip.headsign no protobuf;
        // o tópico é a única fonte fidedigna.
        destination: meta.headsign,

        // Velocidade — idx 17 do tópico (já em km/h)
        speed:       meta.speed,

        // Metadados da viagem — do protobuf
        routeId:     trip?.route_id                                        || null,
        directionId: trip?.direction_id != null ? Number(trip.direction_id) : null,
        tripId:      trip?.trip_id                                         || null,
      };

      if (_debug()) {
        console.log(
          `%c[MQTT PROTO→RAW] id:${raw.id} linha:${raw.routeId} dir:${raw.directionId} ` +
          `speed:${raw.speed}km/h destino:"${raw.destination}" mat:${raw.plate}`,
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

// ─── API pública ─────────────────────────────────────────────────────────────

export const mqttVehicleService = {

  async start({ onVehicleUpdate, onVehicleExpired, onConnected, onDisconnected } = {}) {
    if (_isStarted) {
      console.warn('⚠ MQTT já iniciado');
      return;
    }
    _isStarted = true;
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
              '%c[MQTT SKIP] processBusData devolveu null — routeId ou direction em falta?',
              'color:#b07a00',
              raw
            );
          }
          return;
        }

        _stats.processed++;
        _vehicles[vehicle.id]         = vehicle;
        _vehicleTimestamp[vehicle.id] = Date.now();

        if (_debug()) {
          console.log(
            `%c[MQTT VEHICLE] ✔ id:${vehicle.id} linha:${vehicle.displayLine} ` +
            `dir:${vehicle.direction} lat:${vehicle.latitude?.toFixed(5)} ` +
            `lng:${vehicle.longitude?.toFixed(5)} speed:${vehicle.speed}km/h ` +
            `destino:"${vehicle.destination}" mat:${vehicle.busNumber}`,
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
    _vehicles         = {};
    _vehicleTimestamp = {};
    _onVehicleExpired = null;
    _stopStats();
    _stopTtlCheck();
    mqttTripUpdateService.detach();
    eventBus.emit('mqtt:stopped');
  },

  removeVehicle(vehicleId) {
    delete _vehicles[vehicleId];
    delete _vehicleTimestamp[vehicleId];
  },

  getAllVehicles() { return Object.values(_vehicles); },
  isConnected()   { return _isConnected; },
  isStarted()     { return _isStarted;   },
};
