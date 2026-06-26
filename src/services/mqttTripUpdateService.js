/**
 * MQTT Trip Update Service
 *
 * Subscreve /gtfsrt/tu/# no broker Porto Digital e descodifica mensagens
 * TripUpdate do protocolo GTFS-RT. Fornece chegadas previstas por paragem
 * em tempo real, substituindo a API HTTP que falha com frequência.
 *
 * ─── FORMATO DO TÓPICO (Porto Digital) ───────────────────────────────────
 *
 *   /gtfsrt/tu/{feedId}/{agencyId}/{mode}/{routeId}/{directionId}/{headsign}/...
 *
 *   Exemplo real (por analogia com /vp):
 *   /gtfsrt/tu/2///BUS/507/1/Cordoaria/507_0_2|257|D6|T5|N7//11:18/3261/.../
 *
 *   Mapa de índices (mesmo padrão que /vp):
 *   idx  7  = routeId ("507")
 *   idx  8  = directionId ("1")
 *   idx  9  = headsign / destino ("Cordoaria")
 *   idx 13  = número do veículo ("3261")
 *
 * ─── ESTRUTURA GTFS-RT TripUpdate ──────────────────────────────────────────────
 *
 *   TripUpdate {
 *     trip: { trip_id, route_id, direction_id, start_time, start_date }
 *     vehicle: { id }   ← número do veículo
 *     stop_time_update[]: [
 *       { stop_id, stop_sequence, arrival: { time, delay }, departure: { time, delay } }
 *     ]
 *     timestamp
 *   }
 *
 *   arrival.time  → Unix timestamp (segundos) da chegada prevista
 *   arrival.delay → atraso em segundos (positivo = atrasado, negativo = adiantado)
 *
 * ─── INDEXAÇÃO ───────────────────────────────────────────────────────────────────
 *
 *   _byStop: Map<stopId, TripArrival[]>
 *
 *   Cada TripArrival:
 *   {
 *     tripId, routeId, directionId, headsign, vehicleNumber,
 *     stopId, arrivalTime (Unix s), departureTime (Unix s),
 *     delaySeconds, stopSequence, updatedAt (Date.now())
 *   }
 *
 *   Lookup O(1): getArrivalsForStop(stopId) devolve array ordenado por arrivalTime.
 *
 * ─── TTL ──────────────────────────────────────────────────────────────────────────────
 *
 *   Cada trip é guardada com um timestamp de recepção.
 *   A cada 10 s: trips sem update há mais de 60 s são removidas do índice.
 *
 * ─── PARTILHA DO CLIENT MQTT ────────────────────────────────────────────────────────────
 *
 *   Não cria um client MQTT próprio. Recebe o client e o protoRoot já
 *   instanciados pelo mqttVehicleService (mesmo broker, mesmo proto),
 *   adiciona apenas uma nova subscrição ao tópico /gtfsrt/tu/#.
 *   Isso evita uma segunda ligação WebSocket ao broker.
 *
 * ─── DEBUG ──────────────────────────────────────────────────────────────────────────────
 *
 *   localStorage.setItem('MQTT_TU_DEBUG', '1')  → activar logs
 *   localStorage.removeItem('MQTT_TU_DEBUG')    → desactivar
 */

import { eventBus } from '../core/eventBus.js';

// ─── Constantes ────────────────────────────────────────────────────────────

const TOPIC_TU   = '/gtfsrt/tu/#';
const TRIP_TTL   = 60_000;  // ms — trip sem update há 60s é descartada
const TTL_CHECK  = 10_000;  // ms

// Índices do tópico (mesmo padrão que /vp)
const TIDX_ROUTE_ID     = 7;
const TIDX_DIRECTION_ID = 8;
const TIDX_HEADSIGN     = 9;
const TIDX_VEHICLE_NUM  = 13;

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {Map<string, { arrivals: TripArrival[], updatedAt: number }>} tripId → meta */
const _byTrip = new Map();

/** @type {Map<string, TripArrival[]>} stopId → sorted arrivals */
const _byStop = new Map();

let _ttlInterval = null;
let _isActive    = false;

