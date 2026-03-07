/**
 * Stop Service - Gestão de paragens usando API STCP
 * Usa: apiService
 * Responsável por: obter paragens próximas via API, pesquisa via API, cache inteligente
 */

import { apiService } from '../core/apiService.js';

class StopService {
  constructor() {
    // Cache de paragens por localização e raio
    this.nearbyCache = new Map(); // "lat_lng_radius" -> { data, timestamp }
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
    
    // Cache global de paragens já vistas (para pesquisa local rápida)
    this.allStopsCache = new Map(); // stopId -> stop data
  }

  /**
   * PRINCIPAL: Obtém paragens próximas via API
   */
  async getNearbyStops(lat, lng, radius = 1000) {
    const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${radius}`;
    const cached = this.nearbyCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      console.log(`💾 Cache hit: ${cacheKey}`);
      return cached.data;
    }
    
    console.log(`🌐 Fetching nearby stops: ${lat}, ${lng}, ${radius}m`);
    
    try {
      const response = await apiService.fetchNearbyStops(lat, lng, radius);
      const stops = response.stops || [];
      
      const normalized = stops.map(s => {
        const stop = {
          stop_id: s.code || s.id,
          stop_code: s.code,
          stop_name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          distance: s.distance,
          zone_id: s.zone_id,
          routes: s.routes || []
        };
        this.allStopsCache.set(stop.stop_id, stop);
        return stop;
      });
      
      this.nearbyCache.set(cacheKey, { data: normalized, timestamp: now });
      console.log(`✅ ${normalized.length} paragens carregadas`);
      return normalized;
      
    } catch (error) {
      console.error('❌ Erro ao obter paragens próximas:', error);
      if (cached) {
        console.warn('⚠️ A usar cache expirado como fallback');
        return cached.data;
      }
      return [];
    }
  }

  /**
   * ⭐ Pesquisa de paragens por nome ou código.
   * - Tenta primeiro o cache local (instantâneo)
   * - Se não encontrar, faz pesquisa via API STCP (/search?q=...)
   * @param {string} query - Texto de pesquisa
   * @returns {Promise<Array>} Array de paragens encontradas
   */
  async searchStops(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    // 1. Pesquisa no cache local
    const localResults = [];
    for (const stop of this.allStopsCache.values()) {
      if (
        stop.stop_name.toLowerCase().includes(lowerQuery) ||
        (stop.stop_code && stop.stop_code.toLowerCase().includes(lowerQuery)) ||
        stop.stop_id.toLowerCase().includes(lowerQuery)
      ) {
        localResults.push(stop);
      }
    }
    
    if (localResults.length > 0) {
      console.log(`💾 Pesquisa local: ${localResults.length} resultados para "${query}"`);
      return localResults;
    }

    // 2. Cache local sem resultados → pesquisar via API STCP
    console.log(`🌐 Pesquisa via API: "${query}"`);
    try {
      const response = await apiService.fetchSearchStops(query);
      const stops = response.stops || [];
      
      if (stops.length === 0) {
        console.warn(`⚠️ API não encontrou paragens para "${query}"`);
        return [];
      }

      // Normalizar e adicionar ao cache global para futuras pesquisas locais
      const normalized = stops.map(s => {
        const stop = {
          stop_id: s.stop_id || s.code || s.id,
          stop_code: s.stop_code || s.code || s.id,
          stop_name: s.stop_name || s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          distance: null,
          zone_id: s.zone_id || null,
          routes: s.routes || []
        };
        this.allStopsCache.set(stop.stop_id, stop);
        return stop;
      });

      console.log(`✅ API encontrou ${normalized.length} paragens para "${query}"`);
      return normalized;

    } catch (error) {
      console.error(`❌ Erro na pesquisa de paragens "${query}":`, error);
      return [];
    }
  }

  /**
   * Obtém paragem por ID (do cache)
   */
  getStopById(id) {
    return this.allStopsCache.get(id) || null;
  }

  /**
   * Limpa cache (forçar refresh)
   */
  clearCache() {
    this.nearbyCache.clear();
    console.log('🧹 Cache de paragens limpo');
  }

  /**
   * Limpa cache expirado automaticamente
   */
  cleanupExpiredCache() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, value] of this.nearbyCache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.nearbyCache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`🧹 ${removed} entradas de cache expiradas removidas`);
    }
  }
}

export const stopService = new StopService();

// Limpeza automática de cache a cada 10 minutos
setInterval(() => {
  stopService.cleanupExpiredCache();
}, 10 * 60 * 1000);
