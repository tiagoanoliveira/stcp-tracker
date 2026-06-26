/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Suporta paragens STCP normais E paragens de rotas custom (ex: MB1).
 *
 * FONTE DE DADOS (por prioridade):
 *   1. MQTT TripUpdate (/gtfsrt/tu/#) — tempo real, sem HTTP, sem falhas
 *      Usado quando mqttTripUpdateService já tem dados para a paragem.
 *   2. HTTP fetchStopRealtime — fallback enquanto MQTT não tem dados ainda
 *   3. Horários locais (scheduleService) — completam chegadas sem tempo real
 *
 * Usa: apiService, scheduleService, customRouteScheduleService, mqttTripUpdateService
 */

import { apiService }                  from '../core/apiService.js';
import { scheduleService }             from './scheduleService.js';
import { customRouteScheduleService }  from './customRouteScheduleService.js';
import { mqttTripUpdateService }       from './mqttTripUpdateService.js';

class PlannedArrivalsService {
  constructor() {
    this.routesCache    = new Map(); // stopId -> { data, timestamp }
    this.schedulesCache = new Map(); // `${stopId}_${routeId}_${serviceId}` -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém próximas chegadas combinando tempo real + programadas.
   * Para paragens custom, usa exclusivamente os dados locais.
   * @param {string} stopId
   * @param {number} maxMinutes
   * @returns {Promise<Array>}
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    try {
      // Paragem de rota custom → sem chamada de rede, dados locais gerados
      if (customRouteScheduleService.handlesStop(stopId)) {
        return customRouteScheduleService.getNextArrivals(stopId, maxMinutes);
      }

      // ── 1. MQTT TripUpdate (preferencial) ──────────────────────────────
      if (mqttTripUpdateService.isActive() && mqttTripUpdateService.hasDataForStop(stopId)) {
        const mqttArrivals = this.formatMqttArrivals(
          mqttTripUpdateService.getArrivalsForStop(stopId),
          maxMinutes
        );

        // Complementar com horários locais para linhas sem TripUpdate activo
        const routes = await this.getStopRoutes(stopId);
        const currentServiceId = routes.length > 0
          ? await scheduleService.getServiceIdAtual(stopId)
          : null;

        const scheduledArrivals = [];
        if (currentServiceId) {
          for (const route of routes) {
            const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);
            if (scheduleData?.schedule) {
              scheduledArrivals.push(...this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route));
            }
          }
        }

        return this.combineArrivals(
          mqttArrivals,
          this.formatArrivals(scheduledArrivals, false)
        );
      }

      // ── 2. Fallback HTTP (enquanto MQTT não tem dados para esta paragem) ─
      const realtimeData     = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];

      const routes = await this.getStopRoutes(stopId);
      if (routes.length === 0) return this.formatArrivals(realtimeArrivals, true);

      const currentServiceId = await scheduleService.getServiceIdAtual(stopId);

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

  // ─── Formatação de chegadas MQTT ────────────────────────────────────────────

  /**
   * Converte TripArrival[] (mqttTripUpdateService) para o formato comum.
   * Filtra chegadas fora da janela maxMinutes.
   * @param {TripArrival[]} mqttArrivals
   * @param {number} maxMinutes
   * @returns {Array}
   */
  formatMqttArrivals(mqttArrivals, maxMinutes) {
    const now = Math.floor(Date.now() / 1000); // Unix s
    const result = [];

    for (const arr of mqttArrivals) {
      // arrivalTime = 0 significa sem dado de chegada para esta paragem
      if (!arr.arrivalTime) continue;

      const diffSeconds = arr.arrivalTime - now;
      const arrivalMinutes = Math.round(diffSeconds / 60);

      // Ignorar chegadas muito no passado (> 30s) ou muito no futuro
      if (arrivalMinutes < -1 || arrivalMinutes > maxMinutes) continue;

      // Converter Unix timestamp para HH:MM
      const dt = new Date(arr.arrivalTime * 1000);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');

      result.push({
        route_short_name: arr.routeId   || '?',
        route_color:      '#0072C6',          // cor padrão; será sobrescrita pelo UI se tiver info da linha
        route_text_color: '#FFFFFF',
        trip_headsign:    arr.headsign  || '',
        arrival_minutes:  Math.max(0, arrivalMinutes),
        arrival_time:     `${hh}:${mm}`,
        trip_id:          arr.tripId    || null,
        status:           'REALTIME',
        delay_minutes:    arr.delaySeconds != null ? Math.round(arr.delaySeconds / 60) : 0,
        delay_seconds:    arr.delaySeconds || 0,
        is_realtime:      true,
        vehicle_number:   arr.vehicleNumber || null,
        source:           'mqtt_tu',
      });
    }

    return result.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  // ─── Métodos existentes (inalterados) ──────────────────────────────────────

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
        const timeDiff     = Math.abs((rt.arrival_minutes - (rt.delay_minutes || 0)) - scheduled.arrival_minutes);
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
