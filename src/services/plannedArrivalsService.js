/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Suporta paragens STCP normais E paragens de rotas custom (ex: MB1).
 *
 * FONTE DE DADOS (por prioridade):
 *   1. OTP GraphQL (otp.portodigital.pt) — tempo real, mesmo método do site oficial
 *      Obtido via POST com query GraphQL. Cache TTL 20s.
 *   2. HTTP fetchStopRealtime — fallback se OTP falhar
 *   3. Horários locais (scheduleService) — complementam chegadas sem tempo real
 *
 * getNextArrivals() devolve sempre um Array de chegadas ordenado por
 * arrival_minutes. A localização dos veículos no mapa é feita em
 * StopsMapApp.updateBusMap() via mqttVehicleService.getVehiclesByTripIds().
 */

import { apiService }                  from '../core/apiService.js';
import { scheduleService }             from './scheduleService.js';
import { customRouteScheduleService }  from './customRouteScheduleService.js';
import { otpService }                  from './otpService.js';

class PlannedArrivalsService {
  constructor() {
    this.routesCache    = new Map();
    this.schedulesCache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém próximas chegadas combinando OTP (tempo real) + horários locais.
   * Para paragens custom, usa exclusivamente os dados locais.
   *
   * @param {string} stopId
   * @param {number} maxMinutes
   * @returns {Promise<Array>}  array de chegadas ordenado por arrival_minutes
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    try {
      // Paragem de rota custom → sem chamada de rede, dados locais gerados
      if (customRouteScheduleService.handlesStop(stopId)) {
        return customRouteScheduleService.getNextArrivals(stopId, maxMinutes);
      }

      // ── 1. OTP GraphQL (preferencial) ───────────────────────────────────
      let otpArrivals = [];
      try {
        otpArrivals = await otpService.getArrivalsForStop(stopId, maxMinutes);
      } catch (otpErr) {
        console.warn(`[PlannedArrivals] OTP falhou para ${stopId}:`, otpErr.message);
      }

      // Se o OTP devolveu dados, complementar com horários locais
      if (otpArrivals.length > 0) {
        const scheduledArrivals = await this._getScheduledArrivals(stopId, maxMinutes);
        return this.combineArrivals(otpArrivals, scheduledArrivals);
      }

      // ── 2. Fallback HTTP (stcp.live ou API legacy) ─────────────────────
      console.info(`[PlannedArrivals] ${stopId}: OTP sem dados — fallback HTTP`);

      let realtimeArrivals = [];
      try {
        const realtimeData = await apiService.fetchStopRealtime(stopId);
        realtimeArrivals   = (realtimeData?.arrivals || []);
      } catch (httpErr) {
        console.warn(`[PlannedArrivals] Fallback HTTP falhou para ${stopId}:`, httpErr.message);
      }

      const scheduledArrivals = await this._getScheduledArrivals(stopId, maxMinutes);

      return this.combineArrivals(
        this.formatArrivals(realtimeArrivals, true),
        scheduledArrivals
      );

    } catch (error) {
      console.error(`❌ Erro ao obter chegadas para ${stopId}:`, error);
      return [];
    }
  }

  // ─── Horários locais ─────────────────────────────────────────────────────

  async _getScheduledArrivals(stopId, maxMinutes) {
    try {
      const routes = await this.getStopRoutes(stopId);
      if (!routes.length) return [];

      const currentServiceId = await scheduleService.getServiceIdAtual(stopId);
      const scheduledArrivals = [];

      for (const route of routes) {
        const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);
        if (scheduleData?.schedule) {
          scheduledArrivals.push(...this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route));
        }
      }

