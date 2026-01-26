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
      console.log(`🔍 A combinar chegadas tempo real + programadas para ${stopId} (próximos ${maxMinutes}min)...`);
      
      // 1. Buscar chegadas em tempo real
      const realtimeData = await apiService.fetchStopRealtime(stopId);
      const realtimeArrivals = realtimeData?.arrivals || [];
      
      console.log(`✓ ${realtimeArrivals.length} chegadas em tempo real`);
      
      // 2. Buscar rotas que servem esta paragem
      const routes = await this.getStopRoutes(stopId);
      
      if (routes.length === 0) {
        console.log('⚠ Nenhuma rota encontrada para esta paragem');
        return this.formatArrivals(realtimeArrivals, true);
      }
      
      console.log(`✓ ${routes.length} rotas encontradas`);
      
      // 3. Buscar schedules de cada rota
      const scheduledArrivals = [];
      const currentServiceId = scheduleService.getServiceIdAtual();
      
      console.log(`📅 Service ID atual: ${currentServiceId}`);
      
      for (const route of routes) {
        const scheduleData = await this.getStopSchedule(stopId, route.route_id, currentServiceId);
        
        if (scheduleData && scheduleData.schedule) {
          // Extrair próximas chegadas do schedule
          const upcomingTrips = this.extractUpcomingTrips(scheduleData.schedule, maxMinutes, route);
          console.log(`🔍 Rota ${route.route_short_name}: ${upcomingTrips.length} viagens encontradas`);
          scheduledArrivals.push(...upcomingTrips);
        } else {
          console.log(`⚠ Nenhum schedule encontrado para rota ${route.route_short_name}`);
        }
      }
      
      console.log(`✓ ${scheduledArrivals.length} chegadas programadas encontradas`);
      
      // 4. Combinar e remover duplicados
      const combined = this.combineArrivals(
        this.formatArrivals(realtimeArrivals, true),
        this.formatArrivals(scheduledArrivals, false)
      );
      
      console.log(`✅ ${combined.length} chegadas totais (sem duplicados)`);
      
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
      console.log(`✓ Rotas de ${stopId} obtidas do cache`);
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
      console.log(`✓ Schedule de ${routeId} (${serviceId}) para ${stopId} obtido do cache`);
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
   * @param {Object} schedule - Objeto com horas como chaves (ex: { "21": [...], "22": [...] })
   * @param {number} maxMinutes - Minutos máximos para procurar
   * @param {Object} route - Informação da rota
   */
  extractUpcomingTrips(schedule, maxMinutes, route) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const maxTotalMinutes = currentTotalMinutes + maxMinutes;
    
    console.log(`🕰️ [${route.route_short_name}] Hora atual: ${currentHour}:${currentMinute} (${currentTotalMinutes}min), procurando até ${maxTotalMinutes}min`);
    console.log(`📄 [${route.route_short_name}] Horas disponíveis no schedule:`, Object.keys(schedule));
    
    const upcomingTrips = [];
    
    // Iterar sobre as horas do schedule
    for (let hour = currentHour; hour <= 23 && (hour * 60) <= maxTotalMinutes; hour++) {
      const hourKey = hour.toString();
      const trips = schedule[hourKey];
      
      if (!trips || trips.length === 0) {
        continue;
      }
      
      console.log(`✓ [${route.route_short_name}] Hora ${hour}: ${trips.length} viagens`);
      
      // Iterar sobre as viagens dessa hora
      for (const trip of trips) {
        // A API retorna apenas 'minute', precisamos extrair a hora do arrival_time ou usar a hora do loop
        const tripMinute = parseInt(trip.minute);
        const tripTotalMinutes = hour * 60 + tripMinute;
        
        console.log(`  🚌 [${route.route_short_name}] Viagem ${hour}:${trip.minute} (${tripTotalMinutes}min) - Atual: ${currentTotalMinutes}min`);
        
        // Verificar se a viagem está no futuro e dentro do limite
        if (tripTotalMinutes >= currentTotalMinutes && tripTotalMinutes <= maxTotalMinutes) {
          const minutesUntilArrival = tripTotalMinutes - currentTotalMinutes;
          
          console.log(`  ✅ [${route.route_short_name}] ADICIONADA: ${trip.headsign} em ${minutesUntilArrival}min`);
          
          upcomingTrips.push({
            route_short_name: route.route_short_name,
            route_color: route.route_color,
            route_text_color: route.route_text_color,
            trip_headsign: trip.headsign, // A API retorna 'headsign' não 'trip_headsign'
            arrival_minutes: minutesUntilArrival,
            arrival_time: `${hour.toString().padStart(2, '0')}:${trip.minute.padStart(2, '0')}`,
            trip_id: trip.trip_id || null,
            status: 'SCHEDULED'
          });
        } else {
          console.log(`  ❌ [${route.route_short_name}] IGNORADA: fora do intervalo`);
        }
      }
    }
    
    console.log(`📋 [${route.route_short_name}] Total de viagens próximas: ${upcomingTrips.length}`);
    return upcomingTrips;
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
   */
  combineArrivals(realtimeArrivals, scheduledArrivals) {
    const combined = [...realtimeArrivals];
    
    for (const scheduled of scheduledArrivals) {
      // Verificar se já existe uma chegada em tempo real semelhante
      const isDuplicate = realtimeArrivals.some(realtime => {
        const sameRoute = realtime.route_short_name === scheduled.route_short_name;
        const sameHeadsign = this.normalizeHeadsign(realtime.trip_headsign) === 
                             this.normalizeHeadsign(scheduled.trip_headsign);
        const timeDiff = Math.abs(realtime.arrival_minutes - scheduled.arrival_minutes);
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
    console.log('🗑 Cache limpo');
  }
}

export const plannedArrivalsService = new PlannedArrivalsService();
