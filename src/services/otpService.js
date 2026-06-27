/**
 * OTP Service — Chegadas em tempo real via OpenTripPlanner (Porto Digital)
 *
 * O site oficial do Porto Digital obtém chegadas previstas através de:
 *   POST https://otp.portodigital.pt/otp/gtfs/v1
 *   Content-Type: application/json
 *   Body: { "query": "{ ... GraphQL ... }" }
 *
 * A query GraphQL pede stopTimes por stopId GTFS, que inclui:
 *   - scheduledArrival   (segundos desde meia-noite)
 *   - realtimeArrival    (segundos desde meia-noite, com desvio)
 *   - arrivalDelay       (segundos, + = atrasado)
 *   - realtime           (boolean)
 *   - trip { route { shortName, color }, headsign, tripId }
 *
 * ─── STOPID ─────────────────────────────────────────────────────────────────
 *
 * O OTP usa o stopId no formato GTFS: "STCP:{stopCode}"
 * Exemplo: paragem "200012" → OTP stopId "STCP:200012"
 * Se o stopId já vier com prefixo, é usado tal qual.
 *
 * ─── CACHE ──────────────────────────────────────────────────────────────────
 *
 * Cache por paragem com TTL de 20s (dados em tempo real mudam rapidamente).
 *
 * ─── DEBUG ──────────────────────────────────────────────────────────────────
 *
 * localStorage.setItem('OTP_DEBUG', '1')  → activar logs
 * otpService.diagnose()                   → relatório de estado
 */

const OTP_ENDPOINT = 'https://otp.portodigital.pt/otp/gtfs/v1';
const CACHE_TTL    = 20_000; // ms
const MAX_RESULTS  = 12;     // máximo de chegadas por pedido

// Cache: stopId → { data: TripArrival[], ts: Date.now() }
const _cache = new Map();

let _totalRequests  = 0;
let _totalErrors    = 0;
let _totalCacheHits = 0;

const _debug = () => {
  try { return localStorage.getItem('OTP_DEBUG') === '1'; } catch { return false; }
};

/**
 * Normaliza stopId para o formato GTFS que o OTP usa.
 * "200012"      → "STCP:200012"
 * "STCP:200012" → "STCP:200012"  (passthrough)
 */
function _normalizeStopId(stopId) {
  const s = String(stopId);
  return s.startsWith('STCP:') ? s : `STCP:${s}`;
}

/**
 * Constrói a query GraphQL para uma paragem.
 * Usa a mesma estrutura que o site oficial do Porto Digital.
 */
function _buildQuery(otpStopId, numberOfArrivals) {
  return {
    query: `{
      stop(id: "${otpStopId}") {
        name
        stoptimesWithoutPatterns(
          numberOfDepartures: ${numberOfArrivals}
          timeRange: 3600
          omitCanceled: false
        ) {
          scheduledArrival
          realtimeArrival
          arrivalDelay
          realtime
          serviceDay
          headsign
          trip {
            gtfsId
            route {
              shortName
              color
              textColor
            }
          }
        }
      }
    }`,
  };
}

/**
 * Converte segundos-desde-meia-noite + serviceDay em Unix timestamp (s).
 * serviceDay é o timestamp Unix do início do dia de serviço (meia-noite).
 */
function _toUnixTs(secondsSinceMidnight, serviceDay) {
  return (serviceDay || 0) + secondsSinceMidnight;
}

/**
 * Formata segundos-desde-meia-noite como "HH:MM".
 * Suporta horários após 24h (ex: 25:30 → "01:30" do dia seguinte).
 */
