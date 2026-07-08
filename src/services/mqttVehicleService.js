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
const TOPIC_IDX = {
  ROOT_EMPTY: 0,
  FAMILY: 1,
  ENTITY: 2,
  FEED_ID: 3,
  AGENCY_ID: 4,
  AGENCY_NAME: 5,
  MODE: 6,
  ROUTE_ID: 7,
  DIRECTION_ID: 8,
  HEADSIGN: 9,
  TRIP_DESCRIPTOR: 10,
  NEXT_STOP: 11,
  START_TIME: 12,
  VEHICLE_ID: 13,
  GEOHASH_COORDS: 14,
  BEARING: 15,
  EXTRA_16: 16,
  SPEED: 17,
  ROUTE_ID_2: 18,
  PLATE: 19,
};

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
let client           = null;
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

function _safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function _debugFullMqttMessage({ topic, meta, payload, feed, entity, vp, raw, vehicle }) {
  if (!_debug()) return;

  const payloadBytes = payload instanceof Uint8Array
      ? Array.from(payload)
      : Array.from(new Uint8Array(payload));

  console.groupCollapsed(
      `%c[MQTT FULL] ${meta.routeId || '-'} ${meta.vehicleNumber || '-'} ${meta.headsign || ''}`,
      'color:#7c3aed;font-weight:bold'
  );

  console.log('topic:', topic);
  console.log('topic meta (all fields):', _safeJson(meta));
  console.log('topic parts:', meta.parts);
  console.log('payload bytes:', payloadBytes);
  console.log('feed decoded:', _safeJson(feed));
  console.log('entity:', _safeJson(entity));
  console.log('vehiclePosition:', _safeJson(vp));
  console.log('raw before processBusData:', _safeJson(raw));
  console.log('vehicle after processBusData:', _safeJson(vehicle));

  const protoHints = {
    tripId: vp?.trip?.trip_id ?? vp?.trip?.tripId ?? null,
    routeId: vp?.trip?.route_id ?? vp?.trip?.routeId ?? null,
    directionId: vp?.trip?.direction_id ?? vp?.trip?.directionId ?? null,
    startTime: vp?.trip?.start_time ?? vp?.trip?.startTime ?? null,
    startDate: vp?.trip?.start_date ?? vp?.trip?.startDate ?? null,
    scheduleRelationship: vp?.trip?.schedule_relationship ?? vp?.trip?.scheduleRelationship ?? null,
    currentStopSequence: vp?.current_stop_sequence ?? vp?.currentStopSequence ?? null,
    stopId: vp?.stop_id ?? vp?.stopId ?? null,
    currentStatus: vp?.current_status ?? vp?.currentStatus ?? null,
    timestamp: vp?.timestamp ?? null,
    bearing: vp?.position?.bearing ?? null,
    speed: vp?.position?.speed ?? null,
    odometer: vp?.position?.odometer ?? null,
    uncertainty: vp?.position?.uncertainty ?? null,
    occupancyStatus: vp?.occupancy_status ?? vp?.occupancyStatus ?? null,
    congestionLevel: vp?.congestion_level ?? vp?.congestionLevel ?? null,
  };

  console.log('proto hints:', _safeJson(protoHints));

  console.groupEnd();
}

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

