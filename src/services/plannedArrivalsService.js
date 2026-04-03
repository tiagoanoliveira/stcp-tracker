/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Usa: apiService, scheduleService
 */

import { apiService } from '../core/apiService.js';
import { scheduleService } from './scheduleService.js';

class PlannedArrivalsService {
  constructor() {
    // Cache de rotas e schedules (válido por 30 minutos)
    this.routesCache = new Map(); // stopId -> { data, timestamp }
    this.schedulesCache = new Map(); // `${stopId}_${routeId}_${serviceId}` -> { data, timestamp }
    this.cacheTTL = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém próximas chegadas combinando tempo real + programadas
   * @param {string} stopId - Código da paragem
   * @param {number} maxMinutes - Tempo máximo para olhar à frente (ex: 60 minutos)
   * @returns {Promise<Array>} Array de chegadas ordenadas por tempo
   */
  async getNextArrivals(stopId, maxMinutes = 60) {
    try {
      // 1. Buscar chegadas em tempo real
      const realtimeData = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];

      // 2. Buscar rotas que servem esta paragem
      const routes = await this.getStopRoutes(stopId);

      if (routes.length === 0) {
        return this.formatArrivals(realtimeArrivals, true);
      }

      // 3. Obter o service_id ativo hoje (agora é async - consulta a API STCP)
      const currentServiceId = await scheduleService.getServiceIdAtual(stopId);

      // 4. Buscar schedules de cada rota
      const scheduledArrivals = [];

      for (const route of routes) {
        const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);

        if (scheduleData && scheduleData.schedule) {
          // Extrair próximas chegadas do schedule
          const upcomingTrips = this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route);
          scheduledArrivals.push(...upcomingTrips);
        }
      }
      // 5. Combinar e remover duplicados
      const combined = this.combineArrivals(
        this.formatArrivals(realtimeArrivals, true),
        this.formatArrivals(scheduledArrivals, false)
      );