function _formatTime(secondsSinceMidnight) {
  const totalMins = Math.floor(secondsSinceMidnight / 60);
  const hh = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
  const mm = String(totalMins % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Faz o pedido ao OTP e converte a resposta para o formato interno.
 *
 * @param {string} stopId  - ID da paragem (com ou sem prefixo "STCP:")
 * @param {number} maxMinutes - janela de tempo em minutos
 * @returns {Promise<Array>} array de chegadas ordenado por arrival_minutes
 */
async function _fetchFromOtp(stopId, maxMinutes) {
  const otpStopId = _normalizeStopId(stopId);
  const body      = _buildQuery(otpStopId, MAX_RESULTS);

  if (_debug()) console.group(`%c[OTP] POST ${OTP_ENDPOINT} stopId=${otpStopId}`, 'color:#006494');

  const response = await fetch(OTP_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`OTP HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();

  if (_debug()) {
    console.log('Resposta OTP:', json);
    console.groupEnd();
  }

  // Verificar erros GraphQL
  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    throw new Error(`OTP GraphQL error: ${msg}`);
  }

  const stopData   = json.data?.stop;
  const stoptimes  = stopData?.stoptimesWithoutPatterns || [];

  if (!stoptimes.length) {
    if (_debug()) console.warn(`[OTP] Sem stoptimes para ${otpStopId}`);
    return [];
  }

  const now        = Math.floor(Date.now() / 1000);
  const maxSeconds = maxMinutes * 60;
  const results    = [];

  for (const st of stoptimes) {
    const serviceDay     = st.serviceDay || 0;
    const arrivalUnix    = _toUnixTs(st.realtimeArrival ?? st.scheduledArrival, serviceDay);
    const diffSeconds    = arrivalUnix - now;
    const arrivalMinutes = Math.round(diffSeconds / 60);

    if (arrivalMinutes < -1 || diffSeconds > maxSeconds) continue;

    const route      = st.trip?.route || {};
    const rawColor   = route.color ? `#${route.color.replace(/^#/, '')}` : '#0072C6';
    const rawText    = route.textColor ? `#${route.textColor.replace(/^#/, '')}` : '#FFFFFF';
    const delayS     = st.arrivalDelay || 0;

    results.push({
      route_short_name: route.shortName || '?',
      route_color:      rawColor,
      route_text_color: rawText,
      trip_headsign:    st.headsign || '',
      arrival_minutes:  Math.max(0, arrivalMinutes),
      arrival_time:     _formatTime(st.realtimeArrival ?? st.scheduledArrival),
      trip_id:          st.trip?.gtfsId || null,
      status:           st.realtime ? 'REALTIME' : 'SCHEDULED',
      delay_minutes:    Math.round(delayS / 60),
      delay_seconds:    delayS,
      is_realtime:      !!st.realtime,
      source:           'otp',
    });
  }

  return results.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
}

export const otpService = {

  /**
   * Obtém próximas chegadas para uma paragem via OTP GraphQL.
   * Usa cache com TTL de 20s para evitar pedidos duplicados.
   *
   * @param {string} stopId
   * @param {number} maxMinutes
   * @returns {Promise<Array>}
   */
  async getArrivalsForStop(stopId, maxMinutes = 60) {
    const cacheKey = `${stopId}:${maxMinutes}`;
    const cached   = _cache.get(cacheKey);

    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      _totalCacheHits++;
      if (_debug()) console.log(`%c[OTP] cache hit para ${stopId}`, 'color:#437a22');
      return cached.data;
    }

    _totalRequests++;

    try {
      const data = await _fetchFromOtp(stopId, maxMinutes);
      _cache.set(cacheKey, { data, ts: Date.now() });

      if (_debug()) {
        console.info(
          `%c[OTP] ✅ ${stopId}: ${data.length} chegadas obtidas`,
          'color:#437a22'
        );
      }

      return data;
    } catch (err) {
      _totalErrors++;
      console.warn(`[OTP] Erro ao obter chegadas para ${stopId}:`, err.message);
      // Devolver cache expirado se existir (melhor que nada)
      if (cached) {
        console.info(`[OTP] A usar cache expirado para ${stopId}`);
        return cached.data;
      }
      return [];
    }
  },

  clearCache() {
    _cache.clear();
  },

  diagnose() {
    console.group('%c[OTP DIAGNOSE]', 'color:#01696f;font-weight:bold');
    console.log('Endpoint:', OTP_ENDPOINT);
    console.log('Total de pedidos:', _totalRequests);
    console.log('Erros:', _totalErrors);
    console.log('Cache hits:', _totalCacheHits);
    console.log('Entradas em cache:', _cache.size);
    console.groupEnd();
    return { requests: _totalRequests, errors: _totalErrors, cacheHits: _totalCacheHits };
  },
};