// ─── Debug ───────────────────────────────────────────────────────────────────

const _debug = () => {
  try { return localStorage.getItem('MQTT_TU_DEBUG') === '1'; } catch { return false; }
};

// ─── TTL ─────────────────────────────────────────────────────────────────────

function _startTtl() {
  if (_ttlInterval) return;
  _ttlInterval = setInterval(() => {
    const now = Date.now();
    const toRemove = [];
    for (const [tripId, meta] of _byTrip) {
      if (now - meta.updatedAt > TRIP_TTL) toRemove.push(tripId);
    }
    if (!toRemove.length) return;
    for (const tripId of toRemove) {
      _byTrip.delete(tripId);
      if (_debug()) console.log(`%c[TU TTL] ⛽ trip ${tripId} expirado`, 'color:#964219');
    }
    _rebuildStopIndex();
  }, TTL_CHECK);
}

function _stopTtl() {
  if (_ttlInterval) { clearInterval(_ttlInterval); _ttlInterval = null; }
}

// ─── Índice por paragem ────────────────────────────────────────────────────────────

/**
 * Reconstrói o índice _byStop a partir do _byTrip.
 * Chamado após cada actualização de trip e no TTL.
 */
function _rebuildStopIndex() {
  _byStop.clear();
  const now = Math.floor(Date.now() / 1000); // Unix s
  for (const [, meta] of _byTrip) {
    for (const arrival of meta.arrivals) {
      // Ignorar chegadas já no passado (> 30s atrás)
      if (arrival.arrivalTime > 0 && arrival.arrivalTime < now - 30) continue;
      const list = _byStop.get(arrival.stopId) || [];
      list.push(arrival);
      _byStop.set(arrival.stopId, list);
    }
  }
  // Ordenar cada lista por arrivalTime
  for (const [stopId, list] of _byStop) {
    _byStop.set(stopId, list.sort((a, b) => a.arrivalTime - b.arrivalTime));
  }
}

// ─── Parsing do tópico ─────────────────────────────────────────────────────────────

function _parseTopicMeta(topic) {
  const parts = topic.split('/');
  const seg = (idx) => {
    const s = parts[idx];
    return (s && s.trim() !== '') ? decodeURIComponent(s.trim()) : null;
  };
  return {
    routeId:       seg(TIDX_ROUTE_ID),
    directionId:   seg(TIDX_DIRECTION_ID) != null ? Number(seg(TIDX_DIRECTION_ID)) : null,
    headsign:      seg(TIDX_HEADSIGN),
    vehicleNumber: seg(TIDX_VEHICLE_NUM),
  };
}

// ─── Descodificação protobuf ──────────────────────────────────────────────────────────

/**
 * Descodifica um payload TripUpdate e actualiza os índices.
 * @param {Uint8Array} payload
 * @param {string} topic
 * @param {object} protoRoot - raíz protobuf já carregada pelo mqttVehicleService
 */
