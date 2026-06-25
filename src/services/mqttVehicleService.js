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
 *   Em alternativa, se o broker enviar JSON, basta desativar a descodificação.
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
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus } from '../core/eventBus.js';
import { vehicleService } from './vehicleService.js';

// ─── Constantes ────────────────────────────────────────────────────────────
const BROKER_URL  = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC       = '/gtfsrt/vp/#';
const PROTO_PATH  = './resources/gtfs-realtime.proto';

// ─── Estado interno ─────────────────────────────────────────────────────────
let _client      = null;   // instância mqtt.js
let _protoRoot   = null;   // protobufjs root carregado
let _vehicles    = {};     // { vehicleId → veículo normalizado }
let _isConnected = false;
let _isStarted   = false;

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

// ─── Descodificação de mensagens ─────────────────────────────────────────────

/**
 * Descodifica um payload protobuf GTFS-RT.
 * Em modo debug loga cada fase: raw bytes → proto → raw normalizado.
 */
function decodeGtfsRtMessage(payload, topic) {
  _stats.received++;

  if (_debug()) {
    console.log(
      `%c[MQTT RAW] tópico: ${topic} | bytes: ${payload.byteLength}`,
      'color:#888'
    );
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
        console.groupEnd();
      }

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
        if (_debug()) console.warn('%c[MQTT SKIP] posição inválida ou em falta', 'color:#b07a00', { vehicleId, pos });
        _stats.skipped++;
        continue;
      }

      _stats.decoded++;

      const raw = {
        id:          String(vehicleId),
        routeId:     trip?.route_id  || null,
        directionId: trip?.direction_id != null ? Number(trip.direction_id) : null,
        tripId:      trip?.trip_id    || null,
        lat:         pos.latitude,
        lng:         pos.longitude,
        speed:       Number.isFinite(pos.speed) ? pos.speed * 3.6 : null, // m/s → km/h
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

  async start({ onVehicleUpdate, onConnected, onDisconnected } = {}) {
    if (_isStarted) {
      console.warn('⚠ MQTT já iniciado');
      return;
    }
    _isStarted = true;

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
        _vehicles[vehicle.id] = vehicle;

        if (_debug()) {
          console.log(
            `%c[MQTT VEHICLE] ✔ id:${vehicle.id} linha:${vehicle.displayLine} dir:${vehicle.direction} ` +
            `lat:${vehicle.latitude?.toFixed(5)} lng:${vehicle.longitude?.toFixed(5)} speed:${vehicle.speed}km/h`,
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
    _isConnected = false;
    _isStarted   = false;
    _vehicles    = {};
    _stopStats();
    eventBus.emit('mqtt:stopped');
  },

  getAllVehicles() {
    return Object.values(_vehicles);
  },

  isConnected() { return _isConnected; },
  isStarted()   { return _isStarted;   },
};
