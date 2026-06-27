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

    // Resolver stop_code alfanumérico para o OTP
    const stopCode = await _resolveStopCode(stopId);

    // Tentar OTP primeiro
    try {
      const otpArrivals = await otpService.getArrivalsForStop(stopCode, maxMinutes);
      if (otpArrivals.length > 0) {
        _cache.set(cacheKey, { data: otpArrivals, ts: Date.now() });
        return otpArrivals;
      }
    } catch (err) {
      console.warn('[PlannedArrivals] OTP falhou, a tentar fallback:', err.message);
    }

    // Fallback: API STCP
    try {
      const legacyArrivals = await this._fetchLegacy(stopId, maxMinutes);
      _cache.set(cacheKey, { data: legacyArrivals, ts: Date.now() });
      return legacyArrivals;
    } catch (err) {
      console.error('[PlannedArrivals] Fallback legacy também falhou:', err.message);
      if (cached) return cached.data;
      return [];
    }
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