function parseTopicMeta(topic) {
  const parts = String(topic || '').split('/');

  const seg = (idx) => {
    const s = parts[idx];
    return s && s.trim() !== '' ? decodeURIComponent(s.trim()) : null;
  };

  const speedRaw = seg(TOPIC_IDX.SPEED);
  let speed = null;
  if (speedRaw != null && !isNaN(Number(speedRaw))) {
    const raw = Number(speedRaw);
    const kmh = raw < 35 ? Math.round(raw * 3.6) : Math.round(raw);
    speed = Math.min(kmh, 90);
  }

  const bearingRaw = seg(TOPIC_IDX.BEARING);
  const bearing = bearingRaw != null && !isNaN(Number(bearingRaw))
      ? Number(bearingRaw)
      : null;

  return {
    rawTopic: topic,
    parts,

    feedId: seg(TOPIC_IDX.FEED_ID),
    agencyId: seg(TOPIC_IDX.AGENCY_ID),
    agencyName: seg(TOPIC_IDX.AGENCY_NAME),
    mode: seg(TOPIC_IDX.MODE),

    routeId: seg(TOPIC_IDX.ROUTE_ID),
    directionId: seg(TOPIC_IDX.DIRECTION_ID) != null
        ? Number(seg(TOPIC_IDX.DIRECTION_ID))
        : null,
    headsign: seg(TOPIC_IDX.HEADSIGN),
    tripDescriptor: seg(TOPIC_IDX.TRIP_DESCRIPTOR),
    nextStop: seg(TOPIC_IDX.NEXT_STOP),
    startTime: seg(TOPIC_IDX.START_TIME),
    vehicleNumber: seg(TOPIC_IDX.VEHICLE_ID),
    geohashCoords: seg(TOPIC_IDX.GEOHASH_COORDS),
    bearing,
    extra16: seg(TOPIC_IDX.EXTRA_16),
    speedRaw,
    speed,
    routeId2: seg(TOPIC_IDX.ROUTE_ID_2),
    plate: seg(TOPIC_IDX.PLATE),
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

      return { raw, meta, feed, entity, vp };
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

      client = window.mqtt.connect(BROKER_URL, {
        clean:           true,
        reconnectPeriod: 3000,
        connectTimeout:  8000,
      });

      client.on('connect', () => {
        _isConnected = true;
        console.info('✅ MQTT ligado ao broker Porto Digital');

        client.subscribe(TOPIC, { qos: 0 }, (err) => {
          if (err) console.error('❌ Erro ao subscrever tópico MQTT:', err);
          else     console.info(`📡 Subscrito: ${TOPIC}`);
        });

        _startNoDataTimer();
        _startStats();
        _startTtlCheck();
        eventBus.emit('mqtt:connected');
        onConnected?.();
      });

      client.on('reconnect', () => {
        console.info('🔄 MQTT a reconectar…');
        eventBus.emit('mqtt:reconnecting');
      });

      client.on('disconnect', () => {
        _isConnected = false;
        _stopStats();
        _clearNoDataTimer();
        eventBus.emit('mqtt:disconnected');
        onDisconnected?.();
      });

      client.on('error', (err) => {
        console.error('❌ Erro MQTT:', err);
        eventBus.emit('mqtt:error', err);
      });

      client.on('message', (topic, payload) => {
        const decoded = decodeMessage(payload, topic);
        if (!decoded) return;

        const { raw, meta, feed, entity, vp } = decoded;

        if (!raw.routeId) {
          _stats.skipped++;
          if (_debug()) {
            console.groupCollapsed('%c[MQTT SKIP] sem routeId', 'color:#b07a00;font-weight:bold');
            console.log('topic:', topic);
            console.log('meta:', _safeJson(meta));
            console.log('feed:', _safeJson(feed));
            console.log('entity:', _safeJson(entity));
            console.log('vehiclePosition:', _safeJson(vp));
            console.log('raw:', _safeJson(raw));
            console.groupEnd();
          }
          return;
        }

        if (raw.directionId == null) raw.directionId = 0;

        const vehicle = vehicleService.processBusData(raw);

        _debugFullMqttMessage({
          topic,
          meta,
          payload,
          feed,
          entity,
          vp,
          raw,
          vehicle
        });

        if (!vehicle) {
          _stats.skipped++;
          return;
        }

        if (!_hasReceivedData) {
          _hasReceivedData = true;
          _clearNoDataTimer();
          eventBus.emit('mqtt:dataRestored');
          console.info(
              `%c[MQTT] ✅ primeiro veículo recebido: id=${vehicle.id} linha=${vehicle.displayLine}`,
              'color:#437a22;font-weight:bold'
          );
        }

        _stats.processed++;
        _vehicles[vehicle.id] = vehicle;
        _vehicleTimestamp[vehicle.id] = Date.now();

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
    if (client) { client.end(true); client = null; }
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
