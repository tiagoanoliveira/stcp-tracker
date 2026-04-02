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
  //
  // Consulta GET https://stcp.pt/api/stops/{stopId}/services?date={YYYY-MM-DD}
  // e devolve o campo active_service_id.
  // Guarda em cache por 30 minutos por paragem+data.
  //
  // Em caso de falha retorna o valor do fallback síncrono (getServiceIdAtual).
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
        // Actualizar também o fallback síncrono para que getServiceIdAtual()
        // devolva o valor correcto enquanto o cache estiver válido.
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
  // Chame este método em vez de getServiceIdAtual() sempre que tiver um stopId.
  // ---------------------------------------------------------------------------
  async getServiceIdForStop(stopId) {
    return this.fetchActiveServiceId(stopId);
  }

  // ---------------------------------------------------------------------------
  // getHeadsignForTrip — sem alterações de assinatura; usa getServiceIdAtual()
  // internamente pois apenas tem o routeId, não o stopId.
  // ---------------------------------------------------------------------------
  async getHeadsignForTrip(tripId, routeId, directionId) {
    if (!tripId || !routeId || directionId == null) {
      console.warn(`\u26a0\ufe0f Parâmetros inválidos: tripId=${tripId}, routeId=${routeId}, dir=${directionId}`);
      return 'Destino Desconhecido';
    }

    try {
      const serviceId = this.getServiceIdAtual();
      const schedule  = await this.getRouteSchedule(routeId, serviceId, directionId);

      if (!schedule || !schedule.schedule) {
        console.warn(`\u26a0\ufe0f Sem schedule para ${routeId} (${serviceId}, dir ${directionId})`);
        return 'Destino Desconhecido';
      }

      const trip = schedule.schedule.find(t => t.trip_id === tripId);
      if (trip?.trip_headsign) return trip.trip_headsign;

      // Fallback: primeiro trip
      const firstTrip = schedule.schedule[0];
      if (firstTrip?.trip_headsign) {
        console.warn(`\u26a0\ufe0f Trip ${tripId} não encontrado, usando fallback: ${firstTrip.trip_headsign}`);
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
