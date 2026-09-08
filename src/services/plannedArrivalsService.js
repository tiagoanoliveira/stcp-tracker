/**
 * Planned Arrivals Service — Chegadas planeadas e em tempo real para uma paragem
 *
 * Estratégia:
 *
 *   OTP Porto Digital (GraphQL) e API Realtime STCP são chamados SEMPRE em
 *   paralelo. O resultado é cruzado para obter o máximo de tempos reais:
 *
 *     - Se apenas o OTP responde         → usar dados OTP.
 *     - Se apenas a realtime responde    → usar dados realtime.
 *     - Se ambos respondem               → merge por route_short_name ±5 min:
 *         · Estrutura base vem do OTP (trip_id, headsign, etc.).
 *         · delay e realtime_arrival substituídos pelos da API.
 *     - Chegadas RT sem match OTP        → só adicionadas se a linha NÃO tiver
 *         NENHUMA chegada OTP (veículos que o OTP genuinamente não conhece).
 *         Chegadas RT de linhas que o OTP já tem → descartadas para evitar
 *         duplicados que aparecem como "planeados" no fundo da lista.
 *
 *   A API realtime tem timeout de 3 s; se demorar mais, usa-se apenas OTP.
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
import { vehicleService } from './vehicleService.js';

const _cache              = new Map();
const CACHE_TTL           = 4_000;  // ms
const REALTIME_TIMEOUT_MS = 3_000;  // ms
// Janela de match entre chegadas OTP e RT (em ms). Alargada de 2 min para
// 5 min para cobrir casos onde o atraso causa desvio superior a 2 min.
const MATCH_WINDOW_MS     = 5 * 60_000;

// ── Debug ────────────────────────────────────────────────────────────────────
const _dbg  = () => { try { return localStorage.getItem('ARRIVALS_DEBUG') === '1'; } catch { return false; } };
const _log  = (...a) => { if (_dbg()) console.log ('%c[ARRIVALS]', 'color:#006494;font-weight:bold', ...a); };
const _warn = (...a) => { if (_dbg()) console.warn('%c[ARRIVALS]', 'color:#964219;font-weight:bold', ...a); };
// Sempre visível (erros e avisos críticos)
const _info = (...a) => console.info('%c[ARRIVALS]', 'color:#437a22;font-weight:bold', ...a);

// ── Helpers ──────────────────────────────────────────────────────────────────

function _formatLocalYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _shiftDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function _extractServiceDateParts(scheduleDate, fallbackDate) {
  if (/^\d{8}$/.test(scheduleDate || '')) {
    return {
      year: Number(scheduleDate.slice(0, 4)),
      month: Number(scheduleDate.slice(4, 6)) - 1,
      day: Number(scheduleDate.slice(6, 8)),
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate || '')) {
    const [y, m, d] = scheduleDate.split('-').map(Number);
    return { year: y, month: m - 1, day: d };
  }

  return {
    year: fallbackDate.getFullYear(),
    month: fallbackDate.getMonth(),
    day: fallbackDate.getDate(),
  };
}

async function _resolveStopCode(stopId) {
  const cached = stopService.getStopById(stopId);
  if (cached?.stop_code) return cached.stop_code;
  try {
    const info = (stopService.isUnirStop(stopId) ? await apiService.fetchGtfsStopInfo(stopId) : await apiService.fetchStopInfo(stopId));
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

/**
 * Normaliza uma chegada para campos canónicos.
 */
function _normalizeOne(a) {
  const scheduledIso =
      a.scheduled_arrival ||
      a.arrival_time ||
      (a.scheduled_arrival_epoch ? new Date(a.scheduled_arrival_epoch * 1000).toISOString() : null);

  const realtimeIso =
      a.realtime_arrival ||
      (a.realtime_arrival_epoch ? new Date(a.realtime_arrival_epoch * 1000).toISOString() : null) ||
      null;

  return {
    ...a,
    route_short_name:  a.route_short_name || a.route_number || '',
    trip_id:           a.trip_id || null,
    vehicle_id:        a.vehicle_id || null,
    headsign:          a.headsign || a.trip_headsign || '',
    scheduled_arrival: scheduledIso,
    realtime_arrival:  realtimeIso,
    delay: a.delay
        ?? a.delay_seconds
        ?? (a.delay_minutes != null ? Number(a.delay_minutes) * 60 : null),
    is_realtime:       Boolean(a.is_realtime),
    directionId:       a.directionId ?? a.direction_id ?? null,
    _source:           a._source || 'unknown',
  };
}

function _normalize(arrivals) {
  if (!Array.isArray(arrivals)) return [];
  return arrivals.map(_normalizeOne);
}

