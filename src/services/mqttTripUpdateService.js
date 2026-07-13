/**
 * MQTT Trip Update Service
 *
 * Subscreve /gtfsrt/tu/# no broker Porto Digital e descodifica mensagens
 * TripUpdate do protocolo GTFS-RT. Fornece chegadas previstas por paragem
 * em tempo real, substituindo a API HTTP que falha com frequência.
 *
 * ─── MODELO DO BROKER (Porto Digital / Digitransit) ───────────────────────
 *
 * O broker Porto Digital segue o modelo Digitransit (Finlândia):
 * https://digitransit.fi/en/developers/apis/4-realtime-api/vehicle-positions/
 *
 * Tópico completo (0-based após o '/' inicial):
 * /gtfsrt/{type}/{feedId}/{agencyId}/{agencyName}/{mode}/{routeId}/{directionId}/{headsign}/{tripId}/{nextStop}/{startTime}/{vehicleId}/...
 *
 * idx  0 = "" (vazio — o tópico começa com '/')
 * idx  1 = "gtfsrt"
 * idx  2 = type: "vp" ou "tu"
 * idx  3 = feedId (ex: "2")
 * idx  4 = agencyId (pode ser vazio)
 * idx  5 = agencyName (pode ser vazio)
 * idx  6 = mode: "BUS", "RAIL", etc. (pode ser vazio)
 * idx  7 = routeId (ex: "507")
 * idx  8 = directionId: "0" ou "1" (pode ser vazio)
 * idx  9 = headsign / destino (ex: "Cordoaria")
 * idx 10 = tripId (ex: "507_0_2|257|D6|T5|N7")
 * idx 11 = nextStop (próxima paragem)
 * idx 12 = startTime (ex: "11:18")
 * idx 13 = vehicleId (ex: "3261")
 * idx 14+ = geohash e outros campos
 *
 * NOTA: O tópico /gtfsrt/tu/# pode não existir neste broker.
 * O diagnóstico inicial monitoriza todos os tópicos recebidos para
 * confirmar se /tu/ está disponível. Se não houver dados /tu/ após
 * 30s, o serviço reporta a situação e o fallback HTTP é mantido.
 *
 * ─── ESTRUTURA GTFS-RT TripUpdate ─────────────────────────────────────────
 *
 *   TripUpdate {
 *     trip: { trip_id, route_id, direction_id, start_time, start_date }
 *     vehicle: { id }
 *     stop_time_update[]: [
 *       { stop_id, stop_sequence, arrival: { time, delay }, departure: { time, delay } }
 *     ]
 *   }
 *
 * ─── DEBUG ─────────────────────────────────────────────────────────────────
 *
 *   localStorage.setItem('MQTT_TU_DEBUG', '1')  → activar logs
 *   mqttTripUpdateService.diagnose()             → relatório de estado
 */

import { eventBus } from '../core/eventBus.js';

// ─── Constantes ────────────────────────────────────────────────────────────

const TOPIC_TU   = '/gtfsrt/tu/#';
const TRIP_TTL   = 60_000;  // ms
const TTL_CHECK  = 10_000;  // ms
const DIAG_MS    = 30_000;  // ms — janela de diagnóstico inicial

// Índices do tópico Digitransit (split por '/', 0-based)
// /gtfsrt/{type}/{feedId}/{agencyId}/{agencyName}/{mode}/{routeId}/{directionId}/{headsign}/{tripId}/{nextStop}/{startTime}/{vehicleId}/...
const TIDX_TYPE        = 2;
const TIDX_ROUTE_ID    = 7;
const TIDX_DIR_ID      = 8;
const TIDX_HEADSIGN    = 9;
const TIDX_TRIP_ID     = 10;
const TIDX_VEHICLE_ID  = 13;

// ─── Estado interno ────────────────────────────────────────────────────────

/** @type {Map<string, { arrivals: object[], updatedAt: number }>} */
const _byTrip = new Map();

/** @type {Map<string, object[]>} stopId → sorted arrivals */
const _byStop = new Map();

let _ttlInterval  = null;
let _isActive     = false;
let _protoRoot    = null;

// Diagnóstico
let _diagTimer      = null;
let _msgCountTu     = 0;   // mensagens /gtfsrt/tu/ recebidas
let _msgCountTotal  = 0;   // todas as mensagens recebidas pelo handler
const _topicsSeen   = new Set(); // amostra de tópicos únicos (máx 50)