function _processMessage(payload, topic, protoRoot) {
  const meta = _parseTopicMeta(topic);

  try {
    const FeedMessage = protoRoot.lookupType('transit_realtime.FeedMessage');
    const feed = FeedMessage.decode(payload);

    for (const entity of (feed.entity || [])) {
      const tu = entity.trip_update || entity.tripUpdate;
      if (!tu) continue;

      const trip         = tu.trip || {};
      const tripId       = trip.trip_id   || trip.tripId   || entity.id || null;
      const routeId      = trip.route_id  || trip.routeId  || meta.routeId || null;
      const directionId  = trip.direction_id != null ? Number(trip.direction_id)
                         : (meta.directionId != null ? meta.directionId : null);
      const vehicleNum   = tu.vehicle?.id || meta.vehicleNumber || null;
      const headsign     = meta.headsign || null;

      if (!tripId) {
        if (_debug()) console.warn('%c[TU SKIP] sem tripId', 'color:#b07a00', { topic });
        continue;
      }

      const stopUpdates = tu.stop_time_update || tu.stopTimeUpdate || [];
      const arrivals = [];

      for (const stu of stopUpdates) {
        const stopId = stu.stop_id || stu.stopId || null;
        if (!stopId) continue;

        // arrival.time pode ser Long (protobufjs) — converter para number
        const rawArrTime = stu.arrival?.time ?? stu.arrival?.Time ?? null;
        const rawDepTime = stu.departure?.time ?? stu.departure?.Time ?? null;
        const rawDelay   = stu.arrival?.delay ?? stu.departure?.delay ?? null;

        const arrivalTime   = rawArrTime  != null ? _toLong(rawArrTime)  : 0;
        const departureTime = rawDepTime  != null ? _toLong(rawDepTime)  : 0;
        const delaySeconds  = rawDelay    != null ? Number(rawDelay)     : 0;
        const stopSeq       = stu.stop_sequence ?? stu.stopSequence ?? 0;

        arrivals.push({
          tripId,
          routeId,
          directionId,
          headsign,
          vehicleNumber: vehicleNum,
          stopId,
          stopSequence:  Number(stopSeq),
          arrivalTime,      // Unix timestamp (s)
          departureTime,    // Unix timestamp (s)
          delaySeconds,
          updatedAt: Date.now(),
        });
      }

      if (arrivals.length === 0) continue;

      _byTrip.set(tripId, { arrivals, updatedAt: Date.now() });

      if (_debug()) {
        console.log(
          `%c[TU] trip ${tripId} linha ${routeId} dir ${directionId} ` +
          `${arrivals.length} paragens | veículo ${vehicleNum}`,
          'color:#437a22'
        );
      }
    }

    _rebuildStopIndex();
    eventBus.emit('mqtt:tripUpdateReceived');

  } catch (err) {
    if (_debug()) console.error('%c[TU ERR] erro ao descodificar', 'color:#a12c7b', err);
  }
}

/**
 * Converte Long / number de protobufjs para number primitivo.
 * protobufjs representa int64 como { low, high, unsigned }.
 */
function _toLong(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // protobufjs Long object
  if (typeof v === 'object' && 'low' in v) {
    return v.low + v.high * 4294967296;
  }
  return Number(v);
}

// ─── API pública ─────────────────────────────────────────────────────────────────

export const mqttTripUpdateService = {

  /**
   * Inicia a subscrição TripUpdate reutilizando o client MQTT já ligado.
   * Deve ser chamado depois de mqttVehicleService.start() ter ligado.
   *
   * @param {object} mqttClient  - client MQTT já conectado (window.mqtt instance)
   * @param {object} protoRoot   - raíz protobuf já carregada
   */
  attach(mqttClient, protoRoot) {
    if (_isActive) return;
    _isActive = true;

    mqttClient.subscribe(TOPIC_TU, { qos: 0 }, (err) => {
      if (err) {
        console.error('\u274c Erro ao subscrever TripUpdate MQTT:', err);
        _isActive = false;
        return;
      }
      console.info(`\uD83D\uDCE1 TripUpdate subscrito: ${TOPIC_TU}`);
      _startTtl();
    });

    mqttClient.on('message', (topic, payload) => {
      if (!topic.startsWith('/gtfsrt/tu/')) return;
      _processMessage(payload, topic, protoRoot);
    });
  },

  detach() {
    _isActive = false;
    _stopTtl();
    _byTrip.clear();
    _byStop.clear();
  },

  /**
   * Devolve chegadas previstas para uma paragem específica.
   * Filtra chegadas já no passado (arrivalTime < now - 30s).
   *
   * @param {string} stopId
   * @returns {TripArrival[]} ordenado por arrivalTime asc
   */
  getArrivalsForStop(stopId) {
    return _byStop.get(stopId) || [];
  },

  /**
   * Indica se já existem dados TripUpdate para uma paragem.
   * @param {string} stopId
   * @returns {boolean}
   */
  hasDataForStop(stopId) {
    const list = _byStop.get(stopId);
    return !!(list && list.length > 0);
  },

  isActive() { return _isActive; },

  /** Número de trips em memória (para debug) */
  tripCount() { return _byTrip.size; },
  stopCount() { return _byStop.size; },
};
