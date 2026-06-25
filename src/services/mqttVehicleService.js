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

// ─── Auxiliares de carregamento dinâmico ─────────────────────────────────────

/**
 * Carrega mqtt.js dinamicamente a partir do CDN se ainda não estiver disponível.
 */
async function loadMqttLib() {
  if (window.mqtt) return window.mqtt;
  await _loadScript('https://unpkg.com/mqtt/dist/mqtt.min.js');
  if (!window.mqtt) throw new Error('mqtt.js não foi carregado corretamente');
  return window.mqtt;
}

/**
 * Carrega protobufjs dinamicamente a partir do CDN.
 */
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

/**
 * Carrega e compila o esquema .proto do GTFS-RT.
 * Usa fetch para obter o ficheiro local e protobufjs.parse para compilar.
 */
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
 * Descodifica um payload protobuf GTFS-RT e devolve um objecto normalizado
 * no mesmo formato que vehicleService.processBusData espera para o formato
 * de worker (lat/lng/routeId/directionId/tripId/speed).
 *
 * @param {Uint8Array} payload - bytes recebidos via MQTT
 * @returns {Object|null} veículo normalizado ou null se inválido
 */
function decodeGtfsRtMessage(payload) {
  try {
    const FeedMessage = _protoRoot.lookupType('transit_realtime.FeedMessage');
    const feed = FeedMessage.decode(payload);

    // Cada mensagem do broker do Porto contém normalmente 1 entidade
    for (const entity of (feed.entity || [])) {
      const vp = entity.vehicle;
      if (!vp) continue;

      const pos       = vp.position;
      const trip      = vp.trip;
      const vehicleId = vp.vehicle?.id || entity.id;

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) continue;

      // Constrói objecto no formato do worker normalizado
      const raw = {
        id:          String(vehicleId),
        routeId:     trip?.route_id  || null,
        directionId: trip?.direction_id != null ? Number(trip.direction_id) : null,
        tripId:      trip?.trip_id    || null,
        lat:         pos.latitude,
        lng:         pos.longitude,
        speed:       Number.isFinite(pos.speed) ? pos.speed * 3.6 : null, // m/s → km/h
      };

      return raw;
    }
    return null;
  } catch (err) {
    // Mensagem inválida ou formato inesperado — ignorar silenciosamente
    return null;
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

export const mqttVehicleService = {

  /**
   * Inicia a ligação MQTT.
   * Deve ser chamado uma só vez após o mapa estar pronto.
   *
   * @param {Object} options
   * @param {Function} options.onVehicleUpdate - callback(vehicle) chamado por cada
   *   atualização de posição. vehicle tem o formato interno de processBusData.
   * @param {Function} [options.onConnected]   - chamado quando a ligação é estabelecida
   * @param {Function} [options.onDisconnected]- chamado quando a ligação cai
   */
  async start({ onVehicleUpdate, onConnected, onDisconnected } = {}) {
    if (_isStarted) {
      console.warn('⚠ MQTT já iniciado');
      return;
    }
    _isStarted = true;

    try {
      // Carregar dependências
      await Promise.all([loadMqttLib(), loadProtoSchema()]);

      // Ligar ao broker
      _client = window.mqtt.connect(BROKER_URL, {
        clean:        true,
        reconnectPeriod: 3000,   // tenta reconectar a cada 3 s
        connectTimeout: 8000,
      });

      _client.on('connect', () => {
        _isConnected = true;
        console.info('✅ MQTT ligado ao Porto Digital broker');
        _client.subscribe(TOPIC, { qos: 0 }, (err) => {
          if (err) console.error('❌ Erro ao subscrever tópico MQTT:', err);
          else     console.info(`📡 Subscrito ao tópico: ${TOPIC}`);
        });
        eventBus.emit('mqtt:connected');
        onConnected?.();
      });

      _client.on('reconnect', () => {
        console.info('🔄 MQTT a reconectar…');
        eventBus.emit('mqtt:reconnecting');
      });

      _client.on('disconnect', () => {
        _isConnected = false;
        eventBus.emit('mqtt:disconnected');
        onDisconnected?.();
      });

      _client.on('error', (err) => {
        console.error('❌ Erro MQTT:', err);
        eventBus.emit('mqtt:error', err);
      });

      _client.on('message', (_topic, payload) => {
        const raw = decodeGtfsRtMessage(payload);
        if (!raw) return;

        const vehicle = vehicleService.processBusData(raw);
        if (!vehicle) return;

        // Guarda estado mais recente para snapshot completo
        _vehicles[vehicle.id] = vehicle;

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

  /**
   * Para a ligação MQTT e limpa o estado.
   */
  stop() {
    if (_client) {
      _client.end(true);
      _client = null;
    }
    _isConnected = false;
    _isStarted   = false;
    _vehicles    = {};
    eventBus.emit('mqtt:stopped');
  },

  /** Devolve snapshot de todos os veículos conhecidos. */
  getAllVehicles() {
    return Object.values(_vehicles);
  },

  isConnected() { return _isConnected; },
  isStarted()   { return _isStarted;   },
};
