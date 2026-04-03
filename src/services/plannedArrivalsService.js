/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Usa: apiService, scheduleService
 */

import { apiService }      from '../core/apiService.js';
import { scheduleService } from './scheduleService.js';

class PlannedArrivalsService {
  constructor() {
    this.routesCache    = new Map(); // stopId -> { data, timestamp }
    this.schedulesCache = new Map(); // `${stopId}_${routeId}_${serviceId}` -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém próximas chegadas combinando tempo real + programadas.
   * @param {string} stopId
   * @param {number} maxMinutes
   * @returns {Promise<Array>}
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    try {
      const realtimeData     = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];

      const routes = await this.getStopRoutes(stopId);
      if (routes.length === 0) return this.formatArrivals(realtimeArrivals, true);

      // service_id ativo (sem parâmetro: usa paragem fixa interna do scheduleService)
      const currentServiceId = await scheduleService.getServiceIdAtual();

      const scheduledArrivals = [];
      for (const route of routes) {
        const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);
        if (scheduleData?.schedule) {
          scheduledArrivals.push(...this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route));
        }
      }

      return this.combineArrivals(
        this.formatArrivals(realtimeArrivals, true),
        this.formatArrivals(scheduledArrivals, false)
      );
    } catch (error) {
      console.error(`❌ Erro ao obter chegadas para ${stopId}:`, error);
      return [];
    }
  }

  async getStopRoutes(stopId) {
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

  /**
   * Extrai próximas viagens do schedule.
   * Suporta horários após 24h (a STCP usa 24, 25, 26 para após meia-noite).
   */
  extractUpcomingTrips(schedule, maxMinutes, route) {
    const now                = new Date();
    const currentTotalMins   = now.getHours() * 60 + now.getMinutes();
    const maxTotalMins       = currentTotalMins + maxMinutes;
    const upcomingTrips      = [];

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

      if (hour >= 24 && currentTotalMins >= 23 * 60) {
        // entre 23h-24h, horários 24h+ são futuro próximo
      } else if (hour >= 24) {
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
          status:            'SCHEDULED'
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
      is_realtime:      isRealtime
    }));
  }

  /**
   * Combina chegadas tempo real + programadas, removendo duplicados.
   * Duplicado: mesma linha + mesmo destino + tempo próximo (±5 min, ajustado ao atraso).
   */
  combineArrivals(realtimeArrivals, scheduledArrivals) {
    const combined = [...realtimeArrivals];
    for (const scheduled of scheduledArrivals) {
      const isDuplicate = realtimeArrivals.some(rt => {
        const sameRoute    = rt.route_short_name === scheduled.route_short_name;
        const sameHeadsign = this._normalizeHeadsign(rt.trip_headsign) ===
                             this._normalizeHeadsign(scheduled.trip_headsign);
        const timeDiff     = Math.abs((rt.arrival_minutes - rt.delay_minutes) - scheduled.arrival_minutes);
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
