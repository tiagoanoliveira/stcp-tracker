/**
 * Planned Arrivals Service - Combina chegadas em tempo real com horários programados
 * Usa apiService para todas as chamadas API
 */

import { apiService } from '../core/apiService.js';
import { scheduleService } from './scheduleService.js';
import { vehicleService } from './vehicleService.js';
import { getCurrentDayType } from '../utils/dateHelpers.js';

class PlannedArrivalsService {
  constructor() {
    this.routesCache = new Map(); // Cache de rotas por paragem
    this.schedulesCache = new Map(); // Cache de horários
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obtém as próximas chegadas combinando tempo real + programadas
   * @param {string} stopId - Código da paragem
   * @param {number} timeWindow - Janela de tempo em minutos (default: 60)
   * @returns {Promise<Array>} Lista de chegadas ordenadas por tempo
   */
  async getNextArrivals(stopId, timeWindow = 60) {
    try {
      // 1. Buscar chegadas em tempo real
      const realtimeData = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];
      
      // Marcar todas as chegadas em tempo real com is_realtime: true
      realtimeArrivals.forEach(arrival => {
        arrival.is_realtime = true;
      });

      // 2. Buscar rotas que servem esta paragem
      const routes = await this.getStopRoutes(stopId);
      
      if (!routes || routes.length === 0) {
        console.log('⚠ Nenhuma rota encontrada para esta paragem');
        return this.sortArrivals(realtimeArrivals);
      }

      // 3. Buscar horários programados para cada rota
      const scheduledArrivals = await this.getScheduledArrivals(stopId, routes, timeWindow);
      
      // 4. Combinar e remover duplicados
      const combinedArrivals = this.mergeArrivals(realtimeArrivals, scheduledArrivals);
      
      // 5. Ordenar por tempo de chegada
      return this.sortArrivals(combinedArrivals);
      
    } catch (error) {
      console.error('❌ Erro ao obter chegadas:', error);
      return [];
    }
  }

  /**
   * Obtém rotas que servem uma paragem (com cache)
   */
  async getStopRoutes(stopId) {
    const cacheKey = stopId;
    const cached = this.routesCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`✓ Rotas da paragem ${stopId} em cache`);
      return cached.data;
    }

    try {
      const routesData = await apiService.fetchStopRoutes(stopId);
      const routes = routesData.dropdown_routes || [];
      
      this.routesCache.set(cacheKey, {
        data: routes,
        timestamp: Date.now()
      });
      
      return routes;
    } catch (error) {
      console.error(`❌ Erro ao obter rotas da paragem ${stopId}:`, error);
      return [];
    }
  }

  /**
   * Obtém horários programados para as rotas de uma paragem
   */
  async getScheduledArrivals(stopId, routes, timeWindow) {
    const dayType = getCurrentDayType();
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endMinutes = currentMinutes + timeWindow;
    
    const allScheduledArrivals = [];

    for (const route of routes) {
      try {
        const cacheKey = `${stopId}_${route.route_id}_${dayType}`;
        let scheduleData = this.schedulesCache.get(cacheKey);
        
        // Verificar cache
        if (!scheduleData || Date.now() - scheduleData.timestamp >= this.cacheTimeout) {
          scheduleData = await apiService.fetchStopSchedule(stopId, route.route_id, dayType);
          
          if (scheduleData) {
            this.schedulesCache.set(cacheKey, {
              data: scheduleData,
              timestamp: Date.now()
            });
          }
        } else {
          scheduleData = scheduleData.data;
        }

        if (!scheduleData) continue;

        // Processar horários
        const arrivals = this.extractScheduledArrivals(
          scheduleData,
          route,
          currentMinutes,
          endMinutes
        );
        
        allScheduledArrivals.push(...arrivals);
        
      } catch (error) {
        console.error(`❌ Erro ao processar rota ${route.route_id}:`, error);
      }
    }

    return allScheduledArrivals;
  }

  /**
   * Extrai chegadas programadas do schedule data
   */
  extractScheduledArrivals(scheduleData, route, currentMinutes, endMinutes) {
    const arrivals = [];
    
    // Iterar sobre as horas do schedule
    for (const [hour, scheduleInfo] of Object.entries(scheduleData)) {
      if (hour === 'pattern_colors') continue;
      
      const hourNum = parseInt(hour);
      const times = scheduleInfo.times || [];
      
      times.forEach(time => {
        const [h, m] = time.split(':').map(Number);
        const totalMinutes = h * 60 + m;
        
        // Filtrar apenas chegadas dentro da janela de tempo
        if (totalMinutes >= currentMinutes && totalMinutes <= endMinutes) {
          const minutesUntilArrival = totalMinutes - currentMinutes;
          
          arrivals.push({
            route_short_name: route.route_id,
            route_color: route.route_color || '#0072C6',
            route_text_color: route.route_text_color || '#FFFFFF',
            trip_headsign: route.route_long_name || route.route_id,
            arrival_time: time,
            arrival_minutes: minutesUntilArrival,
            status: 'SCHEDULED',
            is_realtime: false,
            trip_id: null, // Não temos trip_id para programados
            delay_minutes: 0
          });
        }
      });
    }
    
    return arrivals;
  }

  /**
   * Combina chegadas em tempo real com programadas, removendo duplicados
   * Critério de duplicação: mesma linha + mesmo destino + tempo próximo (±5 min)
   */
  mergeArrivals(realtimeArrivals, scheduledArrivals) {
    const merged = [...realtimeArrivals];
    
    for (const scheduled of scheduledArrivals) {
      const isDuplicate = realtimeArrivals.some(realtime => {
        return (
          realtime.route_short_name === scheduled.route_short_name &&
          this.normalizeHeadsign(realtime.trip_headsign) === this.normalizeHeadsign(scheduled.trip_headsign) &&
          Math.abs(realtime.arrival_minutes - scheduled.arrival_minutes) <= 5
        );
      });
      
      if (!isDuplicate) {
        merged.push(scheduled);
      }
    }
    
    return merged;
  }

  /**
   * Normaliza headsign para comparação (remove espaços, acentos, maiúsculas)
   */
  normalizeHeadsign(headsign) {
    if (!headsign) return '';
    return headsign
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Ordena chegadas por tempo de chegada
   */
  sortArrivals(arrivals) {
    return arrivals.sort((a, b) => {
      return (a.arrival_minutes || 0) - (b.arrival_minutes || 0);
    });
  }

  /**
   * Limpa caches
   */
  clearCache() {
    this.routesCache.clear();
    this.schedulesCache.clear();
    console.log('✓ Cache de rotas e horários limpo');
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
