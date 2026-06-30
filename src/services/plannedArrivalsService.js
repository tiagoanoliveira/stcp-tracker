/**
 * Planned Arrivals Service — Chegadas planeadas e em tempo real para uma paragem
 *
 * Estratégia:
 *
 *   OTP Porto Digital (GraphQL) e API Realtime STCP são chamados SEMPRE em
 *   paralelo. O resultado é cruzado para obter o máximo de tempos reais:
 *
 *     - Se apenas o OTP responde  → usar dados OTP.
 *     - Se apenas a realtime responde  → usar dados realtime.
 *     - Se ambos respondem  → merge por route_short_name:
 *         · Estrutura base vem do OTP (trip_id, headsign, etc.).
 *         · delay e tempo real (is_realtime, realtime_arrival) são
 *           substituídos pelos da API realtime quando disponíveis
 *           (geralmente mais frescos/precisos).
 *
 *   A API realtime tem um timeout de 3 segundos; se demorar mais,
 *   usa-se apenas o OTP.
 *
 * Cache:
 *   TTL de 4s — ligeiramente inferior ao intervalo de refresh (5s) para
 *   garantir que cada ciclo faz um fetch real à rede.
 *   O botão de refresh chama clearCache() antes de getNextArrivals()
 *   para forçar fetch imediato independentemente do TTL.
 *
 * Mapeamento de IDs:
 *   stop_id   (ex: "200012") — ID numérico interno (FIWARE / API STCP)
 *   stop_code (ex: "BS1")   — código alfanumérico exigido pelo OTP Porto Digital
 */

import { otpService }  from './otpService.js';
import { stopService } from './stopService.js';
import { apiService }  from '../core/apiService.js';

const _cache               = new Map();
const CACHE_TTL            = 4_000;   // ms — < intervalo de refresh (5s)
const REALTIME_TIMEOUT_MS  = 3_000;   // ms — timeout da API realtime

/**
 * Resolve o stop_code alfanumérico necessário pelo OTP.
 * @param {string} stopId
 * @returns {Promise<string>}
 */
async function _resolveStopCode(stopId) {
  const cached = stopService.getStopById(stopId);
  if (cached?.stop_code) return cached.stop_code;
  try {
    const info = await apiService.fetchStopInfo(stopId);
    if (info?.stop_code) return info.stop_code;
  } catch { /* silencioso */ }
  return stopId;
}

/**
 * Wraps uma promise com timeout. Rejeita com Error('timeout') se demorar mais
 * de `ms` milissegundos.
 * @param {Promise} promise
 * @param {number}  ms
 * @returns {Promise}
 */
function _withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Normaliza um array de chegadas para garantir que os campos essenciais
 * estão presentes.
 * @param {Array} arrivals
 * @returns {Array}
 */
function _normalize(arrivals) {
  if (!Array.isArray(arrivals)) return [];
  return arrivals.map(a => ({
    route_short_name: a.route_short_name || a.route_number || '',
    trip_id:          a.trip_id          || null,
    headsign:         a.headsign         || a.trip_headsign || '',
    scheduled_arrival:a.scheduled_arrival|| a.arrival_time  || null,
    realtime_arrival: a.realtime_arrival  || null,
    delay:            a.delay            ?? null,
    is_realtime:      a.is_realtime       || false,
    directionId:      a.directionId       ?? a.direction_id ?? null,
    ...a, // preservar campos extra
  }));
}

/**
 * Faz merge das chegadas OTP com as da API realtime.
 *
 * Regra de merge por route_short_name (1 linha pode ter várias chegadas):
 *   - Para cada chegada OTP, tentar encontrar uma chegada realtime da mesma
 *     linha com tempo aproximadamente igual (±2 min).
 *   - Se match encontrado: substituir delay e realtime_arrival pelo da API.
 *   - Se sem match: manter chegada OTP intacta.
 *   - Chegadas realtime sem correspondência OTP são adicionadas no fim.
 *
 * @param {Array} otpArr      - chegadas normalizadas do OTP
 * @param {Array} realtimeArr - chegadas normalizadas da API realtime
 * @returns {Array}
 */
