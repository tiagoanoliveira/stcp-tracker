/**
 * Schedule Service - Lógica de horários e serviços
 * Usa: apiService
 * Responsável por: determinar service_id, obter headsigns via API
 */

import { apiService } from '../core/apiService.js';

class ScheduleService {
  constructor() {
    // Cache de schedules de rotas
    this.routeSchedulesCache = new Map(); // "route_service_dir" -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos

    // Cache de service_id por data (chave: YYYY-MM-DD)
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
    // Promise em andamento para evitar chamadas duplicadas
    this._serviceIdPromise = null;
  }

  /**
   * Obter service_id para a data atual
   * Usa o endpoint /stops/{id}/services?date={date} da API STCP.
   * Faz fallback para lógica local se a API falhar.
   * @param {string} [stopId] - Qualquer paragem válida para consultar o serviço (default: BOLH1)
   * @returns {Promise<string>} service_id ativo hoje
   */
  async getServiceIdAtual(stopId = 'BOLH1') {
    const dateNow = new Date();
    const dateKey = dateNow.toISOString().slice(0, 10); // YYYY-MM-DD

    // Devolver do cache se ainda for válido para hoje
    if (this.cachedServiceDate === dateKey && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    // Evitar chamadas duplicadas em paralelo
    if (this._serviceIdPromise) {
      return this._serviceIdPromise;
    }

    this._serviceIdPromise = (async () => {
      try {
        const data = await apiService.fetchStopServices(stopId, dateKey);
        if (data && data.active_service_id) {
          const serviceId = data.active_service_id;
          this.cachedServiceDate = dateKey;
          this.cachedServiceId = serviceId;
          return serviceId;
        }
      } catch (error) {
        console.warn('⚠️ Não foi possível obter service_id da API, a usar fallback local:', error);
      }

      // Fallback: determinar pelo dia da semana
      const serviceId = this._getServiceIdByWeekday(dateNow);
      this.cachedServiceDate = dateKey;
      this.cachedServiceId = serviceId;
      return serviceId;
    })().finally(() => {
      this._serviceIdPromise = null;
    });

    return this._serviceIdPromise;
  }

  /**
   * Fallback: determinar service_id apenas pelo dia da semana
   * (usado quando a API não está disponível)
   */
  _getServiceIdByWeekday(date) {
    const weekday = date.getDay();
    if (weekday === 0) return 'DOMINGOS|FERIADOS';
    if (weekday === 6) return 'SÁBADOS';
    return 'DIAS UTEIS';
  }

  /**
   * ⭐ NOVO: Obtém headsign de um trip_id via API
   * @param {string} tripId - ID da viagem
   * @param {string} routeId - ID da rota (ex: "200")
   * @param {string|number} directionId - Direção (0 ou 1)
   * @returns {Promise<string>} Headsign/destino
   */
  async getHeadsignForTrip(tripId, routeId, directionId) {
    if (!tripId || !routeId || directionId == null) {
      console.warn(`⚠️ Parâmetros inválidos: tripId=${tripId}, routeId=${routeId}, dir=${directionId}`);
      return 'Destino Desconhecido';
    }

    try {
      const serviceId = await this.getServiceIdAtual();
      const schedule = await this.getRouteSchedule(routeId, serviceId, directionId);

      if (!schedule || !schedule.schedule) {
        console.warn(`⚠️ Sem schedule para ${routeId} (${serviceId}, dir ${directionId})`);
        return 'Destino Desconhecido';
      }

      // Procurar trip no schedule
      const trip = schedule.schedule.find(t => t.trip_id === tripId);

      if (trip && trip.trip_headsign) {
        return trip.trip_headsign;
      }

      // Fallback: usar o primeiro trip da mesma direção
      const firstTrip = schedule.schedule[0];
      if (firstTrip && firstTrip.trip_headsign) {
        console.warn(`⚠️ Trip ${tripId} não encontrado, usando fallback: ${firstTrip.trip_headsign}`);
        return firstTrip.trip_headsign;
      }

      return 'Destino Desconhecido';

    } catch (error) {
      console.error(`❌ Erro ao obter headsign para trip ${tripId}:`, error);
      return 'Destino Desconhecido';
    }
  }

  /**
   * ⭐ NOVO: Obtém schedule completo de uma rota (com cache)
   * @param {string} routeId - ID da rota
   * @param {string} serviceId - ID do serviço
   * @param {string|number} directionId - Direção
   * @returns {Promise<Object>} Schedule da rota
   */
  async getRouteSchedule(routeId, serviceId, directionId) {
    const cacheKey = `${routeId}_${serviceId}_${directionId}`;
    const cached = this.routeSchedulesCache.get(cacheKey);
    const now = Date.now();

    // Verificar cache
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    try {
      // Buscar da API
      const data = await apiService.fetchRouteSchedule(routeId, serviceId, directionId);

      if (data) {
        // Guardar em cache
        this.routeSchedulesCache.set(cacheKey, { data, timestamp: now });
      }

      return data;

    } catch (error) {
      console.error(`❌ Erro ao obter schedule de ${routeId}:`, error);

      // Retornar cache antigo se existir
      if (cached) {
        console.warn('⚠️ A usar cache expirado como fallback');
        return cached.data;
      }

      return null;
    }
  }

  /**
   * Limpar cache
   */
  clearCache() {
    this.cachedServiceDate = null;
    this.cachedServiceId = null;
    this.routeSchedulesCache.clear();
  }
}

export const scheduleService = new ScheduleService();
