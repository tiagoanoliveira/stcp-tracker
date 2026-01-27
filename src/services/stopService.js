/**
 * Stop Service - Gestão de paragens usando API STCP
 * Usa: apiService
 * Responsável por: obter paragens próximas via API, cache inteligente
 */

import { apiService } from '../core/apiService.js';

class StopService {
  constructor() {
    // Cache de paragens por localização e raio
    this.nearbyCache = new Map(); // "lat_lng_radius" -> { data, timestamp }
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos
    
    // Cache global de paragens já vistas (para pesquisa)
    this.allStopsCache = new Map(); // stopId -> stop data
  }

  /**
   * ⭐ PRINCIPAL: Obtém paragens próximas via API
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} radius - Raio em metros (padrão: 1000m)
   * @returns {Promise<Array>} Array de paragens ordenadas por distância
   */
  async getNearbyStops(lat, lng, radius = 1000) {
    // Arredondar coordenadas para cache (4 casas decimais = ~11m precisão)
    const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${radius}`;
    const cached = this.nearbyCache.get(cacheKey);
    const now = Date.now();
    
    // Verificar cache
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      console.log(`💾 Cache hit: ${cacheKey}`);
      return cached.data;
    }
    
    console.log(`🌐 Fetching nearby stops: ${lat}, ${lng}, ${radius}m`);
    
    try {
      // Buscar da API
      const response = await apiService.fetchNearbyStops(lat, lng, radius);
      const stops = response.stops || [];
      
      // Normalizar estrutura
      const normalized = stops.map(s => {
        const stop = {
          stop_id: s.code || s.id,
          stop_code: s.code,
          stop_name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          distance: s.distance,
          zone_id: s.zone_id,
          routes: s.routes || [] // ✨ Já vem da API!
        };
        
        // Adicionar ao cache global
        this.allStopsCache.set(stop.stop_id, stop);
        
        return stop;
      });
      
      // Guardar em cache
      this.nearbyCache.set(cacheKey, { data: normalized, timestamp: now });
      
      console.log(`✅ ${normalized.length} paragens carregadas`);
      return normalized;
      
    } catch (error) {
      console.error('❌ Erro ao obter paragens próximas:', error);
      
      // Retornar cache antigo se existir (melhor que nada)
      if (cached) {
        console.warn('⚠️ A usar cache expirado como fallback');
        return cached.data;
      }
      
      return [];
    }
  }

  /**
   * Pesquisa de paragens no cache local
   * NOTA: Só pesquisa paragens já carregadas. Para pesquisa completa, use API search
   * @param {string} query - Texto de pesquisa
   * @returns {Array} Paragens que correspondem à pesquisa
   */
  searchStops(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    // Pesquisar no cache global
    const results = [];
    for (const stop of this.allStopsCache.values()) {
      if (
        stop.stop_name.toLowerCase().includes(lowerQuery) ||
        stop.stop_code.toLowerCase().includes(lowerQuery) ||
        stop.stop_id.toLowerCase().includes(lowerQuery)
      ) {
        results.push(stop);
      }
    }
    
    return results;
  }

  /**
   * Obtém paragem por ID (do cache)
   * @param {string} id - ID da paragem
   * @returns {Object|null} Paragem ou null
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
