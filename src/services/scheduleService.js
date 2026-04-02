/**
 * Schedule Service - Lógica de horários e serviços
 * Usa: apiService, vehicleService
 *
 * IMPORTANTE: o service_id é SEMPRE obtido via API da STCP
 * (GET /{stopId}/services?date=YYYY-MM-DD).
 * O cálculo por dia da semana foi REMOVIDO por ser impreciso
 * (não cobre feriados nem períodos escolares).
 */

import { apiService } from '../core/apiService.js';
import { vehicleService } from './vehicleService.js';

class ScheduleService {
  constructor() {
    // Cache de schedules de rotas
    this.routeSchedulesCache = new Map(); // "route_service_dir" -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos

    // Cache de service_id por paragem+data
    // Chave: "stopId_YYYYMMDD" -> { serviceId, timestamp }
    this.stopServiceCache = new Map();

    // Último service_id válido obtido da API (usado como "global" por
    // getHeadsignForTrip que não tem stopId disponível)
    this._lastKnownServiceId   = null;
    this._lastKnownServiceDate = null; // "YYYYMMDD"
  }

  // ---------------------------------------------------------------------------
  // loadScheduleData: mantido por compatibilidade (não faz nada).
  // ---------------------------------------------------------------------------
  async loadScheduleData() {}

  // ---------------------------------------------------------------------------
  // fetchActiveServiceId(stopId) — obtém o service_id REAL da API da STCP.
  // É o único método autorizado a determinar o service_id.
  // ---------------------------------------------------------------------------
  async fetchActiveServiceId(stopId) {
    const dateNow  = new Date();
    const dateStr  = dateNow.toISOString().slice(0, 10);  // "2026-04-02"
    const yyyyMMdd = dateStr.replace(/-/g, '');            // "20260402"
    const cacheKey = `${stopId}_${yyyyMMdd}`;

    const cached = this.stopServiceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.serviceId;
    }

    try {
      const data = await apiService.fetchStopServices(stopId, dateStr);

      if (data?.active_service_id) {
        const serviceId = data.active_service_id;
        this.stopServiceCache.set(cacheKey, { serviceId, timestamp: Date.now() });
        // Guardar como último service_id conhecido (usado por getGlobalServiceId)
        this._lastKnownServiceId   = serviceId;
        this._lastKnownServiceDate = yyyyMMdd;
        console.debug(`[scheduleService] service_id para ${stopId}: ${serviceId}`);
        return serviceId;
      }
    } catch (error) {
      console.error(`❌ Erro ao obter service_id para ${stopId}:`, error);
    }

    // Sem fallback semanal — propagar erro para o chamador poder lidar
    throw new Error(`Não foi possível obter o service_id para a paragem ${stopId}. Verifique a ligação ao proxy.`);
  }

  // ---------------------------------------------------------------------------
  // getServiceIdForStop(stopId) — ponto de entrada preferêncial.
  // ---------------------------------------------------------------------------
  async getServiceIdForStop(stopId) {
    return this.fetchActiveServiceId(stopId);
  }

  // ---------------------------------------------------------------------------
  // getGlobalServiceId() — devolve o último service_id obtido da API.
  //
  // Usado por getHeadsignForTrip (que não tem stopId), desde que pelo menos
  // uma paragem já tenha sido consultada na sessão actual.
  //
  // Se ainda nenhuma paragem foi aberta, faz uma chamada com uma paragem
  // bem conhecida (CAMP2 — Campanã) para inicializar o service_id.
  // ---------------------------------------------------------------------------
  async getGlobalServiceId() {
    const yyyyMMdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Cache válido para hoje
    if (this._lastKnownServiceId && this._lastKnownServiceDate === yyyyMMdd) {
      return this._lastKnownServiceId;
    }

    // Ainda não inicializado: consultar uma paragem genérica para obter o service_id
    console.debug('[scheduleService] getGlobalServiceId: a inicializar com paragem CAMP2...');
    return this.fetchActiveServiceId('CAMP2');
  }

  // ---------------------------------------------------------------------------
  // getHeadsignForTrip — resolve o destino de um autocarro pelo trip_id.
  //
  // USA getGlobalServiceId() — NUNCA o cálculo por dia da semana.
  // Usa vehicleService.matchTripIds() para tolerar a diferença no
  // 2º segmento numérico do trip_id (ex: 218 vs 219).
  // ---------------------------------------------------------------------------
  async getHeadsignForTrip(tripId, routeId, directionId) {
    if (!tripId || !routeId || directionId == null) {
      console.warn(`⚠️ Parâmetros inválidos: tripId=${tripId}, routeId=${routeId}, dir=${directionId}`);
      return 'Destino Desconhecido';
    }

    const vehicleKey = vehicleService.tripMatchKey(tripId);
    console.debug(`[headsign] tripId=${tripId} (chave=${vehicleKey}), rota=${routeId}, dir=${directionId}`);

    try {
      const serviceId = await this.getGlobalServiceId();
      console.debug(`[headsign] service_id usado: ${serviceId}`);

      const schedule = await this.getRouteSchedule(routeId, serviceId, directionId);

      if (!schedule || !schedule.schedule) {
        console.warn(`⚠️ Sem schedule para ${routeId} (${serviceId}, dir ${directionId})`);
        return 'Destino Desconhecido';
      }

      // 1º tentativa: match exacto
      let trip = schedule.schedule.find(t => t.trip_id === tripId);

      // 2ª tentativa: match tolerante (ignora 2º segmento numérico)
      if (!trip) {
        trip = schedule.schedule.find(t => vehicleService.matchTripIds(t.trip_id, tripId));
        if (trip) {
          console.debug(`[headsign] match tolerante: schedule trip_id=${trip.trip_id} → ${trip.trip_headsign}`);
        }
      } else {
        console.debug(`[headsign] match exacto: trip_id=${trip.trip_id} → ${trip.trip_headsign}`);
      }

      if (trip?.trip_headsign) return trip.trip_headsign;

      // Sem match: mostrar amostras para diagnóstico
      const sampleIds = schedule.schedule.slice(0, 3).map(t => t.trip_id);
      console.warn(`⚠️ Trip ${tripId} (chave: ${vehicleKey}) não encontrado no schedule.`,
        'Primeiros trip_ids disponíveis:', sampleIds);

      const firstTrip = schedule.schedule[0];
      if (firstTrip?.trip_headsign) {
        console.warn(`⚠️ Usando fallback: ${firstTrip.trip_headsign}`);
        return firstTrip.trip_headsign;
      }

      return 'Destino Desconhecido';
    } catch (error) {
      console.error(`❌ Erro ao obter headsign para trip ${tripId}:`, error);
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
      console.error(`❌ Erro ao obter schedule de ${routeId}:`, error);
      if (cached) {
        console.warn('⚠️ A usar cache expirado como fallback');
        return cached.data;
      }
      return null;
    }
  }

  isHoliday(yyyyMMdd) { return false; }       // mantido por compatibilidade
  isSchoolHoliday(yyyyMMdd) { return false; }  // mantido por compatibilidade

  clearCache() {
    this._lastKnownServiceId   = null;
    this._lastKnownServiceDate = null;
    this.routeSchedulesCache.clear();
    this.stopServiceCache.clear();
  }
}

export const scheduleService = new ScheduleService();
