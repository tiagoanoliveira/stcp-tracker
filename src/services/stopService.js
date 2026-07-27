/**
 * Stop Service - Gestão de paragens usando API STCP
 * Usa: apiService, customRoutes
 * Responsável por: obter paragens próximas via API, pesquisa via API, cache inteligente.
 * Paragens de rotas custom (ex: MB1) são injetadas automaticamente no cache.
 */

import { apiService }     from '../core/apiService.js';
import { CUSTOM_STOPS_MAP } from '../data/customRoutes.js';

class StopService {
  constructor() {
    // Cache de paragens por localização e raio
    this.nearbyCache = new Map(); // "lat_lng_radius" -> { data, timestamp }
    this.cacheTTL = 5 * 60 * 1000; // 5 minutos

    // Cache global de paragens já vistas (para pesquisa local rápida)
    // Pré-popular com as paragens custom para que estejam sempre disponíveis
    this.allStopsCache = new Map(CUSTOM_STOPS_MAP);
  }

  /**
   * PRINCIPAL: Obtém paragens próximas via API.
   * Paragens custom próximas do raio pedido são injectadas no resultado.
   */
  async getNearbyStops(lat, lng, radius = 1000) {
    const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${radius}`;
    const cached = this.nearbyCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }

    try {
      const response = await apiService.fetchNearbyStops(lat, lng, radius);
      const stops = response.stops || [];

      const normalized = stops.map(s => {
        const stop = {
          stop_id:   s.stop_id || s.stop_code || s.id,
          stop_code: s.stop_code || s.stop_id || s.id,
          stop_name: s.stop_name || s.name,
          latitude:  s.latitude,
          longitude: s.longitude,
          distance:  s.distance,
          zone_id:   s.zone_id,
          routes:    s.routes || [],
          operator:  s.operator,
          source:    s.source,
        };
        this.allStopsCache.set(stop.stop_id, stop);
        return stop;
      });

      // Injectar paragens custom dentro do raio
      const customNearby = this._getCustomStopsNearby(lat, lng, radius);
      for (const cs of customNearby) {
        if (!normalized.some(s => s.stop_id === cs.stop_id)) {
          normalized.push(cs);
        }
      }

      this.nearbyCache.set(cacheKey, { data: normalized, timestamp: now });
      return normalized;

    } catch (error) {
      console.error('❌ Erro ao obter paragens próximas:', error);
      if (cached) {
        console.warn('⚠️ A usar cache expirado como fallback');
        return cached.data;
      }
      // Fallback: pelo menos devolver as custom próximas
      return this._getCustomStopsNearby(lat, lng, radius);
    }
  }

  /**
   * Pesquisa de paragens por nome ou código.
   * - Tenta primeiro o cache local (inclui paragens custom)
   * - Se não encontrar, faz pesquisa via API STCP
   */
  async searchStops(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    // 1. Pesquisa no cache local (inclui custom)
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
      return localResults;
    }

    // 2. Cache local sem resultados → pesquisar via API STCP
    try {
      const response = await apiService.fetchSearchStops(query);
      const stops = response.stops || [];

      if (stops.length === 0) {
        console.warn(`⚠️ API não encontrou paragens para "${query}"`);
        return [];
      }

      const normalized = stops.map(s => {
        const stop = {
          stop_id:   s.stop_id || s.code || s.id,
          stop_code: s.stop_code || s.code || s.id,
          stop_name: s.stop_name || s.name,
          latitude:  s.latitude,
          longitude: s.longitude,
          distance:  null,
          zone_id:   s.zone_id || null,
          routes:    s.routes || []
        };
        this.allStopsCache.set(stop.stop_id, stop);
        return stop;
      });
      return normalized;

    } catch (error) {
      console.error(`❌ Erro na pesquisa de paragens "${query}":`, error);
      return [];
    }
  }

  /**
   * Obtém paragem por ID (do cache; inclui custom).
   */
  getStopById(id) {
    return this.allStopsCache.get(id) || null;
  }

  /**
   * Retorna paragens custom dentro do raio (metros) de um ponto.
   * @private
   */
  _getCustomStopsNearby(lat, lng, radius) {
    const nearby = [];
    for (const stop of CUSTOM_STOPS_MAP.values()) {
      const dist = this._haversine(lat, lng, stop.latitude, stop.longitude);
      if (dist <= radius) {
        nearby.push({ ...stop, distance: Math.round(dist) });
      }
    }
    return nearby;
  }

  /**
   * Distância haversine em metros entre dois pontos.
   * @private
   */
  _haversine(lat1, lng1, lat2, lng2) {
    const R    = 6371000; // metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Limpa cache (forçar refresh).
   */
  clearCache() {
    this.nearbyCache.clear();
    // Manter custom stops no allStopsCache
    const customEntries = [...this.allStopsCache.entries()].filter(
      ([, v]) => v._custom
    );
    this.allStopsCache = new Map(customEntries);
  }

  /**
   * Limpa cache expirado automaticamente.
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
  }
}

(async () => {
  try {
    const resp = await fetch('./resources/stops.json');
    if (!resp.ok) return;
    const stops = await resp.json();
    for (const s of stops) {
      if (!stopService.allStopsCache.has(s.stop_code)) {
        stopService.allStopsCache.set(s.stop_code, {
          stop_id:   s.stop_code,
          stop_code: s.stop_code,
          stop_name: s.stop_name,
          latitude:  s.stop_lat,
          longitude: s.stop_lon,
        });
      }
    }
  } catch { /* silencioso */ }
})();

export const stopService = new StopService();

// Limpeza automática de cache a cada 10 minutos
setInterval(() => {
  stopService.cleanupExpiredCache();
}, 10 * 60 * 1000);
