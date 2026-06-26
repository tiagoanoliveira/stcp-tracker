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
 * Formato do tópico MQTT (Porto Digital):
 *   /gtfsrt/vp/{feed}/{agência}/{modo}/{linha}/{dir}/{destino}/{viagem}/{...}/{hora}/{id}/{coords}/{...}/{velocidade}/{...}/{matrícula}/
 *   ex: /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
 *   O destino está no índice 7 (0-based) do split por '/'
 *   A velocidade (km/h) está no índice 19
 *   O busNumber (matrícula) está no índice 20
 *
 * TTL dos veículos:
 *   Cada veículo recebe um timestamp ao ser recebido.
 *   A cada 5 s é feita uma limpeza: veículos com mais de 30 s sem actualização
 *   são removidos do snapshot e o callback onVehicleExpired é chamado.
 *
 * Fluxo:
 *   1. Snapshot inicial via FIWARE REST (mapa não começa vazio)
 *   2. Ligação MQTT — cada mensagem atualiza o veículo correspondente no mapa
 *   3. Em caso de desconexão, tenta reconnect automático (mqtt.js faz isso)
 *
 * Dependências externas (CDN, sem build step):
 *   - mqtt.js  : https://unpkg.com/mqtt/dist/mqtt.min.js
 *   - protobufjs: https://cdn.jsdelivr.net/npm/protobufjs@7/dist/protobuf.min.js
 *
 * NOTA SOBRE PROTOBUF:
 *   O ficheiro .proto do GTFS-RT é carregado a partir de
 *   ./resources/gtfs-realtime.proto (deve existir no repo).
 *
 * ─── DEBUG ───────────────────────────────────────────────────────────────────
 * Activar logs detalhados na consola:
 *   localStorage.setItem('MQTT_DEBUG', '1')  → depois recarregar
 * Desactivar:
 *   localStorage.removeItem('MQTT_DEBUG')    → depois recarregar
 *
 * Logs emitidos:
 *   [MQTT RAW]       payload em bytes, tópico recebido
 *   [MQTT PROTO]     objecto descodificado do protobuf (antes de processBusData)
 *   [MQTT VEHICLE]   objecto final após processBusData (o que vai para o mapa)
 *   [MQTT SKIP]      payload descartado e motivo (proto inválido, coords em falta, etc.)
 *   [MQTT STATS]     contagem de mensagens a cada 10 s
 *   [MQTT TTL]       veículo removido por expiração de 30 s
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus } from '../core/eventBus.js';
import { vehicleService } from './vehicleService.js';

// ─── Constantes ────────────────────────────────────────────────────────────
const BROKER_URL    = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC         = '/gtfsrt/vp/#';
const PROTO_PATH    = './resources/gtfs-realtime.proto';
const VEHICLE_TTL   = 30_000; // ms — veículo removido se não houver update em 30 s
const TTL_CHECK_MS  = 5_000;  // ms — frequência da limpeza de TTL

// Índices dos segmentos do tópico (split por '/')
// ex: /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
// idx: 0  1      2  3 4 5   6  7 8        9                     10    11   12     13 14 15 16 17  18    19  20
const TOPIC_IDX_HEADSIGN   = 8;  // destino ("Cordoaria")
const TOPIC_IDX_SPEED      = 19; // velocidade em km/h
const TOPIC_IDX_BUS_NUMBER = 20; // matrícula ("FCD116")

// ─── Estado interno ─────────────────────────────────────────────────────────
let _client           = null;   // instância mqtt.js
let _protoRoot        = null;   // protobufjs root carregado
let _vehicles         = {};     // { vehicleId → veículo normalizado }
let _vehicleTimestamp = {};     // { vehicleId → Date.now() do último update }
let _isConnected      = false;
let _isStarted        = false;
let _ttlInterval      = null;
let _onVehicleExpired = null;   // callback(vehicleId)

// ─── Debug ───────────────────────────────────────────────────────────────────
const _debug = () => localStorage.getItem('MQTT_DEBUG') === '1';

// Contadores para estatísticas periódicas
let _stats = { received: 0, decoded: 0, processed: 0, skipped: 0 };
let _statsInterval = null;

