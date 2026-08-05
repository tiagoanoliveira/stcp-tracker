/**
 * Planned Arrivals Service — Chegadas em tempo real para uma paragem
 *
 * Estratégia (fonte primária: API Realtime STCP):
 *
 *   1. A API Realtime STCP é chamada primeiro (timeout 5 s).
 *      Se responder com dados → esses dados são usados directamente como
 *      chegadas em tempo real (is_realtime: true, com delay e status).
 *
 *   2. Se a API Realtime falhar ou devolver resposta vazia → fallback para
 *      OTP Porto Digital (GraphQL), tal como antes.
 *
 *   O OTP apenas é consultado quando a API Realtime não está disponível,
 *   garantindo que os dados apresentados são sempre os mais fiáveis.
 *
 * Cache:
 *   TTL de 4 s — ligeiramente inferior ao intervalo de refresh (5 s).
 *   forceRefresh=true ignora o cache completamente (botão + intervalo de 5 s).
 *
 * Debug:
 *   Activar: localStorage.setItem('ARRIVALS_DEBUG', '1') + recarregar
 *   Desactivar: localStorage.removeItem('ARRIVALS_DEBUG')
 */

import { otpService }  from './otpService.js';
import { stopService } from './stopService.js';
import { apiService }  from '../core/apiService.js';

const _cache              = new Map();
const CACHE_TTL           = 4_000;  // ms
const REALTIME_TIMEOUT_MS = 5_000;  // ms — ligeiramente mais generoso que antes

// ── Debug ────────────────────────────────────────────────────────────────────
const _dbg  = () => { try { return localStorage.getItem('ARRIVALS_DEBUG') === '1'; } catch { return false; } };
const _log  = (...a) => { if (_dbg()) console.log ('%c[ARRIVALS]', 'color:#006494;font-weight:bold', ...a); };
const _warn = (...a) => { if (_dbg()) console.warn('%c[ARRIVALS]', 'color:#964219;font-weight:bold', ...a); };
// Sempre visível (erros e avisos críticos)
const _info = (...a) => console.info('%c[ARRIVALS]', 'color:#437a22;font-weight:bold', ...a);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _resolveStopCode(stopId) {
  const cached = stopService.getStopById(stopId);
  if (cached?.stop_code) return cached.stop_code;
  try {
    const info = await apiService.fetchStopInfo(stopId);
    if (info?.stop_code) return info.stop_code;
  } catch { /* silencioso */ }
  return stopId;
}

function _withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function _extractRealtimeArrivals(response) {
  if (!response) return [];
  if (Array.isArray(response))          return response;
  if (Array.isArray(response.arrivals)) return response.arrivals;
  return [];
}

/**
 * Determina o estado com base no delay em segundos.
 *   ON_TIME  : -30 s a +30 s
 *   EARLY    : < -30 s
 *   DELAYED  : > +30 s
 */
function _deriveStatus(delaySeconds) {
  if (delaySeconds >  30) return 'DELAYED';
  if (delaySeconds < -30) return 'EARLY';
  return 'ON_TIME';
}

/**
 * Converte uma chegada da API Realtime STCP no formato canónico usado pelo UI.
 *
 * A API devolve campos como:
 *   route_number, headsign / trip_headsign, delay_minutes / delay_seconds / delay,
 *   arrival_time / scheduled_arrival / realtime_arrival,
 *   is_realtime, route_color, route_text_color, trip_id, direction_id
 *
 * O resultado segue o mesmo contrato dos dados OTP para que o NextArrivals.js
 * os renderize da mesma forma (delay badge colorido, ícone de localização, etc.).
 */