      return this.formatArrivals(scheduledArrivals, false);
    } catch (err) {
      console.warn(`[PlannedArrivals] Erro ao obter horários locais para ${stopId}:`, err.message);
      return [];
    }
  }

  // ─── Métodos de acesso a dados ──────────────────────────────────────────

  async getStopRoutes(stopId) {
    if (customRouteScheduleService.handlesStop(stopId)) {
      return customRouteScheduleService.getStopRoutes(stopId).display_routes || [];
    }
    const cached = this.routesCache.get(stopId);
    const now    = Date.now();
    if (cached && (now - cached.timestamp) < this.cacheTTL) return cached.data;
    const result = await apiService.fetchStopRoutes(stopId);
    const routes = result?.display_routes || [];
    this.routesCache.set(stopId, { data: routes, timestamp: now });
    return routes;
  }

  async getStopSchedule(stopId, routeId, serviceId) {
    const cacheKey = `${stopId}_${routeId}_${serviceId}`;
    const cached   = this.schedulesCache.get(cacheKey);
    const now      = Date.now();
    if (cached && (now - cached.timestamp) < this.cacheTTL) return cached.data;
    const data = await apiService.fetchStopSchedule(stopId, routeId, serviceId);
    if (data) this.schedulesCache.set(cacheKey, { data, timestamp: now });
    return data;
  }

  extractUpcomingTrips(schedule, maxMinutes, route) {
    const now              = new Date();
    const currentTotalMins = now.getHours() * 60 + now.getMinutes();
    const maxTotalMins     = currentTotalMins + maxMinutes;
    const upcomingTrips    = [];

    const endHour            = Math.min(23, Math.floor(maxTotalMins / 60));
    const checkAfterMidnight = maxTotalMins >= 1440;
    const afterMidnightEnd   = checkAfterMidnight ? Math.floor((maxTotalMins - 1440) / 60) + 24 : 0;

    for (let h = now.getHours(); h <= endHour; h++) {
      this._processHourTrips(schedule, h, currentTotalMins, maxTotalMins, route, upcomingTrips);
    }
    if (checkAfterMidnight) {
      for (let h = 24; h <= afterMidnightEnd; h++) {
        this._processHourTrips(schedule, h, currentTotalMins, maxTotalMins, route, upcomingTrips);
      }
    }
    return upcomingTrips;
  }

  _processHourTrips(schedule, hour, currentTotalMins, maxTotalMins, route, out) {
    const trips = schedule[hour.toString()];
    if (!trips?.length) return;

    for (const trip of trips) {
      const tripTotalMins = hour * 60 + parseInt(trip.minute);
      let adjTrip    = tripTotalMins;
      let adjCurrent = currentTotalMins;

      if (hour >= 24 && currentTotalMins < 23 * 60) {
        adjCurrent = 1440 + currentTotalMins;
      }

      if (adjTrip >= adjCurrent && adjTrip < maxTotalMins) {
        const displayHour = hour >= 24 ? hour - 24 : hour;
        out.push({
          route_short_name:  route.route_short_name,
          route_color:       route.route_color,
          route_text_color:  route.route_text_color,
          trip_headsign:     trip.headsign,
          arrival_minutes:   adjTrip - adjCurrent,
          arrival_time:      `${String(displayHour).padStart(2, '0')}:${trip.minute.padStart(2, '0')}`,
          trip_id:           trip.trip_id || null,
          status:            'SCHEDULED',
        });
      }
    }
  }

  formatArrivals(arrivals, isRealtime) {
    return arrivals.map(arr => ({
      route_short_name: arr.route_short_name,
      route_color:      arr.route_color      || '#0072C6',
      route_text_color: arr.route_text_color || '#FFFFFF',
      trip_headsign:    arr.trip_headsign,
      arrival_minutes:  arr.arrival_minutes,
      arrival_time:     arr.arrival_time,
      trip_id:          arr.trip_id,
      status:           arr.status           || 'SCHEDULED',
      delay_minutes:    arr.delay_minutes    || 0,
      is_realtime:      isRealtime,
    }));
  }

  combineArrivals(realtimeArrivals, scheduledArrivals) {
    const combined = [...realtimeArrivals];
    for (const scheduled of scheduledArrivals) {
      const isDuplicate = realtimeArrivals.some(rt => {
        const sameRoute    = rt.route_short_name === scheduled.route_short_name;
        const sameHeadsign = this._normalizeHeadsign(rt.trip_headsign) ===
                             this._normalizeHeadsign(scheduled.trip_headsign);
        const timeDiff     = Math.abs(
          (rt.arrival_minutes - (rt.delay_minutes || 0)) - scheduled.arrival_minutes
        );
        return sameRoute && sameHeadsign && timeDiff <= 5;
      });
      if (!isDuplicate) combined.push(scheduled);
    }
    return combined.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  _normalizeHeadsign(h) {
    return h ? h.trim().toUpperCase().replace(/\s+/g, ' ') : '';
  }

  clearCache() {
    this.routesCache.clear();
    this.schedulesCache.clear();
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
