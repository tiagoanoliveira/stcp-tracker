/**
 * Schedule Service - Lógica de horários e serviços
 * Usa: apiService
 * Responsável por: determinar service_id, obter headsigns via API
 */

import { apiService } from '../core/apiService.js';
import { vehicleService } from './vehicleService.js';

class ScheduleService {
  constructor() {
    // Cache de schedules de rotas
    this.routeSchedulesCache = new Map(); // "route_service_dir" -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos

    // Cache de service_id por paragem+data (TTL igual ao acima)
    // Chave: "stopId_YYYYMMDD" -> { serviceId, timestamp }
    this.stopServiceCache = new Map();

    // Fallback síncrono (calculado localmente enquanto a API não responde)
    this.cachedServiceId = null;
    this.cachedServiceDate = null;
  }

  // ---------------------------------------------------------------------------
  // loadScheduleData: já não depende do calendar.json para determinar o
  // service_id — mantemos apenas para compatibilidade com código existente.
  // ---------------------------------------------------------------------------
  async loadScheduleData() {
    // Não é necessário carregar o calendar.json;
    // o service_id é agora obtido diretamente pela API da STCP.
  }

  // ---------------------------------------------------------------------------
  // getServiceIdAtual() — fallback síncrono baseado no dia da semana.
  // Usado apenas quando fetchActiveServiceId() ainda não devolveu resultado.
  // ---------------------------------------------------------------------------
  getServiceIdAtual() {
    const dateNow  = new Date();
    const yyyyMMdd = dateNow.toISOString().slice(0, 10).replace(/-/g, '');

    if (this.cachedServiceDate === yyyyMMdd && this.cachedServiceId) {
      return this.cachedServiceId;
    }

    const weekday = dateNow.getDay();
    let serviceId;
    if (weekday === 0)      serviceId = 'DOMINGOS|FERIADOS';
    else if (weekday === 6) serviceId = 'SABADOS';
    else                    serviceId = 'DIAS UTEIS';

    this.cachedServiceDate = yyyyMMdd;
    this.cachedServiceId   = serviceId;
    return serviceId;
  }

  // ---------------------------------------------------------------------------
  // fetchActiveServiceId(stopId) — obtém o service_id REAL da API da STCP.
  // ---------------------------------------------------------------------------
  async fetchActiveServiceId(stopId) {
    const dateNow  = new Date();
    const dateStr  = dateNow.toISOString().slice(0, 10);          // "2026-04-02"
    const yyyyMMdd = dateStr.replace(/-/g, '');                    // "20260402"
    const cacheKey = `${stopId}_${yyyyMMdd}`;

    // Verificar cache
    const cached = this.stopServiceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.serviceId;
    }

    try {
      const data = await apiService.fetchStopServices(stopId, dateStr);

      if (data?.active_service_id) {
        const serviceId = data.active_service_id;
        this.stopServiceCache.set(cacheKey, { serviceId, timestamp: Date.now() });
        this.cachedServiceDate = yyyyMMdd;
        this.cachedServiceId   = serviceId;
        return serviceId;
      }
    } catch (error) {
      console.error(`\u274c Erro ao obter service_id para ${stopId}:`, error);
    }

