/**
 * customRouteScheduleService.js
 * Fornece chegadas planeadas para paragens de rotas custom (ex: MB1),
 * com a mesma interface que o plannedArrivalsService usa internamente.
 */

import {
  isCustomStop,
  getCustomStopSchedule,
  CUSTOM_STOPS_MAP,
} from '../data/customRoutes.js';

class CustomRouteScheduleService {
  /**
   * Indica se um stopId tem dados de rota custom.
   * @param {string} stopId
   * @returns {boolean}
   */
  handlesStop(stopId) {
    return isCustomStop(stopId);
  }

  /**
   * Devolve as próximas chegadas planeadas para uma paragem custom.
   * Formato compatível com plannedArrivalsService.formatArrivals().
   * @param {string} stopId
   * @param {number} maxMinutes - janela de tempo a mostrar
   * @returns {Array}
   */
  getNextArrivals(stopId, maxMinutes = 60) {
    const entry = getCustomStopSchedule(stopId);
    if (!entry) return [];

    const route = entry.display_routes?.[0];
    if (!route) return [];

    const now             = new Date();
    const currentTotal    = now.getHours() * 60 + now.getMinutes();
    const maxTotal        = currentTotal + maxMinutes;
    const arrivals        = [];

    for (let h = now.getHours(); h <= Math.min(30, Math.floor(maxTotal / 60)); h++) {
      const trips = entry.schedule[h];
      if (!trips) continue;

      for (const trip of trips) {
        const tripTotal    = h * 60 + parseInt(trip.minute, 10);
        const diffMinutes  = tripTotal - currentTotal;

        if (diffMinutes >= 0 && tripTotal < maxTotal) {
          arrivals.push({
            route_short_name: route.route_short_name,
            route_color:      route.route_color,
            route_text_color: route.route_text_color,
            trip_headsign:    trip.headsign,
            arrival_minutes:  diffMinutes,
            arrival_time:     `${String(h % 24).padStart(2, '0')}:${trip.minute}`,
            trip_id:          trip.trip_id,
            status:           'SCHEDULED',
            delay_minutes:    0,
            is_realtime:      false,
          });
        }
      }
    }

    return arrivals.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  /**
   * Devolve as rotas associadas a uma paragem custom.
   * Formato compatível com apiService.fetchStopRoutes().
   * @param {string} stopId
   * @returns {{ display_routes: Array }}
   */
  getStopRoutes(stopId) {
    const entry = getCustomStopSchedule(stopId);
    if (!entry) return { display_routes: [] };
    return { display_routes: entry.display_routes || [] };
  }

  /**
   * Devolve info básica de uma paragem custom (compatível com stopService).
   * @param {string} stopId
   * @returns {object|null}
   */
  getStopInfo(stopId) {
    return CUSTOM_STOPS_MAP.get(stopId) || null;
  }
}

export const customRouteScheduleService = new CustomRouteScheduleService();
