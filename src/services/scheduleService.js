/**
 * Schedule Service - Lógica de horários e serviços
 * Usa: apiService
 */

import { apiService } from '../core/apiService.js';

class ScheduleService {
  constructor() {
    this.routeSchedulesCache = new Map(); // "route_serviceId_dir" -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos

    this.cachedServiceId   = null;
    this.cachedServiceDate = null;
    this._serviceIdPromise = null;
  }

  /**
   * Chamado pelo BusMapApp na inicialização.
   * Pré-aquece o cache do service_id ativo para que resolveHeadsign
   * e plannedArrivalsService o encontrem já pronto.
   * @param {string} [stopId] - Paragem usada para consultar o serviço (default: BOLH1).
   *   Se possível, passe uma paragem real do contexto atual.
   */
  async loadScheduleData(stopId = 'BOLH1') {
    await this.getServiceIdAtual(stopId);
  }

  /**
   * Devolve o service_id ativo hoje.
   * Consulta o proxy /{stopId}/services?date=YYYY-MM-DD e guarda em cache pelo dia.
   * Fallback para lógica por dia da semana se a API falhar.
   * @param {string} [stopId]
   * @returns {Promise<string>}
   */
  async getServiceIdAtual(stopId = 'BOLH1') {
    const dateNow = new Date();
    const dateKey = dateNow.toISOString().slice(0, 10); // YYYY-MM-DD

    if (this.cachedServiceDate === dateKey && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    if (this._serviceIdPromise) return this._serviceIdPromise;

    this._serviceIdPromise = (async () => {
      try {
        const data = await apiService.fetchStopServices(stopId, dateKey);
        if (data?.active_service_id) {
          this.cachedServiceDate = dateKey;
          this.cachedServiceId   = data.active_service_id;
          return data.active_service_id;
        }
      } catch (error) {
        console.warn('⚠️ Não foi possível obter service_id da API, a usar fallback local:', error);
      }
      const serviceId = this._getServiceIdByWeekday(dateNow);
      this.cachedServiceDate = dateKey;
      this.cachedServiceId   = serviceId;
      return serviceId;
    })().finally(() => { this._serviceIdPromise = null; });

    return this._serviceIdPromise;
  }

  /** Fallback por dia da semana */
  _getServiceIdByWeekday(date) {
    const d = date.getDay();
    if (d === 0) return 'DOMINGOS|FERIADOS';
    if (d === 6) return 'SÁBADOS';
    return 'DIAS UTEIS';
  }

  /**
   * Devolve o headsign (destino) de um trip_id.
   * O serviceId deve ser passado pelo chamador (já resolvido via getServiceIdAtual).
   * @param {string} tripId
   * @param {string} routeId
   * @param {string|number} directionId
   * @param {string} serviceId - service_id ativo (ex: "DOMINGOS|FERIADOS")
   * @returns {Promise<string>}
   */
  async getHeadsignForTrip(tripId, routeId, directionId, serviceId) {
    if (!tripId || !routeId || directionId == null || !serviceId) {
      console.warn(`⚠️ Parâmetros inválidos: tripId=${tripId}, routeId=${routeId}, dir=${directionId}, serviceId=${serviceId}`);
      return 'Destino desconhecido';
    }

    const schedule = await this.getRouteSchedule(routeId, serviceId, directionId);
    if (!schedule?.schedule) {
      console.warn(`⚠️ Sem schedule para ${routeId} (${serviceId}, dir ${directionId})`);
      return 'Destino desconhecido';
    }

    const trip = schedule.schedule.find(t => t.trip_id === tripId);
    if (trip?.trip_headsign) return trip.trip_headsign;

    // Fallback: primeiro trip da lista
    const first = schedule.schedule[0];
    if (first?.trip_headsign) {
      console.warn(`⚠️ Trip ${tripId} não encontrado, usando fallback: ${first.trip_headsign}`);
      return first.trip_headsign;
    }

    return 'Destino desconhecido';
  }

  /**
   * Obtém schedule completo de uma rota (com cache).
   */
  async getRouteSchedule(routeId, serviceId, directionId) {
    const cacheKey = `${routeId}_${serviceId}_${directionId}`;
    const cached   = this.routeSchedulesCache.get(cacheKey);
    const now      = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTTL) return cached.data;

    try {
      const data = await apiService.fetchRouteSchedule(routeId, serviceId, directionId);
      if (data) this.routeSchedulesCache.set(cacheKey, { data, timestamp: now });
      return data;
    } catch (error) {
      console.error(`❌ Erro ao obter schedule de ${routeId}:`, error);
      return cached?.data ?? null;
    }
  }

  clearCache() {
    this.cachedServiceDate = null;
    this.cachedServiceId   = null;
    this.routeSchedulesCache.clear();
  }
}

export const scheduleService = new ScheduleService();