// ─── Debug ─────────────────────────────────────────────────────────────────

const _debug = () => {
  try { return localStorage.getItem('MQTT_TU_DEBUG') === '1'; } catch { return false; }
};

// ─── TTL ───────────────────────────────────────────────────────────────────

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
      if (_debug()) console.log(`%c[TU TTL] trip ${tripId} expirado`, 'color:#964219');
    }
    _rebuildStopIndex();
  }, TTL_CHECK);
}

function _stopTtl() {
  if (_ttlInterval) { clearInterval(_ttlInterval); _ttlInterval = null; }
}

// ─── Índice por paragem ─────────────────────────────────────────────────────

function _rebuildStopIndex() {
  _byStop.clear();
  const now = Math.floor(Date.now() / 1000);
  for (const [, meta] of _byTrip) {
    for (const arrival of meta.arrivals) {
      if (arrival.arrivalTime > 0 && arrival.arrivalTime < now - 30) continue;
      const list = _byStop.get(arrival.stopId) || [];
      list.push(arrival);
      _byStop.set(arrival.stopId, list);
    }
  }
  for (const [stopId, list] of _byStop) {
    _byStop.set(stopId, list.sort((a, b) => a.arrivalTime - b.arrivalTime));
  }
}

// ─── Parsing do tópico ──────────────────────────────────────────────────────

function _parseTopicMeta(topic) {
  const parts = topic.split('/');
  const seg = (idx) => {
    const s = parts[idx];
    return (s && s.trim() !== '') ? decodeURIComponent(s.trim()) : null;
  };
  return {
    type:          seg(TIDX_TYPE),
    routeId:       seg(TIDX_ROUTE_ID),
    directionId:   seg(TIDX_DIR_ID) != null ? Number(seg(TIDX_DIR_ID)) : null,
    headsign:      seg(TIDX_HEADSIGN),
    tripIdTopic:   seg(TIDX_TRIP_ID),   // tripId do tópico (pode ser mais fiável que o proto)
    vehicleNumber: seg(TIDX_VEHICLE_ID),
  };
}

// ─── Descodificação protobuf ─────────────────────────────────────────────────

function _processMessage(payload, topic) {
  if (!_protoRoot) {
    if (_debug()) console.warn('[TU] protoRoot não disponível — mensagem descartada');
    return;
  }

  const meta = _parseTopicMeta(topic);

  if (_debug()) {
    console.group(`%c[TU RAW] ${topic}`, 'color:#006494');
    console.log('meta:', meta, '| bytes:', payload.byteLength);
    console.groupEnd();
  }

  try {
    const FeedMessage = _protoRoot.lookupType('transit_realtime.FeedMessage');
    const feed = FeedMessage.decode(payload);

    if (_debug() && !(feed.entity?.length)) {
      console.warn('%c[TU SKIP] feed sem entidades', 'color:#b07a00', topic);
      return;
    }

    for (const entity of (feed.entity || [])) {
      // protobufjs pode usar camelCase ou snake_case dependendo da versão
      const tu = entity.trip_update ?? entity.tripUpdate;
      if (!tu) continue;

      const trip = tu.trip ?? {};
      const tripId = trip.trip_id ?? trip.tripId ?? meta.tripIdTopic ?? entity.id ?? null;
      const routeId = trip.route_id ?? trip.routeId ?? meta.routeId ?? null;
      const dirId = trip.direction_id != null ? Number(trip.direction_id)
                  : trip.directionId  != null ? Number(trip.directionId)
                  : meta.directionId;
      const vehicleNum = tu.vehicle?.id ?? meta.vehicleNumber ?? null;
      const headsign   = meta.headsign ?? null;

      if (!tripId) {
        if (_debug()) console.warn('%c[TU SKIP] sem tripId', 'color:#b07a00', { topic, entity });
        continue;
      }

      const stopUpdates = tu.stop_time_update ?? tu.stopTimeUpdate ?? [];
      const arrivals = [];

      for (const stu of stopUpdates) {
        const stopId = stu.stop_id ?? stu.stopId ?? null;
        if (!stopId) continue;

        const rawArr  = stu.arrival?.time  ?? stu.arrival?.Time  ?? null;
        const rawDep  = stu.departure?.time ?? stu.departure?.Time ?? null;
        const rawDelay = stu.arrival?.delay ?? stu.departure?.delay ?? null;

        arrivals.push({
          tripId,
          routeId,
          directionId:   dirId,
          headsign,
          vehicleNumber: vehicleNum,
          stopId:        String(stopId),
          stopSequence:  Number(stu.stop_sequence ?? stu.stopSequence ?? 0),
          arrivalTime:   rawArr   != null ? _toLong(rawArr)   : 0,
          departureTime: rawDep   != null ? _toLong(rawDep)   : 0,
          delaySeconds:  rawDelay != null ? Number(rawDelay)  : 0,
          updatedAt: Date.now(),
        });
      }

      if (arrivals.length === 0) continue;

      _byTrip.set(tripId, { arrivals, updatedAt: Date.now() });

      if (_debug()) {
        console.log(
          `%c[TU ✔] trip ${tripId} linha ${routeId} dir ${dirId} ` +
          `${arrivals.length} paragens | veículo ${vehicleNum}`,
          'color:#437a22', arrivals
        );
      }
    }

    _rebuildStopIndex();
    eventBus.emit('mqtt:tripUpdateReceived');

  } catch (err) {
    if (_debug()) console.error('%c[TU ERR]', 'color:#a12c7b', err, topic);
    else          console.warn('[TU] Erro ao descodificar TripUpdate:', err.message, topic);
  }
}