function _normalizeRealtimeArrival(raw) {
  const routeShortName = raw.route_short_name || raw.route_number || '';
  const tripHeadsign   = raw.trip_headsign    || raw.headsign     || '';
  const routeColor     = raw.route_color      || '#0072C6';
  const routeTextColor = raw.route_text_color || '#FFFFFF';
  const tripId         = raw.trip_id          || null;
  const directionId    = raw.directionId      ?? raw.direction_id ?? null;

  // Delay em segundos
  let delayS = null;
  if (raw.delay         != null) delayS = Number(raw.delay);
  else if (raw.delay_seconds != null) delayS = Number(raw.delay_seconds);
  else if (raw.delay_minutes != null) delayS = Number(raw.delay_minutes) * 60;

  // Tempo de chegada: converter para segundos a partir de agora
  const now = Date.now();
  let arrivalSeconds = null;
  let arrivalMinutes = null;

  // Tentar realtime_arrival ou scheduled_arrival como epoch (ms ou s) ou ISO string
  const rawTime = raw.realtime_arrival || raw.scheduled_arrival || raw.arrival_time;
  if (rawTime != null) {
    let epochMs = null;
    if (typeof rawTime === 'number') {
      // Heurística: se o valor for pequeno (< 1e10), assume segundos UNIX
      epochMs = rawTime < 1e10 ? rawTime * 1000 : rawTime;
    } else if (typeof rawTime === 'string') {
      const d = new Date(rawTime);
      if (!isNaN(d.getTime())) epochMs = d.getTime();
    }
    if (epochMs !== null) {
      const diffMs = epochMs - now;
      arrivalSeconds = Math.max(0, Math.round(diffMs / 1000));
      arrivalMinutes = Math.max(0, Math.round(diffMs / 60_000));
    }
  }

  // Se não conseguimos calcular o tempo de chegada a partir de timestamps,
  // tentar usar arrival_seconds / arrival_minutes directamente
  if (arrivalSeconds === null) {
    if (raw.arrival_seconds != null) {
      arrivalSeconds = Math.max(0, Number(raw.arrival_seconds));
      arrivalMinutes = Math.max(0, Math.round(arrivalSeconds / 60));
    } else if (raw.arrival_minutes != null) {
      arrivalMinutes = Math.max(0, Number(raw.arrival_minutes));
      arrivalSeconds = arrivalMinutes * 60;
    }
  }

  const isRealtime = Boolean(raw.is_realtime ?? (delayS !== null));
  const status     = isRealtime && delayS !== null ? _deriveStatus(delayS) : (isRealtime ? 'ON_TIME' : 'SCHEDULED');

  return {
    route_short_name:  routeShortName,
    route_color:       routeColor,
    route_text_color:  routeTextColor,
    trip_headsign:     tripHeadsign,
    arrival_seconds:   arrivalSeconds,
    arrival_minutes:   arrivalMinutes,
    trip_id:           tripId,
    status,
    delay:             delayS,
    delay_seconds:     delayS,
    delay_minutes:     delayS !== null ? Math.round(delayS / 60) : null,
    is_realtime:       isRealtime,
    directionId,
    _source:           'rt',
  };
}

/**
 * Normaliza chegadas OTP para o formato canónico (passthrough — o otpService
 * já devolve o formato correcto; apenas garantimos o campo _source).
 */
function _normalizeOtpArrival(a) {
  return {
    ...a,
    route_short_name:  a.route_short_name  || '',
    trip_headsign:     a.trip_headsign     || a.headsign || '',
    arrival_seconds:   a.arrival_seconds   ?? null,
    arrival_minutes:   a.arrival_minutes   ?? null,
    delay:             a.delay             ?? a.delay_seconds ?? null,
    delay_seconds:     a.delay_seconds     ?? a.delay         ?? null,
    delay_minutes:     a.delay_minutes     ?? null,
    is_realtime:       Boolean(a.is_realtime),
    _source:           'otp',
  };
}

// ── Serviço ──────────────────────────────────────────────────────────────────

class PlannedArrivalsService {