    // Fallback: cálculo local pelo dia da semana
    console.warn(`\u26a0\ufe0f fetchActiveServiceId: a usar fallback síncrono para ${stopId}`);
    return this.getServiceIdAtual();
  }

  // ---------------------------------------------------------------------------
  // getServiceIdForStop(stopId) — ponto de entrada preferêncial.
  // ---------------------------------------------------------------------------
  async getServiceIdForStop(stopId) {
    return this.fetchActiveServiceId(stopId);
  }

  // ---------------------------------------------------------------------------
  // getHeadsignForTrip — resolve o destino de um autocarro pelo trip_id.
  //
  // PROBLEMA CORRIGIDO: a comparação anterior usava t.trip_id === tripId
  // (exacta), o que falhava porque o trip_id do veículo contém um segmento
  // numérico variável (ex: "218") que difere do trip_id no schedule da rota
  // (ex: "219"). Agora usa vehicleService.matchTripIds() para tolerar
  // essa diferença, comparando apenas:
  //   <linha_dir> | <dia> | <turno> | <nº_serviço>
  // e ignorando o 2º segmento.
  // ---------------------------------------------------------------------------
  async getHeadsignForTrip(tripId, routeId, directionId) {
    if (!tripId || !routeId || directionId == null) {
      console.warn(`\u26a0\ufe0f Parâmetros inválidos: tripId=${tripId}, routeId=${routeId}, dir=${directionId}`);
      return 'Destino Desconhecido';
    }

    const vehicleKey = vehicleService.tripMatchKey(tripId);
    console.debug(`[headsign] a resolver tripId=${tripId} → chave=${vehicleKey}, rota=${routeId}, dir=${directionId}`);

    try {
      const serviceId = this.getServiceIdAtual();
      const schedule  = await this.getRouteSchedule(routeId, serviceId, directionId);

      if (!schedule || !schedule.schedule) {
        console.warn(`\u26a0\ufe0f Sem schedule para ${routeId} (${serviceId}, dir ${directionId})`);
        return 'Destino Desconhecido';
      }

      // Procurar primeiro por match exacto, depois por match tolerante
      let trip = schedule.schedule.find(t => t.trip_id === tripId);

      if (!trip) {
        trip = schedule.schedule.find(t => vehicleService.matchTripIds(t.trip_id, tripId));
        if (trip) {
          console.debug(`[headsign] match tolerante: schedule trip_id=${trip.trip_id} → ${trip.trip_headsign}`);
        }
      } else {
        console.debug(`[headsign] match exacto: trip_id=${trip.trip_id} → ${trip.trip_headsign}`);
      }

      if (trip?.trip_headsign) return trip.trip_headsign;

      // Fallback: listar os primeiros trip_ids disponíveis para ajudar na depuração
      const sampleIds = schedule.schedule.slice(0, 3).map(t => t.trip_id);
      console.warn(`\u26a0\ufe0f Trip ${tripId} (chave: ${vehicleKey}) não encontrado no schedule.`,
        `Primeiros trip_ids disponíveis:`, sampleIds);

      const firstTrip = schedule.schedule[0];
      if (firstTrip?.trip_headsign) {
        console.warn(`\u26a0\ufe0f Usando fallback: ${firstTrip.trip_headsign}`);
        return firstTrip.trip_headsign;
      }

      return 'Destino Desconhecido';
    } catch (error) {
      console.error(`\u274c Erro ao obter headsign para trip ${tripId}:`, error);
      return 'Destino Desconhecido';
    }
  }

  async getRouteSchedule(routeId, serviceId, directionId) {
    const cacheKey = `${routeId}_${serviceId}_${directionId}`;
    const cached   = this.routeSchedulesCache.get(cacheKey);
    const now      = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    try {
      const data = await apiService.fetchRouteSchedule(routeId, serviceId, directionId);
      if (data) {
        this.routeSchedulesCache.set(cacheKey, { data, timestamp: now });
      }
      return data;
    } catch (error) {
      console.error(`\u274c Erro ao obter schedule de ${routeId}:`, error);
      if (cached) {
        console.warn('\u26a0\ufe0f A usar cache expirado como fallback');
        return cached.data;
      }
      return null;
    }
  }

  isHoliday(yyyyMMdd) { return false; }     // mantido por compatibilidade
  isSchoolHoliday(yyyyMMdd) { return false; } // mantido por compatibilidade

  clearCache() {
    this.cachedServiceDate = null;
    this.cachedServiceId   = null;
    this.routeSchedulesCache.clear();
    this.stopServiceCache.clear();
  }
}

export const scheduleService = new ScheduleService();