      return combined;

    } catch (error) {
      console.error(`❌ Erro ao obter chegadas para ${stopId}:`, error);
      return [];
    }
  }

  /**
   * Buscar rotas que servem uma paragem (com cache)
   */
  async getStopRoutes(stopId) {
    const cached = this.routesCache.get(stopId);
    const now = Date.now();

    // Verificar se cache é válido
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    // Buscar da API
    const result = await apiService.fetchStopRoutes(stopId);
    const routes = result?.display_routes || [];

    // Guardar em cache
    this.routesCache.set(stopId, { data: routes, timestamp: now });

    return routes;
  }

  /**
   * Buscar schedule de uma rota numa paragem (com cache)
   */
  async getStopSchedule(stopId, routeId, serviceId) {
    const cacheKey = `${stopId}_${routeId}_${serviceId}`;
    const cached = this.schedulesCache.get(cacheKey);
    const now = Date.now();

    // Verificar se cache é válido
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    // Buscar da API
    const data = await apiService.fetchStopSchedule(stopId, routeId, serviceId);

    // Guardar em cache
    if (data) {
      this.schedulesCache.set(cacheKey, { data, timestamp: now });
    }

    return data;
  }

  /**
   * Extrair próximas viagens do schedule
   * Suporta horários após 24h (a STCP usa 24, 25, 26 para horários após meia-noite)
   * @param {Object} schedule - Objeto com horas como chaves (ex: { "21": [...], "24": [...] })
   * @param {number} maxMinutes - Minutos máximos para procurar
   * @param {Object} route - Informação da rota
   */
  extractUpcomingTrips(schedule, maxMinutes, route) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const maxTotalMinutes = currentTotalMinutes + maxMinutes;

    const upcomingTrips = [];

    // Determinar intervalo de horas a verificar
    // Se estamos perto da meia-noite (23h-24h), precisamos verificar horários 24h+
    const startHour = currentHour;
    let endHour = Math.min(23, Math.floor(maxTotalMinutes / 60));

    // Se maxTotalMinutes ultrapassa a meia-noite (>= 1440), verificar horários 24h+
    const checkAfterMidnight = maxTotalMinutes >= 1440;
    const afterMidnightEndHour = checkAfterMidnight ? Math.floor((maxTotalMinutes - 1440) / 60) + 24 : 0;

    // Processar horas normais (0-23)
    for (let hour = startHour; hour <= endHour; hour++) {
      this.processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips);
    }

    // Processar horas após meia-noite (24, 25, 26, etc.) se necessário
    if (checkAfterMidnight) {
      for (let hour = 24; hour <= afterMidnightEndHour; hour++) {
        this.processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips);
      }
    }

    return upcomingTrips;
  }

  /**
   * Processar viagens de uma hora específica
   */
  processHourTrips(schedule, hour, currentTotalMinutes, maxTotalMinutes, route, upcomingTrips) {
    const hourKey = hour.toString();
    const trips = schedule[hourKey];

    if (!trips || trips.length === 0) {
      return;
    }

    for (const trip of trips) {
      const tripMinute = parseInt(trip.minute);

      // Calcular minutos totais desde meia-noite
      // Para horas >= 24, representa horários do dia seguinte
      const tripTotalMinutes = hour * 60 + tripMinute;

      // Ajustar comparação se a viagem for depois da meia-noite (hora >= 24)
      let adjustedTripMinutes = tripTotalMinutes;
      let adjustedCurrentMinutes = currentTotalMinutes;

      if (hour >= 24) {
        // Viagem é no "dia seguinte" (após 24h)
        // Se hora atual é >= 23h, ajustar para considerar continuidade
        if (currentTotalMinutes >= 23 * 60) {
          // Estamos entre 23h-24h, então 24h é o futuro próximo
          adjustedCurrentMinutes = currentTotalMinutes;
        } else {
          // Estamos entre 0h-1h, tripTotalMinutes já está correto (>= 1440)
          // mas currentTotalMinutes precisa ser ajustado para 1440 + hora_atual
          adjustedCurrentMinutes = 1440 + currentTotalMinutes;
        }
      }

      // Verificar se a viagem está no futuro e dentro do limite
      // Usar < ao invés de <= para excluir exatamente maxMinutes
      if (adjustedTripMinutes >= adjustedCurrentMinutes && adjustedTripMinutes < maxTotalMinutes) {
        const minutesUntilArrival = adjustedTripMinutes - adjustedCurrentMinutes;

        // Formatar hora de exibição (converter 24h+ para 0h+)
        const displayHour = hour >= 24 ? hour - 24 : hour;

        upcomingTrips.push({
          route_short_name: route.route_short_name,
          route_color: route.route_color,
          route_text_color: route.route_text_color,
          trip_headsign: trip.headsign,
          arrival_minutes: minutesUntilArrival,
          arrival_time: `${displayHour.toString().padStart(2, '0')}:${trip.minute.padStart(2, '0')}`,
          trip_id: trip.trip_id || null,
          status: 'SCHEDULED'
        });
      }
    }
  }

  /**
   * Formatar chegadas num formato consistente
   */
  formatArrivals(arrivals, isRealtime) {
    return arrivals.map(arr => ({
      route_short_name: arr.route_short_name,
      route_color: arr.route_color || '#0072C6',
      route_text_color: arr.route_text_color || '#FFFFFF',
      trip_headsign: arr.trip_headsign,
      arrival_minutes: arr.arrival_minutes,
      arrival_time: arr.arrival_time,
      trip_id: arr.trip_id,
      status: arr.status || 'SCHEDULED',
      delay_minutes: arr.delay_minutes || 0,
      is_realtime: isRealtime
    }));
  }

  /**
   * Combinar chegadas tempo real + programadas, removendo duplicados
   * Critério de duplicado: mesma linha + mesmo destino + tempo próximo (±5 min)
   * IMPORTANTE: Para tempo real, usa (arrival_minutes - delay_minutes) para comparar com schedule
   */
  combineArrivals(realtimeArrivals, scheduledArrivals) {
    const combined = [...realtimeArrivals];

    for (const scheduled of scheduledArrivals) {
      // Verificar se já existe uma chegada em tempo real semelhante
      const isDuplicate = realtimeArrivals.some(realtime => {
        const sameRoute = realtime.route_short_name === scheduled.route_short_name;
        const sameHeadsign = this.normalizeHeadsign(realtime.trip_headsign) ===
                             this.normalizeHeadsign(scheduled.trip_headsign);

        // Ajustar tempo real para hora programada: arrival_minutes - delay_minutes
        // Se o autocarro está atrasado 5min e chega em 10min, deveria ter chegado em 5min (10-5)
        const realtimeScheduledTime = realtime.arrival_minutes - realtime.delay_minutes;
        const timeDiff = Math.abs(realtimeScheduledTime - scheduled.arrival_minutes);
        const closeInTime = timeDiff <= 5; // ±5 minutos

        return sameRoute && sameHeadsign && closeInTime;
      });

      // Se não for duplicado, adicionar
      if (!isDuplicate) {
        combined.push(scheduled);
      }
    }

    // Ordenar por tempo de chegada
    return combined.sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  /**
   * Normalizar headsign para comparação (remover espaços extras, maiúsculas, etc.)
   */
  normalizeHeadsign(headsign) {
    if (!headsign) return '';
    return headsign.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /**
   * Limpar cache (opcional, para forçar refresh)
   */
  clearCache() {
    this.routesCache.clear();
    this.schedulesCache.clear();
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
