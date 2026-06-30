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
 * ─── FORMATO DO TÓPICO (Porto Digital / Digitransit) ─────────────────────
 *
 * Split por '/', 0-based (tópico começa por '/'):
 *
 *   idx  0 = ""          (vazio — começa com '/')
 *   idx  1 = "gtfsrt"
 *   idx  2 = "vp"
 *   idx  3 = feedId      (ex: "2")
 *   idx  4 = agencyId    (pode ser vazio)
 *   idx  5 = agencyName  (pode ser vazio)
 *   idx  6 = mode        (ex: "BUS")
 *   idx  7 = routeId     (ex: "507")
 *   idx  8 = directionId (ex: "1")
 *   idx  9 = headsign    (ex: "Cordoaria")
 *   idx 10 = tripDescriptor (ex: "507_0_2|257|D6|T5|N7")
 *   idx 11 = nextStop
 *   idx 12 = startTime   (ex: "11:18")
 *   idx 13 = vehicleId   (ex: "3261")
 *   idx 14 = coords      (ex: "41;-8") — lat;lng aproximado do geohash
 *   idx 15 = bearing
 *   idx 16 = ? (campo extra)
 *   idx 17 = speed       (ex: "70") — pode ser km/h ou m/s, ver nota abaixo
 *   idx 18 = routeId2
 *   idx 19 = plate       (ex: "FCD116")
 *
 * Nota: exemplo real:
 *   /gtfsrt/vp/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/41;-8/16/42/70/507/FCD116/
 *
 * ─── VELOCIDADE ───────────────────────────────────────────────────────
 *
 *   idx 17: heurística — se < 35, assume m/s e converte para km/h;
 *   caso contrário, assume já estar em km/h. Cap de 90 km/h.
 *
 * ─── IMPORTANTE: routeId/directionId ───────────────────────────────────
 *
 *   O payload protobuf do Porto Digital pode não incluir trip.route_id
 *   e trip.direction_id. Esses campos estão sempre disponíveis no tópico
 *   (idx 7 e idx 8). O processamento usa sempre o tópico como fonte
 *   primária e o proto como fallback.
 *
 *   O processBusData() aceita direction=null (usa 0 como default internamente)
 *   para que veículos sem direction no proto sejam igualmente mostrados no mapa.
 *
 * ─── PROTOBUFJS CDN ────────────────────────────────────────────────────
 *
 *   A lib é carregada dinamicamente de PROTOBUFJS_URLS (por ordem):
 *   1. unpkg.com (mais fiável, não requer resolução de versão)
 *   2. cdn.jsdelivr.net com versão explícita (@7.4.0) como fallback
 *
 *   Se o primeiro URL falhar, tenta o seguinte automaticamente.
 *   O erro é registado como warning e não rejeita imediatamente.
 *
 * ─── DEBUG ─────────────────────────────────────────────────────────────────
 *
 *   localStorage.setItem('MQTT_DEBUG', '1')  → activar logs
 *   localStorage.removeItem('MQTT_DEBUG')    → desactivar
 */

import { eventBus }       from '../core/eventBus.js';
import { vehicleService } from './vehicleService.js';

// ─── Constantes ────────────────────────────────────────────────────────────
const BROKER_URL         = 'wss://mmt.portodigital.pt/websocket/';
const TOPIC              = '/gtfsrt/vp/#';
const PROTO_PATH         = './resources/gtfs-realtime.proto';
const VEHICLE_TTL        = 30_000; // ms
const TTL_CHECK_MS       = 5_000;  // ms
const NO_DATA_TIMEOUT_MS = 15_000; // ms

// Índices do tópico Digitransit (0-based após split '/')
const TIDX_ROUTE_ID    = 7;
const TIDX_DIR_ID      = 8;
const TIDX_HEADSIGN    = 9;
const TIDX_VEHICLE_NUM = 13;
const TIDX_SPEED       = 17;
const TIDX_PLATE       = 19;

/**
 * URLs de fallback para a lib protobufjs, tentados por ordem.
 *
 * 1. unpkg.com — mais fiável: sem resolução de versão "latest",
 *    entrega directamente o ficheiro sem redirect.
 * 2. cdn.jsdelivr.net com versão explícita — evita o problema de
 *    /npm/protobufjs@7 (sem patch) que pode falhar por range ambíguo.
 */