function _startStats() {
  if (_statsInterval) return;
  _statsInterval = setInterval(() => {
    if (!_debug()) return;
    const total = Object.keys(_vehicles).length;
    console.groupCollapsed(
      `%c[MQTT STATS] ⏱ últimos 10s: ${_stats.received} msgs recebidas | ${_stats.decoded} descodificadas | ${_stats.processed} aceites | ${_stats.skipped} descartadas | ${total} veículos em memória`,
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

// ─── TTL — limpeza de veículos expirados ─────────────────────────────────────

function _startTtlCheck() {
  if (_ttlInterval) return;
  _ttlInterval = setInterval(() => {
    const now     = Date.now();
    const expired = Object.keys(_vehicleTimestamp).filter(id => now - _vehicleTimestamp[id] > VEHICLE_TTL);
    for (const id of expired) {
      if (_debug()) {
        console.log(`%c[MQTT TTL] 🗑 veículo ${id} removido (sem update há ${Math.round((now - _vehicleTimestamp[id]) / 1000)}s)`, 'color:#964219');
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

// ─── Auxiliares de carregamento dinâmico ─────────────────────────────────────

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

// ─── Extracção de metadados do tópico ────────────────────────────────────────

/**
 * Extrai o destino, velocidade e número de veículo directamente do tópico MQTT.
 * O tópico tem o formato:
 *   /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|...|//11:18/3261/41;-8/16/42/70/507/FCD116/
 * O headsign (destino) está no índice 8, a velocidade no 19, a matrícula no 20.
 * A velocidade no tópico já está em km/h — NÃO converter.
 */
function _parseTopicMeta(topic) {
  const parts = topic.split('/');
  const headsign  = parts[TOPIC_IDX_HEADSIGN]  || null;
  const speedRaw  = parts[TOPIC_IDX_SPEED]     || null;
  const busNumber = parts[TOPIC_IDX_BUS_NUMBER] || null;
  const speed     = speedRaw && !isNaN(Number(speedRaw)) ? Number(speedRaw) : null;
  return {
    headsign:  headsign  && headsign  !== '' ? decodeURIComponent(headsign)  : null,
    speed,       // já em km/h
    busNumber: busNumber && busNumber !== '' ? busNumber : null,
  };
}

// ─── Descodificação de mensagens ─────────────────────────────────────────────

/**
 * Descodifica um payload protobuf GTFS-RT e devolve o objecto raw normalizado.
 * A velocidade é lida directamente do tópico (km/h) para evitar erros de
 * conversão — o protobuf codifica speed em m/s, mas o broker Porto Digital
 * envia-a já em km/h no texto do tópico, que é a fonte fidedigna.
 */
function decodeGtfsRtMessage(payload, topic) {
  _stats.received++;

  if (_debug()) {
    console.log(
      `%c[MQTT RAW] tópico: ${topic} | bytes: ${payload.byteLength}`,
      'color:#888'
    );
  }

  const topicMeta = _parseTopicMeta(topic);

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
        if (_debug()) console.warn('%c[MQTT SKIP] entidade sem VehiclePosition', 'color:#b07a00', { entity_id: entity.id });
        _stats.skipped++;
        continue;
      }

      const pos       = vp.position;
      const trip      = vp.trip;
      const vehicleId = vp.vehicle?.id || entity.id;

      if (_debug()) {
        console.groupCollapsed(
          `%c[MQTT PROTO] veículo ${vehicleId} | rota ${trip?.route_id ?? '?'} | lat ${pos?.latitude?.toFixed(5)} lng ${pos?.longitude?.toFixed(5)}`,
          'color:#006494'
        );
        console.log('VehiclePosition completo:', JSON.parse(JSON.stringify(vp)));
        console.log('Metadados do tópico:', topicMeta);
        console.groupEnd();
      }

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
        if (_debug()) console.warn('%c[MQTT SKIP] posição inválida ou em falta', 'color:#b07a00', { vehicleId, pos });
        _stats.skipped++;
        continue;
      }

      _stats.decoded++;

      // Velocidade: usar o valor do tópico (km/h) — é a fonte mais fiável.
      // O campo pos.speed do protobuf está em m/s, mas o broker Porto Digital
      // já envia km/h directamente no texto do tópico.
      const speed = topicMeta.speed != null
        ? topicMeta.speed
        : (Number.isFinite(pos.speed) ? Math.round(pos.speed * 3.6) : null);

      const raw = {
        id:          String(vehicleId),
        routeId:     trip?.route_id   || null,
        directionId: trip?.direction_id != null ? Number(trip.direction_id) : null,
        tripId:      trip?.trip_id    || null,
        lat:         pos.latitude,
        lng:         pos.longitude,
        speed,                           // km/h, já correcto
        destination: topicMeta.headsign, // destino do tópico — evita resolveHeadsign
        busNumber:   topicMeta.busNumber,
      };

      if (_debug()) {
        console.log('%c[MQTT PROTO→RAW]', 'color:#006494', raw);
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

  /**
   * Inicia a ligação MQTT.
   * @param {object} opts
   * @param {function} opts.onVehicleUpdate   - chamado com o veículo normalizado em cada update
   * @param {function} opts.onVehicleExpired  - chamado com o vehicleId quando o TTL expira
   * @param {function} opts.onConnected       - chamado quando a ligação é estabelecida
   * @param {function} opts.onDisconnected    - chamado quando a ligação é perdida
   */
  async start({ onVehicleUpdate, onVehicleExpired, onConnected, onDisconnected } = {}) {
    if (_isStarted) {
      console.warn('⚠ MQTT já iniciado');
      return;
    }
    _isStarted = true;
    _onVehicleExpired = onVehicleExpired || null;

    // Instrução de debug logo no arranque (sempre visível)
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
            `%c[MQTT VEHICLE] ✔ id:${vehicle.id} linha:${vehicle.displayLine} dir:${vehicle.direction} ` +
            `lat:${vehicle.latitude?.toFixed(5)} lng:${vehicle.longitude?.toFixed(5)} ` +
            `speed:${vehicle.speed}km/h destino:${vehicle.destination}`,
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
    eventBus.emit('mqtt:stopped');
  },

  /** Remove imediatamente um veículo do snapshot (ex: ao receber TTL externo). */
  removeVehicle(vehicleId) {
    delete _vehicles[vehicleId];
    delete _vehicleTimestamp[vehicleId];
  },

  getAllVehicles()   { return Object.values(_vehicles); },
  isConnected()     { return _isConnected; },
  isStarted()       { return _isStarted;   },
};
