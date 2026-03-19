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
    
    // Períodos especiais (feriados, férias)
    this.specialPeriods = [];
    
    // Cache de service_id por data
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
  }

  /**
   * Carregar calendário (ainda necessário para determinar tipo de dia)
   */
  async loadScheduleData() {
    try {
      this.specialPeriods = await apiService.fetchCalendarData();
    } catch (error) {
      console.error('❌ Erro ao carregar calendário:', error);
      this.specialPeriods = [];
    }
  }

  /**
   * Obter service_id para a data atual
   * Retorna: "DIAS UTEIS", "SABADOS", "DOMINGOS|FERIADOS", "F", "G", "H"
   */
  getServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');

    // Verificar cache
    if (this.cachedServiceDate === yyyyMMdd && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    // Determinar tipo de dia base
    const weekday = dateNow.getDay();
    let serviceId;
    
    if (weekday === 0) {
      serviceId = 'DOMINGOS|FERIADOS'; // Domingo
    } else if (weekday === 6) {
      serviceId = 'SABADOS'; // Sábado
    } else {
      serviceId = 'DIAS UTEIS'; // Útil (segunda a sexta)
    }

    // Verificar se está num período especial
    const specialPeriod = this.specialPeriods.find(period => 
      period.start_date <= yyyyMMdd && period.end_date >= yyyyMMdd
    );

    if (specialPeriod) {
      if (specialPeriod.description === 'FERIADO') {
        serviceId = 'DOMINGOS|FERIADOS';
      } else if (specialPeriod.description === 'FERIAS') {
        if (weekday === 0) {
          serviceId = 'H';
        } else if (weekday === 6) {
          serviceId = 'G';
        } else {
          serviceId = 'F';
        }
      }
    }

    // Cachear o resultado
    this.cachedServiceDate = yyyyMMdd;
    this.cachedServiceId = serviceId;
    
    return serviceId;
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
      const serviceId = this.getServiceIdAtual();
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
   * Verificar se uma data é feriado
   */
  isHoliday(yyyyMMdd) {
    return this.specialPeriods.some(period => 
      period.description === 'FERIADO' &&
      period.start_date <= yyyyMMdd &&
      period.end_date >= yyyyMMdd
    );
  }

  /**
   * Verificar se uma data está em férias escolares
   */
  isSchoolHoliday(yyyyMMdd) {
    return this.specialPeriods.some(period => 
      period.description === 'FERIAS' &&
      period.start_date <= yyyyMMdd &&
      period.end_date >= yyyyMMdd
    );
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