function _toLong(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'low' in v) return v.low + v.high * 4294967296;
  return Number(v);
}

// ─── Diagnóstico ────────────────────────────────────────────────────────────

function _startDiag() {
  _diagTimer = setTimeout(() => {
    console.groupCollapsed(
      `%c[TU DIAG] Relatório após ${DIAG_MS / 1000}s`, 'color:#01696f;font-weight:bold'
    );
    console.log('Mensagens /gtfsrt/tu/ recebidas:', _msgCountTu);
    console.log('Total de mensagens no handler:',    _msgCountTotal);
    console.log('Trips em memória:',                  _byTrip.size);
    console.log('Paragens indexadas:',                _byStop.size);
    console.log('Amostra de tópicos recebidos:',     [..._topicsSeen]);

    if (_msgCountTu === 0) {
      console.warn(
        '%c[TU DIAG] ⚠ Nenhuma mensagem /gtfsrt/tu/ recebida em ' + (DIAG_MS / 1000) + 's.\n' +
        'O broker Porto Digital pode não publicar TripUpdates neste tópico.\n' +
        'O fallback HTTP continuará a ser usado para chegadas previstas.\n' +
        'Para diagnóstico manual: localStorage.setItem(\'MQTT_TU_DEBUG\', \'1\') e recarrega.',
        'color:#964219;font-weight:bold'
      );
      eventBus.emit('mqtt:tuNoData');
    } else {
      console.info(
        `%c[TU DIAG] ✅ ${_msgCountTu} mensagens TripUpdate recebidas, ` +
        `${_byTrip.size} trips, ${_byStop.size} paragens indexadas.`,
        'color:#437a22;font-weight:bold'
      );
    }
    console.groupEnd();
  }, DIAG_MS);
}

// ─── API pública ────────────────────────────────────────────────────────────