function _extractRealtimeArrivals(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.arrivals)) return response.arrivals;
  if (Array.isArray(response.realtime)) return response.realtime;
  return [];
}

function _toEpoch(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number')             return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Merge de chegadas OTP com chegadas da API realtime.
 *
 * Passos:
 *  1. Para cada chegada OTP tenta match com uma chegada RT da mesma linha
 *     dentro da janela MATCH_WINDOW_MS (5 min).
 *     Se encontrado → substitui delay/realtime_arrival/is_realtime pela RT.
 *  2. Chegadas RT sem match OTP → só adicionadas se a linha NÃO tiver
 *     NENHUMA chegada OTP. Isto evita duplicados quando o OTP já conhece
 *     a linha mas a timestamp RT difere ligeiramente (apareciam como
 *     entradas «planeadas» no fundo da lista).
 *  3. Resultado ordenado por tempo de chegada.
 */
function _merge(otpArr, realtimeArr) {
  if (!otpArr.length && !realtimeArr.length) return [];
  if (!otpArr.length)      return realtimeArr;
  if (!realtimeArr.length) return otpArr;

  // Indexar RT por linha
  const rtByLine = new Map();
  for (const a of realtimeArr) {
    const key = String(a.route_short_name || '');
    if (!rtByLine.has(key)) rtByLine.set(key, []);
    rtByLine.get(key).push(a);
  }

  // Linhas que o OTP já conhece
  const otpLines = new Set(otpArr.map(a => String(a.route_short_name || '')));

  const usedRtKeys = new Set();

  // 1. Enriquecer chegadas OTP com dados RT
  const merged = otpArr.map(otp => {
    const lineKey   = String(otp.route_short_name || '');
    const rtOptions = rtByLine.get(lineKey) || [];
    const otpEpoch  = _toEpoch(otp.realtime_arrival || otp.scheduled_arrival);

    // Tentar match temporal (±MATCH_WINDOW_MS)
    let matchIdx = rtOptions.findIndex((rt, i) => {
      if (usedRtKeys.has(lineKey + ':' + i)) return false;
      const rtEpoch = _toEpoch(rt.realtime_arrival || rt.scheduled_arrival);
      return otpEpoch !== null && rtEpoch !== null &&
             Math.abs(otpEpoch - rtEpoch) <= MATCH_WINDOW_MS;
    });

    // Fallback: match apenas por linha (sem restrição temporal) para o
    // primeiro item RT ainda não utilizado — previne que chegadas com
    // timestamps muito diferentes deixem de ser mergeadas.
    if (matchIdx === -1) {
      matchIdx = rtOptions.findIndex((_, i) => !usedRtKeys.has(lineKey + ':' + i));
      if (matchIdx !== -1) {
        _log(`  merge FALLBACK-LINE linha:${lineKey} (sem match temporal)`);
      }
    }

    if (matchIdx !== -1) {
      const rt = rtOptions[matchIdx];
      usedRtKeys.add(lineKey + ':' + matchIdx);
      _log(`  merge MATCH linha:${lineKey} OTP→RT delay:${rt.delay} is_realtime:${rt.is_realtime}`);
      return {
        ...otp,
        delay:            rt.delay            ?? otp.delay,
        realtime_arrival: rt.realtime_arrival  || otp.realtime_arrival,
        is_realtime:      rt.is_realtime       || otp.is_realtime,
        _source:          'otp+rt',
      };
    }

    return { ...otp, _source: otp._source || 'otp' };
  });

  // 2. Chegadas RT sem match → só adicionar se a linha não existir no OTP
  let rtOnlyCount = 0;
  for (const [lineKey, rtOptions] of rtByLine.entries()) {
    // Se o OTP já tem pelo menos uma chegada desta linha, ignorar as RT
    // que não fizeram match — são simplesmente chegadas que o OTP
    // também conhece mas com timestamp ligeiramente diferente.
    if (otpLines.has(lineKey)) {
      const skipped = rtOptions.filter((_, i) => !usedRtKeys.has(lineKey + ':' + i)).length;
      if (skipped > 0) {
        _log(`  merge SKIP ${skipped}x rt-only linha:${lineKey} (OTP já tem esta linha)`);
      }
      continue;
    }

    rtOptions.forEach((rt, i) => {
      if (!usedRtKeys.has(lineKey + ':' + i)) {
        _log(`  merge RT-ONLY linha:${lineKey} is_realtime:${rt.is_realtime} delay:${rt.delay}`);
        merged.push({ ...rt, _source: 'rt-only' });
        rtOnlyCount++;
      }
    });
  }

  if (rtOnlyCount > 0) {
    _info(`merge: ${rtOnlyCount} chegada(s) RT de linha(s) desconhecidas pelo OTP adicionada(s)`);
  }

  // 3. Ordenar por tempo de chegada
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

function _buildLocalServiceDate(year, month, day, timeStr) {
  const [rawH, rawM, rawS] = String(timeStr).split(':').map(Number);
  const d = new Date(year, month, day, 0, 0, 0, 0);
  d.setHours(rawH || 0, rawM || 0, rawS || 0, 0);
  return d;
}

function _recomputeArrivalDelta(arrival) {
  const targetMs = _toEpoch(arrival.realtime_arrival || arrival.scheduled_arrival);
  if (targetMs == null) return arrival;

  const diffSec = Math.round((targetMs - Date.now()) / 1000);

  return {
    ...arrival,
    arrival_seconds: diffSec,
    arrival_minutes: diffSec / 60,
  };
}

function _mergeUnirPlannedWithRealtime(plannedArrivals, realtimeArrivals) {
  if (!plannedArrivals.length && !realtimeArrivals.length) return [];
  if (!realtimeArrivals.length) {
    return plannedArrivals.map(a => _recomputeArrivalDelta(a));
  }

  const usedRt = new Set();

  const merged = plannedArrivals.map(planned => {
    const rtIndex = realtimeArrivals.findIndex((rt, idx) => {
      if (usedRt.has(idx)) return false;
      if (!planned.trip_id || !rt.trip_id) return false;
      const plannedTripIdNormalized = String(planned.trip_id).replace(/^ut1:/i, '').replace(/^ut2:/i, '').replace(/^ut3:/i, '').replace(/^ut4:/i, '').replace(/^ut5:/i, '').replace(/^ut6:/i, '').replace(/^unir:/i, '')
      return vehicleService.tripIdsMatch(plannedTripIdNormalized, rt.trip_id);
    });

    if (rtIndex === -1) {
      return _recomputeArrivalDelta({ ...planned, _source: planned._source || 'unir-gtfs-api' });
    }

    usedRt.add(rtIndex);
    const rt = realtimeArrivals[rtIndex];

    return _recomputeArrivalDelta(_normalizeOne({
      ...planned,
      vehicle_id: rt.vehicle_id ?? planned.vehicle_id ?? null,
      scheduled_arrival: rt.scheduled_arrival || planned.scheduled_arrival,
      realtime_arrival: rt.realtime_arrival || planned.realtime_arrival,
      delay: rt.delay ?? planned.delay,
      is_realtime: true,
      _source: 'unir-gtfs+rt',
    }));
  });

  merged.sort((a, b) => {
    const tA = _toEpoch(a.realtime_arrival || a.scheduled_arrival);
    const tB = _toEpoch(b.realtime_arrival || b.scheduled_arrival);
    return (tA ?? Infinity) - (tB ?? Infinity);
  });

  return merged;
}

async function _getUnirArrivalsFromStopTimes(stopId, maxMinutes = 720) {
  const now = new Date();
  const nowMs = now.getTime();
  const windowMs = maxMinutes * 60_000;
  const serviceDates = [_shiftDays(now, -1), now, _shiftDays(now, 1)];

  const schedules = await Promise.all(
      serviceDates.map(async serviceDate => ({
        requestedDate: serviceDate,
        schedule: await apiService.fetchGtfsStopSchedule(stopId, {
          date: _formatLocalYmd(serviceDate),
          limit: 5000,
        }),
      }))
  );

  const arrivals = [];
  const seen = new Set();

  for (const { requestedDate, schedule } of schedules) {
    if (!Array.isArray(schedule?.departures)) continue;

    const { year, month, day } = _extractServiceDateParts(
        schedule.date,
        requestedDate
    );

    for (const dep of schedule.departures) {
      const timeStr = dep.arrival_time || dep.departure_time;
      if (!timeStr) continue;

      const arrivalDate = _buildLocalServiceDate(year, month, day, timeStr);
      const diffMs = arrivalDate.getTime() - nowMs;

      if (diffMs < 0 || diffMs > windowMs) continue;

      const uniqueKey = [
        dep.trip_id ?? '',
        dep.route_id ?? dep.route_short_name ?? '',
        timeStr,
        year,
        month,
        day
      ].join('|');

      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const diffSec = Math.round(diffMs / 1000);

      arrivals.push(_normalizeOne({
        route_short_name:  dep.route_short_name,
        trip_id:           dep.trip_id,
        trip_headsign:     dep.trip_headsign || '',
        scheduled_arrival: arrivalDate.toISOString(),
        realtime_arrival:  null,
        delay:             null,
        is_realtime:       false,
        directionId:       dep.direction_id,
        arrival_seconds:   diffSec,
        arrival_minutes:   diffSec / 60,
        _source:           'unir-gtfs-api',
      }));
    }
  }

  arrivals.sort((a, b) => {
    const tA = _toEpoch(a.scheduled_arrival);
    const tB = _toEpoch(b.scheduled_arrival);
    return (tA ?? Infinity) - (tB ?? Infinity);
  });

  return arrivals;
}

// ── Serviço ──────────────────────────────────────────────────────────────────

class PlannedArrivalsService {

  async getNextArrivals(stopId, maxMinutes = 720, forceRefresh = false) {
    const cacheKey = `${stopId}:${maxMinutes}`;

    const isUnir = stopService.isUnirStop(stopId);

    if (isUnir) {
      if (!forceRefresh) {
        const cached = _cache.get(cacheKey);
        if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
          _log(`cache HIT UNIR stopId:${stopId} idade:${Date.now() - cached.ts}ms`);
          return cached.data;
        }
      } else {
        _log(`forceRefresh=true — ignorar cache UNIR para stopId:${stopId}`);
      }

      try {
        const [planned, rtResp] = await Promise.all([
          _getUnirArrivalsFromStopTimes(stopId, maxMinutes || 720),
          _withTimeout(apiService.fetchStopRealtime(stopId), REALTIME_TIMEOUT_MS).catch(() => null),
        ]);

        const rtArrivals = _normalize(
            _extractRealtimeArrivals(rtResp).map(a => ({ ...a, _source: 'unir-rt' }))
        );

        const result = _mergeUnirPlannedWithRealtime(planned, rtArrivals);

        if (result.length > 0) {
          _cache.set(cacheKey, { data: result, ts: Date.now() });
        }

        return result;
      } catch (err) {
        console.warn('[ARRIVALS] UNIR stop_times/realtime falhou:', err);
        return [];
      }
    }

    // --- Daqui para baixo fica como estava: STCP/Metrobus (OTP + realtime) ---

    if (!forceRefresh) {
      const cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        _log(`cache HIT stopId:${stopId} idade:${Date.now() - cached.ts}ms`);
        return cached.data;
      }
    } else {
      _log(`forceRefresh=true — ignorar cache para stopId:${stopId}`);
    }

    const stopCode = await _resolveStopCode(stopId);
    _log(`getNextArrivals stopId:${stopId} stopCode:${stopCode} maxMinutes:${maxMinutes}`);

    const t0 = performance.now();
    const [otpResult, rtResult] = await Promise.allSettled([
      otpService.getArrivalsForStop(stopCode, maxMinutes),
      _withTimeout(apiService.fetchStopRealtime(stopId), REALTIME_TIMEOUT_MS),
    ]);
    const elapsed = Math.round(performance.now() - t0);

    // ── OTP ──
    const otpArrivals = otpResult.status === 'fulfilled'
      ? _normalize((otpResult.value || []).map(a => ({ ...a, _source: 'otp' })))
      : [];

    if (otpResult.status === 'rejected') {
      console.warn('[ARRIVALS] OTP falhou:', otpResult.reason?.message);
    } else {
      _log(`OTP: ${otpArrivals.length} chegadas (${elapsed}ms)`);
      if (_dbg()) {
        otpArrivals.forEach(a =>
          _log(`  OTP linha:${a.route_short_name} trip:${a.trip_id} rt:${a.is_realtime} delay:${a.delay}`)
        );
      }
    }

    // ── API Realtime ──
    const rtArrivals = rtResult.status === 'fulfilled'
      ? _normalize(_extractRealtimeArrivals(rtResult.value).map(a => ({ ...a, _source: 'rt' })))
      : [];

    if (rtResult.status === 'rejected') {
      const msg = rtResult.reason?.message || '';
      if (msg.includes('timeout')) {
        console.warn(`[ARRIVALS] API realtime timeout (>${REALTIME_TIMEOUT_MS}ms) — usar apenas OTP`);
      } else {
        console.warn('[ARRIVALS] API realtime falhou:', msg);
      }
    } else {
      _log(`API Realtime: ${rtArrivals.length} chegadas (${elapsed}ms)`);
      if (_dbg()) {
        rtArrivals.forEach(a =>
          _log(`  RT  linha:${a.route_short_name} trip:${a.trip_id} rt:${a.is_realtime} delay:${a.delay}`)
        );
      }
    }

    // ── Merge ──
    _log(`merge: OTP=${otpArrivals.length} RT=${rtArrivals.length}`);
    const result = _merge(otpArrivals, rtArrivals);
    _log(`merge resultado: ${result.length} chegadas`);
    if (_dbg()) {
      const bySource = result.reduce((acc, a) => { acc[a._source] = (acc[a._source] || 0) + 1; return acc; }, {});
      _log('  por fonte:', bySource);
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
