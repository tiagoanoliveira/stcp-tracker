/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Usa: apiService, scheduleService
 */

import { apiService } from '../core/apiService.js';
import { scheduleService } from './scheduleService.js';

class PlannedArrivalsService {
  constructor() {
    // Cache de rotas e schedules (válido por 30 minutos)
    this.routesCache = new Map(); // stopId -> { data, timestamp }
    this.schedulesCache = new Map(); // `${stopId}_${routeId}_${serviceId}` -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém próximas chegadas combinando tempo real + programadas
   * @param {string} stopId - Código da paragem
   * @param {number} maxMinutes - Tempo máximo para olhar à frente (ex: 60 minutos)
   * @returns {Promise<Array>} Array de chegadas ordenadas por tempo
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    try {
      // 1. Buscar chegadas em tempo real
      const realtimeData    = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];

      // 2. Buscar rotas que servem esta paragem
      const routes = await this.getStopRoutes(stopId);

      if (routes.length === 0) {
        return this.formatArrivals(realtimeArrivals, true);
      }

      // 3. Determinar o service_id REAL para esta paragem/data via API STCP
      //    (substitui o cálculo manual getServiceIdAtual que não distinguia
      //     períodos escolares vs não-escolares, feriados, etc.)
      const currentServiceId = await scheduleService.getServiceIdForStop(stopId);

      // 4. Buscar schedules de cada rota
      const scheduledArrivals = [];

      for (const route of routes) {
        const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);

        if (scheduleData && scheduleData.schedule) {
          const upcomingTrips = this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route);
          scheduledArrivals.push(...upcomingTrips);
        }
      }

      // 5. Combinar e remover duplicados
      const combined = this.combineArrivals(
        this.formatArrivals(realtimeArrivals, true),
        this.formatArrivals(scheduledArrivals, false)
      );

      return combined;

    } catch (error) {
      console.error(`\u274c Erro ao obter chegadas para ${stopId}:`, error);
      return [];
    }
  }

  /**
   * Buscar rotas que servem uma paragem (com cache)
   */
  async getStopRoutes(stopId) {
    const cached = this.routesCache.get(stopId);
    const now    = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    const result = await apiService.fetchStopRoutes(stopId);
    const routes = result?.display_routes || [];

    this.routesCache.set(stopId, { data: routes, timestamp: now });
    return routes;
  }

  /**
   * Buscar schedule de uma rota numa paragem (com cache)
   */
  async getStopSchedule(stopId, routeId, serviceId) {
    const cacheKey = `${stopId}_${routeId}_${serviceId}`;
    const cached   = this.schedulesCache.get(cacheKey);
    const now      = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    const data = await apiService.fetchStopSchedule(stopId, routeId, serviceId);

    if (data) {
      this.schedulesCache.set(cacheKey, { data, timestamp: now });
    }

    return data;
  }

  /**
   * Extrair próximas viagens do schedule
   * Suporta horários após 24h (a STCP usa 24, 25, 26 para horários após meia-noite)
   */
  extractUpcomingTrips(schedule, maxMinutes, route) {
    const now                 = new Date();
    const currentHour         = now.getHours();
    const currentMinute       = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const maxTotalMinutes     = currentTotalMinutes + maxMinutes;

    const upcomingTrips = [];

    const startHour             = currentHour;
    const endHour               = Math.min(23, Math.floor(maxTotalMinutes / 60));
    const checkAfterMidnight    = maxTotalMinutes >= 1440;
    const afterMidnightEndHour  = checkAfterMidnight ? Math.floor((maxTotalMinutes - 1440) / 60) + 24 : 0;

    for (let hour = startHour; hour <= endHour; hour++) {
      this.processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips);
    }

    if (checkAfterMidnight) {
      for (let hour = 24; hour <= afterMidnightEndHour; hour++) {
        this.processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips);
      }
    }

    return upcomingTrips;
  }

  processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips) {
    const trips = schedule[hour.toString()];
    if (!trips || trips.length === 0) return;

    for (const trip of trips) {
      const tripTotalMinutes = hour * 60 + parseInt(trip.minute);

      let adjustedTripMinutes    = tripTotalMinutes;
      let adjustedCurrentMinutes = currentTotalMinutes;

      if (hour >= 24) {
        if (currentTotalMinutes >= 23 * 60) {
          adjustedCurrentMinutes = currentTotalMinutes;
        } else {
          adjustedCurrentMinutes = 1440 + currentTotalMinutes;
        }
      }

      if (adjustedTripMinutes >= adjustedCurrentMinutes && adjustedTripMinutes < maxTotalMinutes) {
        const minutesUntilArrival = adjustedTripMinutes - adjustedCurrentMinutes;
        const displayHour         = hour >= 24 ? hour - 24 : hour;

        upcomingTrips.push({
          route_short_name: route.route_short_name,
          route_color:      route.route_color,
          route_text_color: route.route_text_color,
          trip_headsign:    trip.headsign,
          arrival_minutes:  minutesUntilArrival,
          arrival_time:     `${displayHour.toString().padStart(2, '0')}:${trip.minute.padStart(2, '0')}`,
          trip_id:          trip.trip_id || null,
          status:           'SCHEDULED'
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

  combineArrivals(realtimeArrivals, scheduledArrivals) {
    const combined = [...realtimeArrivals];

    for (const scheduled of scheduledArrivals) {
      const isDuplicate = realtimeArrivals.some(realtime => {
        const sameRoute    = realtime.route_short_name === scheduled.route_short_name;
        const sameHeadsign = this.normalizeHeadsign(realtime.trip_headsign) ===
                             this.normalizeHeadsign(scheduled.trip_headsign);
        const realtimeScheduledTime = realtime.arrival_minutes - realtime.delay_minutes;
        const timeDiff = Math.abs(realtimeScheduledTime - scheduled.arrival_minutes);
        return sameRoute && sameHeadsign && timeDiff <= 5;
      });

      if (!isDuplicate) combined.push(scheduled);
    }

    return combined.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  normalizeHeadsign(headsign) {
    if (!headsign) return '';
    return headsign.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  clearCache() {
    this.routesCache.clear();
    this.schedulesCache.clear();
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