export const mqttTripUpdateService = {

  /**
   * Liga o handler de TripUpdate ao client MQTT já conectado.
   * Reutiliza a mesma ligação WebSocket do mqttVehicleService.
   *
   * @param {object} mqttClient  - client MQTT já conectado
   * @param {object} protoRoot   - raíz protobuf já carregada
   */
  attach(mqttClient, protoRoot) {
    if (_isActive) return;
    _isActive  = true;
    _protoRoot = protoRoot;

    // Handler de mensagens — interceta tópicos /tu/ antes do filtro do vehicleService
    mqttClient.on('message', (topic, payload) => {
      _msgCountTotal++;

      // Amostrar tópicos únicos para diagnóstico (máx 50)
      if (_topicsSeen.size < 50) {
        // Guardar apenas os primeiros 3 segmentos para não encher de ruído
        const prefix = topic.split('/').slice(0, 4).join('/');
        _topicsSeen.add(prefix);
      }

      if (!topic.startsWith('/gtfsrt/tu/')) return;

      _msgCountTu++;
      if (_debug() || _msgCountTu <= 3) {
        // Logar as primeiras 3 mensagens sempre (independente do debug)
        console.info(
          `%c[TU] Mensagem #${_msgCountTu} recebida: ${topic} (${payload.byteLength} bytes)`,
          'color:#0072C6;font-weight:bold'
        );
      }

      _processMessage(payload, topic);
    });

    // Subscrever o tópico TripUpdate
    mqttClient.subscribe(TOPIC_TU, { qos: 0 }, (err) => {
      if (err) {
        console.error('❌ Erro ao subscrever TripUpdate MQTT:', err);
        _isActive = false;
        return;
      }
      console.info(
        '%c📡 TripUpdate subscrito: ' + TOPIC_TU + '\n' +
        'Se não chegarem mensagens em 30s, o broker pode não publicar /tu/.\n' +
        'Diagnóstico automático em ' + (DIAG_MS / 1000) + 's.',
        'color:#01696f'
      );
      _startTtl();
      _startDiag();
    });
  },

  detach() {
    _isActive  = false;
    _protoRoot = null;
    _stopTtl();
    if (_diagTimer) { clearTimeout(_diagTimer); _diagTimer = null; }
    _byTrip.clear();
    _byStop.clear();
    _msgCountTu    = 0;
    _msgCountTotal = 0;
    _topicsSeen.clear();
  },

  getArrivalsForStop(stopId) {
    return _byStop.get(String(stopId)) || [];
  },

  hasDataForStop(stopId) {
    const list = _byStop.get(String(stopId));
    return !!(list?.length);
  },

  isActive() { return _isActive; },
  tripCount() { return _byTrip.size; },
  stopCount() { return _byStop.size; },

  /**
   * Relatório de diagnóstico para inspecção manual na consola.
   * Usar: mqttTripUpdateService.diagnose()
   */
  diagnose() {
    console.group('%c[TU DIAGNOSE]', 'color:#01696f;font-weight:bold');
    console.log('isActive:',          _isActive);
    console.log('protoRoot carregado:', !!_protoRoot);
    console.log('Msgs /tu/ recebidas:', _msgCountTu);
    console.log('Msgs total handler:',  _msgCountTotal);
    console.log('Trips em memória:',    _byTrip.size);
    console.log('Paragens indexadas:',  _byStop.size);
    console.log('Tópicos vistos:', [..._topicsSeen]);
    if (_byStop.size > 0) {
      console.log('Primeiras 5 paragens com dados:',
        [..._byStop.keys()].slice(0, 5).map(id => ({
          stopId: id,
          chegadas: _byStop.get(id)?.length
        }))
      );
    }
    console.groupEnd();
    return {
      isActive:   _isActive,
      msgCountTu: _msgCountTu,
      msgTotal:   _msgCountTotal,
      trips:      _byTrip.size,
      stops:      _byStop.size,
      topicsSeen: [..._topicsSeen],
    };
  },

  /**
   * Devolve o atraso em segundos para uma viagem na sua próxima paragem.
   * Retorna null se não houver dados disponíveis.
   * @param {string} tripId
   * @param {string} nextStopId - stopId da próxima paragem (do tópico MQTT)
   * @returns {number|null}
   */
  getDelayForTripAtStop(tripId, nextStopId) {
    if (!tripId || !nextStopId) return null;
    const meta = _byTrip.get(tripId);
    if (!meta) return null;
    const stu = meta.arrivals.find(a => a.stopId === String(nextStopId));
    return stu ? stu.delaySeconds : null;
  },

  /**
   * Devolve o atraso mínimo/mais próximo para uma viagem
   * (usa a primeira stop_time_update disponível em sequência).
   * @param {string} tripId
   * @returns {number|null}
   */
  getDelayForTrip(tripId) {
    if (!tripId) return null;
    const meta = _byTrip.get(tripId);
    if (!meta?.arrivals?.length) return null;
    // Ordenar por stopSequence e devolver o delay da primeira paragem futura
    const now = Math.floor(Date.now() / 1000);
    const future = meta.arrivals
        .filter(a => a.arrivalTime === 0 || a.arrivalTime > now - 30)
        .sort((a, b) => a.stopSequence - b.stopSequence);
    return future.length ? future[0].delaySeconds : null;
  },
};
