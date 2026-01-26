/**
 * Arrivals Prediction Service - Combina dados em tempo real com horários programados
 * Responsável por: cruzamento de realtime API com schedule API, merge inteligente
 */

import { apiService } from '../core/apiService.js';
import { scheduleService } from './scheduleService.js';
import { vehicleService } from './vehicleService.js';
import { getDifferenceInMinutes } from '../utils/dateHelpers.js';

class ArrivalsPredictionService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutos
  }

  /**
   * Obter todas as chegadas (real-time + programadas) para os próximos X minutos
   * @param {string} stopId - Código da paragem (ex: "CONT2")
   * @param {number} windowMinutes - Janela temporal em minutos (padrão: 60)
   * @returns {Promise<Array>} Array de chegadas ordenadas por tempo
   */
  async getNextArrivals(stopId, windowMinutes = 60) {
    try {
      console.log(`🔄 Obtendo chegadas para ${stopId} (próximos ${windowMinutes} min)...`);
      
      // 1. Buscar dados em tempo real (já existe)
      const realtimeData = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];
      
      // 2. Buscar rotas da paragem (com cache)
      const routes = await this.getStopRoutes(stopId);
      
      // 3. Buscar horários programados para cada rota (em paralelo)
      const scheduledArrivals = await this.getScheduledArrivals(stopId, routes);
      
      // 4. Merge: combinar realtime com programado (evitar duplicados)
      const mergedArrivals = this.mergeArrivals(realtimeArrivals, scheduledArrivals);
      
      // 5. Filtrar e ordenar por tempo
      const filtered = this.filterByTimeWindow(mergedArrivals, windowMinutes);
      
      console.log(`✓ ${filtered.length} chegadas (${realtimeArrivals.length} tempo real, ${scheduledArrivals.length} programadas)`);
      
      return filtered;
      
    } catch (error) {
      console.error('❌ Erro ao obter chegadas:', error);
      return [];
    }
  }

  /**
   * Obter rotas que servem uma paragem (com cache)
   */
  async getStopRoutes(stopId) {
    const cacheKey = `routes_${stopId}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://stcp.pt/api/stops/${stopId}/routes`;
      const response = await fetch(url);
      const data = await response.json();
      
      const routes = data.display_routes || [];
      this.setCached(cacheKey, routes);
      
      console.log(`✓ ${routes.length} rotas para paragem ${stopId}`);
      return routes;
      
    } catch (error) {
      console.error(`❌ Erro ao obter rotas da paragem ${stopId}:`, error);
      return [];
    }
  }

  /**
   * Obter horários programados para todas as rotas de uma paragem
   */
  async getScheduledArrivals(stopId, routes) {
    if (!routes || routes.length === 0) return [];
    
    const serviceId = scheduleService.getServiceIdAtual();
    
    // Buscar schedules de todas as rotas em paralelo
    const schedulePromises = routes.map(route => 
      this.getRouteSchedule(stopId, route.route_id, serviceId, route)
    );
    
    const schedules = await Promise.all(schedulePromises);
    
    // Processar todos os horários numa lista plana
    const arrivals = [];
    
    schedules.forEach((schedule, index) => {
      if (!schedule || !schedule.schedule) return;
      
      const route = routes[index];
      
      // Percorrer cada hora do schedule
      Object.entries(schedule.schedule).forEach(([hour, trips]) => {
        trips.forEach(trip => {
          arrivals.push({
            route_short_name: route.route_short_name,
            route_color: route.route_color,
            route_text_color: route.route_text_color,
            trip_headsign: trip.headsign,
            arrival_time: trip.arrival_time,
            direction_id: trip.direction_id,
            status: 'SCHEDULED',
            is_realtime: false,
            source: 'scheduled'
          });
        });
      });
    });
    
    return arrivals;
  }

  /**
   * Obter schedule de uma rota específica (com cache)
   */
  async getRouteSchedule(stopId, routeId, serviceId, route) {
    const cacheKey = `schedule_${stopId}_${routeId}_${serviceId}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      const url = `https://stcp.pt/api/stops/${stopId}/schedule?route_id=${routeId}&service_id=${encodedServiceId}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      this.setCached(cacheKey, data);
      return data;
      
    } catch (error) {
      console.warn(`⚠ Erro ao buscar schedule de ${routeId} (${serviceId}):`, error.message);
      return null;
    }
  }

  /**
   * Merge entre realtime e scheduled - evitar duplicados
   * Estratégia: 
   * 1. Adicionar todas as realtime (têm prioridade)
   * 2. Para cada scheduled, verificar se já existe realtime correspondente
   * 3. Se não existir, adicionar como scheduled
   */
  mergeArrivals(realtimeArrivals, scheduledArrivals) {
    const merged = [];
    
    // 1. Adicionar todas as realtime com flag
    realtimeArrivals.forEach(rt => {
      merged.push({
        ...rt,
        is_realtime: true,
        source: 'realtime'
      });
    });
    
    // 2. Adicionar scheduled que NÃO têm match com realtime
    scheduledArrivals.forEach(scheduled => {
      const hasMatch = realtimeArrivals.some(rt => 
        this.isMatchingTrip(rt, scheduled)
      );
      
      if (!hasMatch) {
        merged.push(scheduled);
      }
    });
    
    return merged;
  }

  /**
   * Verificar se uma chegada realtime corresponde a uma programada
   * Critérios:
   * 1. Mesma linha
   * 2. Mesmo destino
   * 3. Horário próximo (±5 minutos)
   */
  isMatchingTrip(realtime, scheduled) {
    // Critério 1: Linha
    if (realtime.route_short_name !== scheduled.route_short_name) {
      return false;
    }
    
    // Critério 2: Destino (comparação direta)
    if (realtime.trip_headsign !== scheduled.trip_headsign) {
      return false;
    }
    
    // Critério 3: Tempo (±5 minutos de tolerância)
    const rtTime = new Date(realtime.estimated_arrival_time);
    const schTime = this.parseScheduledTime(scheduled.arrival_time);
    
    if (!schTime) return false;
    
    const diffMinutes = Math.abs(getDifferenceInMinutes(schTime, rtTime));
    
    // Match se diferença <= 5 minutos
    return diffMinutes <= 5;
  }

  /**
   * Converter horário programado "HH:MM:SS" para Date de hoje
   */
  parseScheduledTime(timeStr) {
    if (!timeStr) return null;
    
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, seconds || 0, 0);
    
    // Se o horário já passou hoje, é para amanhã
    if (scheduled < now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }
    
    return scheduled;
  }

  /**
   * Filtrar chegadas por janela temporal e ordenar
   */
  filterByTimeWindow(arrivals, windowMinutes) {
    const now = new Date();
    
    return arrivals
      .map(arrival => {
        // Calcular tempo até chegada
        const arrivalTime = arrival.is_realtime
          ? new Date(arrival.estimated_arrival_time)
          : this.parseScheduledTime(arrival.arrival_time);
        
        if (!arrivalTime) return null;
        
        const minutesUntil = getDifferenceInMinutes(now, arrivalTime);
        
        return {
          ...arrival,
          arrival_minutes: minutesUntil,
          calculated_arrival_time: arrivalTime
        };
      })
      .filter(a => a && a.arrival_minutes >= 0 && a.arrival_minutes <= windowMinutes)
      .sort((a, b) => a.arrival_minutes - b.arrival_minutes);
  }

  /**
   * Cache helpers
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.cache.clear();
    console.log('🗑 Cache de arrivals limpo');
  }
}

export const arrivalsPredictionService = new ArrivalsPredictionService();
