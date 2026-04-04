/**
 * customRouteScheduleService.js
 * Fornece chegadas planeadas para paragens de rotas custom (ex: MB1),
 * usando a grelha correta (dia útil / sábado / feriado) determinada em
 * runtime através do scheduleService — exactamente como as paragens STCP.
 */

import {
  isCustomStop,
  getScheduleForService,
  serviceIdToType,
  CUSTOM_STOPS_MAP,
} from '../data/customRoutes.js';
import { scheduleService } from './scheduleService.js';

class CustomRouteScheduleService {
  /**
   * Indica se um stopId tem dados de rota custom.
   * Síncrono para retrocompatibilidade.
   * @param {string} stopId
   * @returns {boolean}
   */
  handlesStop(stopId) {
    return isCustomStop(stopId);
  }

  /**
   * Devolve as próximas chegadas planeadas para uma paragem custom.
   * Consulta o scheduleService para saber o service_id activo hoje e
   * usa a grelha de horários correspondente (weekday / saturday / holiday).
   *
   * @param {string} stopId
   * @param {number} maxMinutes - janela de tempo a mostrar
   * @returns {Promise<Array>}
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    // 1. Determinar o tipo de dia usando o mesmo mecanismo das paragens STCP
    const serviceId   = await scheduleService.getServiceIdAtual(stopId);
    const serviceType = serviceIdToType(serviceId);

    // 2. Obter o schedule pré-computado para este tipo de dia
    const entry = getScheduleForService(stopId, serviceType);
    if (!entry) return [];

    const route = entry.display_routes?.[0];
    if (!route) return [];

    const now          = new Date();
    const currentTotal = now.getHours() * 60 + now.getMinutes();
    const maxTotal     = currentTotal + maxMinutes;
    const arrivals     = [];

    for (let h = now.getHours(); h <= Math.min(30, Math.floor(maxTotal / 60)); h++) {
      const trips = entry.schedule[h];
      if (!trips) continue;

      for (const trip of trips) {
        const tripTotal   = h * 60 + parseInt(trip.minute, 10);
        const diffMinutes = tripTotal - currentTotal;

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
   * Usa o schedule de dia útil (apenas para listar rotas — independente do dia).
   * @param {string} stopId
   * @returns {{ display_routes: Array }}
   */
  getStopRoutes(stopId) {
    const entry = getScheduleForService(stopId, 'weekday');
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
