/**
 * Schedule Service - Lógica de horários e serviços
 * Simplificado: determina sempre service_id por dia (U/S/D), consulta calendar para períodos especiais
 */

import { apiService } from '../core/apiService.js';

class ScheduleService {
  constructor() {
    this.trips = [];
    this.specialPeriods = []; // Feriados e férias escolares
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
  }

  /**
   * Carregar todos os dados de horários
   */
  async loadScheduleData() {
    try {
      console.log('🔄 Carregando dados de horários...');
      [this.trips, this.specialPeriods] = await Promise.all([
        apiService.fetchTripsData(),
        apiService.fetchCalendarData()
      ]);
      console.log(`✓ ${this.trips.length} trips carregadas`);
      console.log(`✓ ${this.specialPeriods.length} períodos especiais carregados`);
    } catch (error) {
      console.error('❌ Erro ao carregar dados de horários:', error);
      this.trips = [];
      this.specialPeriods = [];
    }
  }

  /**
   * Obter service_id para a data atual (simplificado)
   * Retorna: U (Uteis), S (Sabado), D (Domingo), F (Uteis Ferias), G (Sabado Ferias), H (Domingo Ferias)
   */
  getServiceIdAtual() {
    const dateNow = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');

    // Verificar cache
    if (this.cachedServiceDate === yyyyMMdd && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    // Determinar tipo de dia base (U, S, D)
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
        // Feriados usam horário de domingo
        serviceId = 'DOMINGOS|FERIADOS';
        console.log(`🌟 FERIADO detectado - usando horário D (domingo)`);
      } else if (specialPeriod.description === 'FERIAS') {
        // Férias escolares: F (útil), G (sábado), H (domingo)
        if (weekday === 0) {
          serviceId = 'H';
        } else if (weekday === 6) {
          serviceId = 'G';
        } else {
          serviceId = 'F';
        }
        console.log(`🌙 FÉRIAS ESCOLARES detectadas - usando horário ${serviceId}`);
      }
    }

    // Cachear o resultado
    this.cachedServiceDate = yyyyMMdd;
    this.cachedServiceId = serviceId;
    
    console.log(`📏 Service ID determinado para ${yyyyMMdd}: ${serviceId}`);
    return serviceId;
  }

  /**
   * Obter destino/headsign para uma viagem específica
   * @param {string} line - Número da linha
   * @param {string} direction - Direção/sentido (0 ou 1)
   * @returns {string} Destino ou "Destino Desconhecido"
   */
  getDestination(line, direction) {
    const serviceId = this.getServiceIdAtual();
    
    if (!line || direction == null) {
      console.warn(`⚠ Parâmetros inválidos: line=${line}, direction=${direction}`);
      return 'Destino Desconhecido';
    }

    const directionStr = direction.toString();
    const trip = this.trips.find(t =>
      t.route_id === line &&
      t.direction_id === directionStr &&
      t.service_id === serviceId
    );

    if (!trip) {
      console.warn(`⚠ Nenhum trip encontrado para linha ${line}, direção ${direction}, service ${serviceId}`);
      return `Destino Desconhecido (${serviceId})`;
    }

    return trip.trip_headsign || 'Destino Desconhecido';
  }

  /**
   * Verificar se uma data é feriado
   * @param {string} yyyyMMdd - Data no formato YYYYMMDD
   * @returns {boolean}
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
   * @param {string} yyyyMMdd - Data no formato YYYYMMDD
   * @returns {boolean}
   */
  isSchoolHoliday(yyyyMMdd) {
    return this.specialPeriods.some(period => 
      period.description === 'FERIAS' &&
      period.start_date <= yyyyMMdd &&
      period.end_date >= yyyyMMdd
    );
  }

  /**
   * Limpar cache para forçar recalcular service_id
   */
  clearCache() {
    this.cachedServiceDate = null;
    this.cachedServiceId = null;
    console.log('🖮 Cache de service_id limpo');
  }
}

export const scheduleService = new ScheduleService();