  async getNextArrivals(stopId, maxMinutes = 60, forceRefresh = false) {
    const cacheKey = `${stopId}:${maxMinutes}`;

    if (!forceRefresh) {
      const cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        _log(`cache HIT stopId:${stopId} idade:${Date.now() - cached.ts}ms`);
        return cached.data;
      }
    } else {
      _log(`forceRefresh=true — ignorar cache para stopId:${stopId}`);
    }

    _log(`getNextArrivals stopId:${stopId} maxMinutes:${maxMinutes}`);

    // ── 1. Tentar API Realtime (fonte primária) ───────────────────────────────
    const t0 = performance.now();
    let rtRaw = null;
    let rtFailed = false;

    try {
      rtRaw = await _withTimeout(apiService.fetchStopRealtime(stopId), REALTIME_TIMEOUT_MS);
    } catch (err) {
      rtFailed = true;
      const msg = err?.message || '';
      if (msg.includes('timeout')) {
        console.warn(`[ARRIVALS] API realtime timeout (>${REALTIME_TIMEOUT_MS}ms) — a usar OTP como fallback`);
      } else {
        console.warn('[ARRIVALS] API realtime falhou — a usar OTP como fallback:', msg);
      }
    }

    const rawRtArrivals = _extractRealtimeArrivals(rtRaw);
    const elapsed = Math.round(performance.now() - t0);

    // ── 2. Se a realtime devolveu dados → usar directamente ──────────────────
    if (!rtFailed && rawRtArrivals.length > 0) {
      _log(`API Realtime: ${rawRtArrivals.length} chegadas (${elapsed}ms) — a usar como fonte primária`);

      const result = rawRtArrivals
        .map(_normalizeRealtimeArrival)
        .filter(a => {
          // Filtrar chegadas fora da janela de maxMinutes
          if (a.arrival_minutes === null) return true; // sem tempo calculado → incluir
          return a.arrival_minutes <= maxMinutes;
        })
        .sort((a, b) => {
          const sA = a.arrival_seconds ?? (a.arrival_minutes ?? Infinity) * 60;
          const sB = b.arrival_seconds ?? (b.arrival_minutes ?? Infinity) * 60;
          return sA - sB;
        });

      if (_dbg()) {
        result.forEach(a =>
          _log(`  RT linha:${a.route_short_name} trip:${a.trip_id} rt:${a.is_realtime} delay:${a.delay} status:${a.status}`)
        );
      }

      if (result.length > 0) {
        _cache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      }
      // Se após normalização ficou vazio, continua para o OTP
      _log('API Realtime devolveu dados mas todos foram filtrados — a usar OTP como fallback');
    } else if (!rtFailed && rawRtArrivals.length === 0) {
      _log('API Realtime devolveu resposta vazia — a usar OTP como fallback');
    }

    // ── 3. Fallback: OTP Porto Digital ───────────────────────────────────────
    const stopCode = await _resolveStopCode(stopId);
    _log(`OTP fallback stopId:${stopId} stopCode:${stopCode}`);

    let otpRaw = [];
    try {
      otpRaw = await otpService.getArrivalsForStop(stopCode, maxMinutes);
      _log(`OTP: ${otpRaw.length} chegadas`);
    } catch (err) {
      console.warn('[ARRIVALS] OTP falhou:', err?.message);
    }

    const result = (otpRaw || []).map(_normalizeOtpArrival);

    if (_dbg()) {
      result.forEach(a =>
        _log(`  OTP linha:${a.route_short_name} trip:${a.trip_id} rt:${a.is_realtime} delay:${a.delay}`)
      );
    }

    if (result.length > 0) {
      _cache.set(cacheKey, { data: result, ts: Date.now() });
    } else if (!forceRefresh) {
      const stale = _cache.get(cacheKey);
      if (stale) {
        _warn(`resultado vazio — devolver cache stale (${Date.now() - stale.ts}ms antigo)`);
        return stale.data;
      }
    }

    return result;
  }

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
