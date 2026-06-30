/**
 * Planned Arrivals Service — Chegadas planeadas e em tempo real para uma paragem
 *
 * Estratégia de obtenção de chegadas (por ordem de prioridade):
 *
 *   1. OTP Porto Digital (GraphQL) — tempo real via GTFS-RT
 *      Endpoint: POST https://otp.portodigital.pt/otp/gtfs/v1
 *      IMPORTANTE: o OTP usa stop_code alfanumérico (ex: "BS1"), NÃO o ID numérico.
 *      Por isso, este serviço passa sempre stop.stop_code ao otpService.
 *
 *   2. API STCP legacy (HTTP) — horários programados
 *      Fallback se o OTP falhar ou devolver zero chegadas.
 *
 * ─── MAPEAMENTO DE STOP IDs ───────────────────────────────────────────────
 *
 *   stop_id   (ex: "200012") — ID numérico interno usado pelo FIWARE / API STCP
 *   stop_code (ex: "BS1")   — código alfanumérico visível ao utilizador
 *
 *   O OTP Porto Digital requer stop_code; o FIWARE usa stop_id.
 *   Este serviço tenta obter stop_code a partir do stopService; se falhar,
 *   usa stop_id como fallback (o que resultará em {stop: null} no OTP — inofensivo).
 */

import { otpService }  from './otpService.js';
import { stopService } from './stopService.js';
import { apiService }  from '../core/apiService.js';

const _cache    = new Map();
const CACHE_TTL = 20_000; // ms

/**
 * Tenta obter o stop_code alfanumérico de uma paragem.
 * Consulta o cache do stopService primeiro (sem hit de rede).
 * Devolve o stop_code se encontrado, ou o stopId original como fallback.
 *
 * @param {string} stopId  - stop_id numérico ou alfanumérico
 * @returns {Promise<string>} stop_code para passar ao OTP
 */
async function _resolveStopCode(stopId) {
  // 1. Cache local do stopService (sem rede)
  const cached = stopService.getStopById(stopId);
  if (cached?.stop_code) return cached.stop_code;

  // 2. Pedir ao apiService o detalhe da paragem
  try {
    const info = await apiService.fetchStopInfo(stopId);
    if (info?.stop_code) return info.stop_code;
  } catch { /* silencioso */ }

  // 3. Fallback: usar o próprio stopId
  return stopId;
}

class PlannedArrivalsService {

  /**
   * Obtém próximas chegadas para uma paragem.
   *
   * Tenta OTP primeiro (tempo real), com fallback para API STCP.
   *
   * @param {string} stopId     - ID da paragem (numérico ou alfanumérico)
   * @param {number} maxMinutes - janela de tempo em minutos
   * @returns {Promise<Array>}  array de chegadas normalizado
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    const cacheKey = `${stopId}:${maxMinutes}`;
    const cached   = _cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) return cached.data;

    const stopCode = await _resolveStopCode(stopId);
    let otpArrivals  = [];
    let otpFailed    = false;

    try {
      otpArrivals = await otpService.getArrivalsForStop(stopCode, maxMinutes);
    } catch (err) {
      console.warn('[PlannedArrivals] OTP falhou:', err.message);
      otpFailed = true;
    }

    // Se OTP devolveu chegadas mas nenhuma com is_realtime,
    // tentar enriquecer com dados da API legacy
    const hasRealtime = otpArrivals.some(a => a.is_realtime === true);

    if (!hasRealtime) {
      try {
        const legacyArrivals = await this._fetchLegacy(stopId, maxMinutes);
        // Merge: para cada chegada OTP sem realtime, verificar se a API tem realtime para a mesma linha
        if (otpArrivals.length > 0 && legacyArrivals.length > 0) {
          const legacyMap = new Map();
          legacyArrivals.forEach(a => {
            if (a.is_realtime) {
              const key = String(a.route_short_name || a.route_number || a.route_id || '');
              if (!legacyMap.has(key)) legacyMap.set(key, []);
              legacyMap.get(key).push(a);
            }
          });
          // Substituir chegadas OTP sem realtime por equivalentes da API com realtime
          const merged = otpArrivals.map(a => {
            if (a.is_realtime) return a;
            const key     = String(a.route_short_name || '');
            const apiOpts = legacyMap.get(key);
            if (apiOpts?.length > 0) return { ...a, ...apiOpts.shift(), is_realtime: true };
            return a;
          });
          _cache.set(cacheKey, { data: merged, ts: Date.now() });
          return merged;
        }
        // OTP falhou completamente → usar só a API legacy
        if (otpFailed || otpArrivals.length === 0) {
          _cache.set(cacheKey, { data: legacyArrivals, ts: Date.now() });
          return legacyArrivals;
        }
      } catch (err) {
        console.warn('[PlannedArrivals] API legacy também falhou:', err.message);
      }
    }

    if (otpArrivals.length > 0) {
      _cache.set(cacheKey, { data: otpArrivals, ts: Date.now() });
      return otpArrivals;
    }

    if (cached) return cached.data;
    return [];
  }

  /**
   * Fallback: obtém chegadas via API STCP (horários programados).
   * @private
   */
  async _fetchLegacy(stopId, maxMinutes) {
    const response = await apiService.fetchNextArrivals(stopId, maxMinutes);
    const arrivals = response?.arrivals || response || [];
    return Array.isArray(arrivals) ? arrivals : [];
  }

  clearCache() {
    _cache.clear();
    otpService.clearCache();
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