const PROTOBUFJS_URLS = [
  'https://unpkg.com/protobufjs@7/dist/protobuf.min.js',
  'https://cdn.jsdelivr.net/npm/protobufjs@7.4.0/dist/protobuf.min.js',
];

// ─── Estado interno ────────────────────────────────────────────────────────────
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
    console.groupEnd();
    _stats = { received: 0, decoded: 0, processed: 0, skipped: 0 };
  }, 10_000);
}

function _stopStats() {
  if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
}

// ─── No-data timeout ───────────────────────────────────────────────────

function _startNoDataTimer() {
  _clearNoDataTimer();
  _noDataTimer = setTimeout(() => {
    if (!_hasReceivedData) {
      console.warn('%c[MQTT] ⚠ Timeout de 15s sem dados', 'color:#964219;font-weight:bold');
      eventBus.emit('mqtt:noDataTimeout');
    }
  }, NO_DATA_TIMEOUT_MS);
}

function _clearNoDataTimer() {
  if (_noDataTimer) { clearTimeout(_noDataTimer); _noDataTimer = null; }
}

// ─── TTL ─────────────────────────────────────────────────────────────────────

function _startTtlCheck() {
  if (_ttlInterval) return;
  _ttlInterval = setInterval(() => {
    const now     = Date.now();
    const expired = Object.keys(_vehicleTimestamp).filter(
      id => now - _vehicleTimestamp[id] > VEHICLE_TTL
    );
    for (const id of expired) {
      if (_debug()) console.log(`%c[MQTT TTL] 🗑 veículo ${id} removido`, 'color:#964219');
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

// ─── Carregamento dinâmico ─────────────────────────────────────────────────

async function loadMqttLib() {
  if (window.mqtt) return window.mqtt;
  await _loadScript('https://unpkg.com/mqtt/dist/mqtt.min.js');
  if (!window.mqtt) throw new Error('mqtt.js não foi carregado corretamente');
  return window.mqtt;
}

/**
 * Carrega protobufjs tentando os URLs em PROTOBUFJS_URLS por ordem.
 * Cada falha é registada como warning; só rejeita se TODOS falharem.
 */
async function loadProtobufLib() {
  if (window.protobuf) return window.protobuf;

  let lastError;
  for (const url of PROTOBUFJS_URLS) {
    try {
      await _loadScript(url);
      if (window.protobuf) {
        console.info(`%c[MQTT] ✅ protobufjs carregado de: ${url}`, 'color:#437a22');
        return window.protobuf;
      }
      // Script carregou mas window.protobuf não foi definido
      console.warn(`%c[MQTT] ⚠ ${url} carregou mas window.protobuf não está definido — a tentar próximo...`, 'color:#964219');
    } catch (err) {
      console.warn(`%c[MQTT] ⚠ Falha ao carregar protobufjs de ${url} — a tentar próximo...`, 'color:#964219', err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('protobufjs: todos os CDNs falharam');
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    // Se já existe um <script> com este src, não duplicar
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
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

// ─── Parsing do tópico MQTT ─────────────────────────────────────────────────

function _parseTopicMeta(topic) {
  const parts = topic.split('/');
  const seg = (idx) => {
    const s = parts[idx];
    return (s && s.trim() !== '') ? decodeURIComponent(s.trim()) : null;
  };

  const speedRaw = seg(TIDX_SPEED);
  let speed = null;
  if (speedRaw && !isNaN(Number(speedRaw))) {
    const ms = Number(speedRaw);
    const kmh = ms < 35 ? Math.round(ms * 3.6) : Math.round(ms);
    speed = Math.min(kmh, 90);
  }

  return {
    routeId:       seg(TIDX_ROUTE_ID),
    directionId:   seg(TIDX_DIR_ID) != null ? Number(seg(TIDX_DIR_ID)) : null,
    headsign:      seg(TIDX_HEADSIGN),
    vehicleNumber: seg(TIDX_VEHICLE_NUM),
    speed,
    plate:         seg(TIDX_PLATE),
  };
}

// ─── Descodificação de mensagens ───────────────────────────────────────────────

function _decodeMessage(payload, topic) {
  _stats.received++;

  const meta = _parseTopicMeta(topic);

  try {
    const FeedMessage = _protoRoot.lookupType('transit_realtime.FeedMessage');
    const feed = FeedMessage.decode(payload);

    for (const entity of (feed.entity || [])) {
      const vp = entity.vehicle;
      if (!vp) { _stats.skipped++; continue; }

      const pos  = vp.position;
      const trip = vp.trip;

      if (!pos || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
        _stats.skipped++;
        continue;
      }

      _stats.decoded++;

      // Tópico é fonte primária; proto é fallback
      const vehicleId  = meta.vehicleNumber || vp.vehicle?.id || entity.id;
      const routeId    = meta.routeId    || trip?.route_id  || null;
      const directionId = meta.directionId != null
        ? meta.directionId
        : (trip?.direction_id != null ? Number(trip.direction_id) : null);
      const tripId     = trip?.trip_id || null;

      const raw = {
        id:          String(vehicleId),
        busNumber:   String(vehicleId),
        plate:       meta.plate,
        lat:         pos.latitude,
        lng:         pos.longitude,
        destination: meta.headsign,
        speed:       meta.speed,
        routeId,
        directionId,
        tripId,
      };

      if (_debug()) {
        console.log(
          `%c[MQTT PROTO→RAW] id:${raw.id} linha:${raw.routeId} dir:${raw.directionId} ` +
          `lat:${raw.lat?.toFixed(5)} lng:${raw.lng?.toFixed(5)} ` +
          `speed:${raw.speed}km/h destino:"${raw.destination}" trip:${raw.tripId}`,
          'color:#006494', raw
        );
      }

      return raw;
    }
    return null;
  } catch (err) {
    _stats.skipped++;
    if (_debug()) console.error('%c[MQTT ERR] decode', 'color:#a12c7b', err);
    return null;
  }
}

// ─── API pública ────────────────────────────────────────────────────────────

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
      '%c[MQTT] Para activar logs: localStorage.setItem(\'MQTT_DEBUG\', \'1\') e recarrega',
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
        console.info('✅ MQTT ligado ao broker Porto Digital');

        _client.subscribe(TOPIC, { qos: 0 }, (err) => {
          if (err) console.error('❌ Erro ao subscrever tópico MQTT:', err);
          else     console.info(`📡 Subscrito: ${TOPIC}`);
        });

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
        const raw = _decodeMessage(payload, topic);
        if (!raw) return;

        // processBusData exige routeId (line) e tolera directionId=null
        // Se não há routeId no tópico nem no proto, descartar
        if (!raw.routeId) {
          _stats.skipped++;
          return;
        }

        // directionId=null é aceite — usar 0 como default no processamento
        if (raw.directionId == null) raw.directionId = 0;

        const vehicle = vehicleService.processBusData(raw);

        if (!vehicle) {
          _stats.skipped++;
          if (_debug()) console.warn('%c[MQTT SKIP] processBusData=null', 'color:#b07a00', raw);
          return;
        }

        if (!_hasReceivedData) {
          _hasReceivedData = true;
          _clearNoDataTimer();
          eventBus.emit('mqtt:dataRestored');
          console.info(
            `%c🚌 MQTT: primeiro veículo recebido (id:${vehicle.id} linha:${vehicle.displayLine})`,
            'color:#437a22;font-weight:bold'
          );
        }

        _stats.processed++;
        _vehicles[vehicle.id]         = vehicle;
        _vehicleTimestamp[vehicle.id] = Date.now();

        if (_debug()) {
          console.log(
            `%c[MQTT VEHICLE] ✔ id:${vehicle.id} linha:${vehicle.displayLine} ` +
            `dir:${vehicle.direction} lat:${vehicle.latitude?.toFixed(5)} ` +
            `lng:${vehicle.longitude?.toFixed(5)} speed:${vehicle.speed}km/h`,
            'color:#437a22', vehicle
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
    if (_client) { _client.end(true); _client = null; }
    _isConnected      = false;
    _isStarted        = false;
    _hasReceivedData  = false;
    _vehicles         = {};
    _vehicleTimestamp = {};
    _onVehicleExpired = null;
    _clearNoDataTimer();
    _stopStats();
    _stopTtlCheck();
    eventBus.emit('mqtt:stopped');
  },

  removeVehicle(vehicleId) {
    delete _vehicles[vehicleId];
    delete _vehicleTimestamp[vehicleId];
  },

  getVehicleByTripId(tripId) {
    if (!tripId) return null;
    return Object.values(_vehicles).find(v => v.tripId === tripId) || null;
  },

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
