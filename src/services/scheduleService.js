/**
 * Schedule Service - Lógica de horários e serviços
 * Usa: apiService
 */

import { apiService } from '../core/apiService.js';

// Paragem usada para consultar o service_id ativo.
// O serviço (horário de dia útil, sábado, etc.) é igual para toda a rede
// numa dada data, por isso qualquer paragem válida serve.
const SERVICE_PROBE_STOP = 'CMO';

class ScheduleService {
  constructor() {
    this.routeSchedulesCache = new Map(); // "routeId_serviceId_dir" -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos

    this.cachedServiceId   = null;
    this.cachedServiceDate = null;
    this._serviceIdPromise = null;
  }

  /**
   * Chamado pelo BusMapApp na inicialização.
   * Pré-aquece o cache do service_id para que todas as chamadas
   * subsequentes o encontrem já resolvido.
   */
  async loadScheduleData() {
    await this.getServiceIdAtual();
  }

  /**
   * Devolve o service_id ativo hoje (ex: "DOMINGOS|FERIADOS").
   * Consulta o proxy /CMO/services?date=YYYY-MM-DD e guarda em cache pelo dia.
   * Fallback para lógica por dia da semana se a API falhar.
   * @returns {Promise<string>}
   */
  async getServiceIdAtual() {
    const dateNow = new Date();
    const dateKey = dateNow.toISOString().slice(0, 10); // YYYY-MM-DD

    if (this.cachedServiceDate === dateKey && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    if (this._serviceIdPromise) return this._serviceIdPromise;

    this._serviceIdPromise = (async () => {
      try {
        const data = await apiService.fetchStopServices(SERVICE_PROBE_STOP, dateKey);
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
   * Chave de matching que ignora o nr_viagem (2º segmento do trip_id).
   * Formato: {linha}_{dir}_{seq}|{nr_viagem}|{dia}|{turno}|{servico}
   * Chave:   {linha}_{dir}_{seq}|{dia}|{turno}|{servico}
   * Se o trip_id não tiver pipes suficientes, devolve o próprio valor.
   */
  _tripMatchKey(tripId) {
    if (!tripId) return null;
    const parts = tripId.split('|');
    if (parts.length < 5) return tripId;
    // prefixo | dia | turno | servico  (descarta parts[1] = nr_viagem)
    return `${parts[0]}|${parts[2]}|${parts[3]}|${parts[4]}`;
  }

  /**
   * Devolve o headsign (destino) de um trip_id.
   * Compara os trip_ids ignorando o nr_viagem para tolerar diferenças
   * entre o valor do FIWARE e o valor nos schedules da API STCP.
   * @param {string} tripId     - trip_id do autocarro (ex: "204_0_2|218|D6|T8|N15")
   * @param {string} routeId    - número da linha (ex: "204")
   * @param {string|number} directionId
   * @param {string} serviceId  - service_id ativo (ex: "DOMINGOS|FERIADOS")
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

    const searchKey = this._tripMatchKey(tripId);

    // Procura exata primeiro; se falhar, compara por chave sem nr_viagem
    const trip = schedule.schedule.find(t =>
      t.trip_id === tripId || this._tripMatchKey(t.trip_id) === searchKey
    );

    if (trip?.trip_headsign) return trip.trip_headsign;

    // Fallback: primeiro trip da lista
    const first = schedule.schedule[0];
    if (first?.trip_headsign) {
      console.warn(`⚠️ Trip ${tripId} não encontrado no schedule, usando fallback: ${first.trip_headsign}`);
      return first.trip_headsign;
    }

    return 'Destino desconhecido';
  }

  /**
   * Obtém schedule completo de uma rota (com cache 30 min).
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
