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

async function _resolveStopCode(stopId) {
  const cached = stopService.getStopById(stopId);
  if (cached?.stop_code) return cached.stop_code;
  try {
    const info = await apiService.fetchStopInfo(stopId);
    if (info?.stop_code) return info.stop_code;
  } catch { /* silencioso */ }
  return stopId;
}

function _isUnirStop(stopId) {
  const cached = stopService.getStopById(stopId);
  if (cached?.operator === 'unir') return true;

  const id = String(stopId);
  // ids locais antigos (prg:...) ou ids GTFS tipo ut4:prg:...
  if (id.startsWith('prg:') || id.includes(':prg:')) return true;

  return false;
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
  return {
    ...a,
    route_short_name:  a.route_short_name  || a.route_number || '',
    trip_id:           a.trip_id           || null,
    headsign:          a.headsign          || a.trip_headsign || '',
    scheduled_arrival: a.scheduled_arrival || a.arrival_time  || null,
    realtime_arrival:  a.realtime_arrival  || null,
    delay: a.delay
        ?? a.delay_seconds
        ?? (a.delay_minutes != null ? Number(a.delay_minutes) * 60 : null),
    is_realtime:       Boolean(a.is_realtime),
    directionId:       a.directionId       ?? a.direction_id  ?? null,
    _source:           a._source           || 'unknown',
  };
}

function _normalize(arrivals) {
  if (!Array.isArray(arrivals)) return [];
  return arrivals.map(_normalizeOne);
}

function _extractRealtimeArrivals(response) {
  if (!response) return [];
  if (Array.isArray(response))          return response;
  if (Array.isArray(response.arrivals)) return response.arrivals;
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

async function _getUnirArrivalsFromStopTimes(stopId, maxMinutes = 120) {
  const now       = new Date();
  const nowMs     = now.getTime();
  const windowMs  = maxMinutes * 60_000;
  const arrivals  = [];

  // Converter stopId local (ex. 'prg:prt:61') para alias GTFS (ex. 'unir:prg:prt:61')
  const gtfsStopId = String(stopId).startsWith('unir:')
      ? String(stopId)
      : `unir:${stopId}`;

  const schedule = await apiService.fetchGtfsStopSchedule(gtfsStopId, {
    date: now.toISOString().slice(0, 10), // YYYY-MM-DD
    limit: 5000,
  });

  if (!schedule?.departures || !Array.isArray(schedule.departures)) {
    _info(`[ARRIVALS] UNIR GTFS schedule vazio para ${gtfsStopId}`);
    return [];
  }

  const dateStr = schedule.date || now.toISOString().slice(0, 10); // YYYYMMDD ou YYYY-MM-DD
  // Converter para componentes de data
  let year = now.getFullYear(), month = now.getMonth(), day = now.getDate();
  if (/^\\d{8}$/.test(dateStr)) {
    year  = Number(dateStr.slice(0, 4));
    month = Number(dateStr.slice(4, 6)) - 1;
    day   = Number(dateStr.slice(6, 8));
  } else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    year = y; month = m - 1; day = d;
  }

  for (const dep of schedule.departures) {
    const timeStr = dep.arrival_time || dep.departure_time;
    if (!timeStr) continue;

    const [h, m, s] = timeStr.split(':').map(Number);
    const d = new Date(Date.UTC(year, month, day, h, m, s || 0));
    const t = d.getTime();
    const diffMs = t - nowMs;
    if (diffMs < 0 || diffMs > windowMs) continue;

    const diffSec = Math.round(diffMs / 1000);

    arrivals.push(_normalizeOne({
      route_short_name:  dep.route_short_name,
      trip_id:           dep.trip_id,
      trip_headsign:     dep.trip_headsign || '',
      scheduled_arrival: d.toISOString(),
      realtime_arrival:  null,
      delay:             null,
      is_realtime:       false,
      directionId:       dep.direction_id,
      arrival_seconds:   diffSec,
      arrival_minutes:   diffSec / 60,
      _source:           'unir-gtfs-api',
    }));
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

  async getNextArrivals(stopId, maxMinutes = 60, forceRefresh = false) {
    const cacheKey = `${stopId}:${maxMinutes}`;

    const isUnir = _isUnirStop(stopId);

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
        const result = await _getUnirArrivalsFromStopTimes(stopId, maxMinutes || 120);
        if (result.length > 0) {
          _cache.set(cacheKey, { data: result, ts: Date.now() });
        }
        return result;
      } catch (err) {
        console.warn('[ARRIVALS] UNIR stop_times falhou:', err);
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