function _merge(otpArr, realtimeArr) {
  if (!otpArr.length)      return realtimeArr;
  if (!realtimeArr.length) return otpArr;

  // Agrupar realtime por linha para lookup rápido
  const rtByLine = new Map();
  for (const a of realtimeArr) {
    const key = String(a.route_short_name || '');
    if (!rtByLine.has(key)) rtByLine.set(key, []);
    rtByLine.get(key).push(a);
  }

  const usedRt  = new Set();
  const merged  = otpArr.map(otp => {
    const key       = String(otp.route_short_name || '');
    const rtOptions = rtByLine.get(key) || [];

    // Tentar match por proximidade temporal (±2 min)
    const otpEpoch = _toEpoch(otp.realtime_arrival || otp.scheduled_arrival);
    const match    = rtOptions.find((rt, i) => {
      if (usedRt.has(i + ':' + key)) return false;
      const rtEpoch = _toEpoch(rt.realtime_arrival || rt.scheduled_arrival);
      return otpEpoch !== null && rtEpoch !== null && Math.abs(otpEpoch - rtEpoch) <= 120_000;
    });

    if (match) {
      const matchIdx = rtOptions.indexOf(match);
      usedRt.add(matchIdx + ':' + key);
      // Manter estrutura OTP; substituir apenas campos de tempo real
      return {
        ...otp,
        delay:            match.delay            ?? otp.delay,
        realtime_arrival: match.realtime_arrival  || otp.realtime_arrival,
        is_realtime:      match.is_realtime       || otp.is_realtime,
      };
    }

    return otp;
  });

  // Adicionar chegadas realtime que não tiveram match OTP
  for (const [key, rtOptions] of rtByLine.entries()) {
    rtOptions.forEach((rt, i) => {
      if (!usedRt.has(i + ':' + key)) merged.push(rt);
    });
  }

  // Ordenar por tempo de chegada (realtime > scheduled)
  merged.sort((a, b) => {
    const tA = _toEpoch(a.realtime_arrival || a.scheduled_arrival);
    const tB = _toEpoch(b.realtime_arrival || b.scheduled_arrival);
    if (tA === null && tB === null) return 0;
    if (tA === null) return 1;
    if (tB === null) return -1;
    return tA - tB;
  });

  return merged;
}

/**
 * Converte um tempo (string ISO, epoch ms, ou Date) para epoch ms.
 * Devolve null se inválido.
 * @param {*} value
 * @returns {number|null}
 */
function _toEpoch(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number')             return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.getTime();
}

class PlannedArrivalsService {

  /**
   * Obtém próximas chegadas para uma paragem, cruzando OTP e API realtime.
   *
   * @param {string}  stopId      - ID da paragem (numérico ou alfanumérico)
   * @param {number}  maxMinutes  - janela de tempo em minutos
   * @param {boolean} forceRefresh - ignorar cache e forçar fetch à rede
   * @returns {Promise<Array>}
   */
  async getNextArrivals(stopId, maxMinutes = 60, forceRefresh = false) {
    const cacheKey = `${stopId}:${maxMinutes}`;

    if (!forceRefresh) {
      const cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < CACHE_TTL) return cached.data;
    }

    const stopCode = await _resolveStopCode(stopId);

    // Lançar OTP e realtime em paralelo
    const [otpResult, rtResult] = await Promise.allSettled([
      otpService.getArrivalsForStop(stopCode, maxMinutes),
      _withTimeout(
        apiService.fetchNextArrivals(stopId, maxMinutes),
        REALTIME_TIMEOUT_MS
      ),
    ]);

    const otpArrivals = otpResult.status === 'fulfilled'
      ? _normalize(otpResult.value || [])
      : [];

    const rtArrivals  = rtResult.status === 'fulfilled'
      ? _normalize((rtResult.value?.arrivals || rtResult.value) || [])
      : [];

    if (otpResult.status === 'rejected') {
      console.warn('[PlannedArrivals] OTP falhou:', otpResult.reason?.message);
    }
    if (rtResult.status === 'rejected') {
      const reason = rtResult.reason?.message || '';
      if (reason.includes('timeout')) {
        console.warn(`[PlannedArrivals] API realtime timeout (>${REALTIME_TIMEOUT_MS}ms) — usar apenas OTP`);
      } else {
        console.warn('[PlannedArrivals] API realtime falhou:', reason);
      }
    }

    const result = _merge(otpArrivals, rtArrivals);

    // Só cachear se tivermos dados úteis
    if (result.length > 0) {
      _cache.set(cacheKey, { data: result, ts: Date.now() });
    } else if (!forceRefresh) {
      // Sem dados novos: devolver cache antigo se existir
      const stale = _cache.get(cacheKey);
      if (stale) return stale.data;
    }

    return result;
  }

  /**
   * Limpa o cache para uma paragem específica (ou todo o cache).
   * Deve ser chamado antes de getNextArrivals() quando se quer forçar
   * um fetch imediato (botão de refresh, mudança de paragem).
   * @param {string} [stopId] - se omitido, limpa todo o cache
   */
  clearCache(stopId) {
    if (stopId) {
      for (const key of _cache.keys()) {
        if (key.startsWith(stopId + ':')) _cache.delete(key);
      }
    } else {
      _cache.clear();
    }
    otpService.clearCache?.();
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
