/**
 * OTP Service — Chegadas em tempo real via OpenTripPlanner (Porto Digital)
 *
 * O site oficial do Porto Digital obtém chegadas previstas através de:
 *   POST https://otp.portodigital.pt/otp/gtfs/v1
 *   Content-Type: application/json
 *   Body: { "query": "{ ... GraphQL ... }" }
 *
 * ─── STOPID ─────────────────────────────────────────────────────────────────
 *
 * O OTP Porto Digital usa o formato:  "2:{stopCode}"
 * onde:
 *   "2"         = feedId (sempre 2 para STCP no Porto Digital)
 *   {stopCode}  = código alfanumérico da paragem, ex: "BS1", "CD", "BO"
 *
 * ERRADO:  "STCP:200012"  (código numérico — devolve {stop: null})
 * CORRETO: "2:BS1"        (feedId + código alfanumérico)
 *
 * O caller deve passar o stop_code alfanumérico (ex: "BS1").
 * O stop_id numérico (ex: "200012") NÃO funciona neste OTP.
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
const OTP_FEED_ID  = '2';   // feedId STCP no broker Porto Digital
const CACHE_TTL    = 20_000; // ms
const MAX_RESULTS  = 12;     // máximo de chegadas por pedido

// Cache: cacheKey → { data: TripArrival[], ts: Date.now() }
const _cache = new Map();

let _totalRequests  = 0;
let _totalErrors    = 0;
let _totalCacheHits = 0;

const _debug = () => {
  try { return localStorage.getItem('OTP_DEBUG') === '1'; } catch { return false; }
};

/**
 * Normaliza o stopCode para o formato OTP Porto Digital: "2:{stopCode}".
 *
 * Aceita:
 *   "BS1"          → "2:BS1"     (código alfanumérico sem prefixo)
 *   "2:BS1"        → "2:BS1"     (já no formato correto — passthrough)
 *   "STCP:BS1"     → "2:BS1"     (prefixo errado — corrigido)
 *   "STCP:200012"  → null        (código numérico — não funciona no OTP)
 *   "200012"       → null        (código numérico — não funciona no OTP)
 *
 * Devolve null se o stopCode for puramente numérico (inválido para este OTP).
 *
 * @param {string} stopCode
 * @returns {string|null}
 */
function _normalizeStopId(stopCode) {
  if (!stopCode) return null;

  let code = String(stopCode).trim();

  // Remover prefixos conhecidos
  if (code.startsWith('2:'))    code = code.slice(2);
  if (code.startsWith('STCP:')) code = code.slice(5);

  // Código puramente numérico → inválido para este OTP
  if (/^\d+$/.test(code)) {
    if (_debug()) console.warn(`[OTP] stopCode numérico "${code}" inválido — usar stop_code alfanumérico`);
    return null;
  }

  return `${OTP_FEED_ID}:${code}`;
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
 * @param {string} stopCode   - código alfanumérico da paragem (ex: "BS1")
 * @param {number} maxMinutes - janela de tempo em minutos
 * @returns {Promise<Array>}  array de chegadas ordenado por arrival_minutes
 */
async function _fetchFromOtp(stopCode, maxMinutes) {
  const otpStopId = _normalizeStopId(stopCode);
  if (!otpStopId) {
    if (_debug()) console.warn(`[OTP] stopCode inválido: "${stopCode}" — a ignorar`);
    return [];
  }

  const body = _buildQuery(otpStopId, MAX_RESULTS);

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

  const stopData  = json.data?.stop;
  const stoptimes = stopData?.stoptimesWithoutPatterns || [];

  // {stop: null} = stopCode inválido ou não encontrado no OTP
  if (!stopData) {
    if (_debug()) console.warn(`[OTP] {stop: null} para "${otpStopId}" — stopCode não encontrado no OTP`);
    return [];
  }

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

    const route    = st.trip?.route || {};
    const rawColor = route.color ? `#${route.color.replace(/^#/, '')}` : '#0072C6';
    const rawText  = route.textColor ? `#${route.textColor.replace(/^#/, '')}` : '#FFFFFF';
    const delayS   = st.arrivalDelay || 0;

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
   *
   * IMPORTANTE: stopId deve ser o stop_code alfanumérico (ex: "BS1"),
   * não o ID numérico (ex: "200012"). O OTP Porto Digital usa o formato
   * "2:{stopCode}" — IDs numéricos devolvem {stop: null}.
   *
   * @param {string} stopId     - stop_code alfanumérico da paragem
   * @param {number} maxMinutes - janela de tempo em minutos
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
    console.log('Feed ID:', OTP_FEED_ID);
    console.log('Formato stopId esperado: "2:{stopCode}" (ex: "2:BS1")');
    console.log('Total de pedidos:', _totalRequests);
    console.log('Erros:', _totalErrors);
    console.log('Cache hits:', _totalCacheHits);
    console.log('Entradas em cache:', _cache.size);
    console.groupEnd();
    return { requests: _totalRequests, errors: _totalErrors, cacheHits: _totalCacheHits };
  },
};
