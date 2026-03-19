/**
 * routeService - Acesso aos dados de linhas (shape, paragens, listagem)
 * Todos os resultados são cacheados em memória para evitar pedidos repetidos.
 */

import { apiService } from '../core/apiService.js';

class RouteService {
  constructor() {
    // Cache em memória: chave -> { data, ts }
    this._cache = new Map();
    this._TTL = 60 * 60 * 1000; // 1 hora (igual ao worker)
  }

  _cacheKey(type, routeId, directionId) {
    return `${type}:${routeId}:${directionId}`;
  }

  _fromCache(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._TTL) { this._cache.delete(key); return null; }
    return entry.data;
  }

  _toCache(key, data) {
    this._cache.set(key, { data, ts: Date.now() });
  }

  /**
   * Obter shape (polyline) de uma linha numa direcção.
   * @param {string} routeId  - ex: '200', '1M'
   * @param {0|1}    direction - 0 = ida, 1 = volta
   * @returns {Promise<{route_id, direction_id, coordinates: [{lat,lng,sequence}]}>}
   */
  async fetchRouteShape(routeId, direction = 0) {
    const key = this._cacheKey('shape', routeId, direction);
    const cached = this._fromCache(key);
    if (cached) return cached;

    try {
      const data = await apiService.fetchWithRetry(
        `${apiService.proxyUrl}/route/${routeId}/shape?direction_id=${direction}`
      );
      this._toCache(key, data);
      return data;
    } catch (e) {
      console.error(`❌ Erro ao obter shape da linha ${routeId} dir ${direction}:`, e);
      return null;
    }
  }

  /**
   * Obter paragens de uma linha numa direcção.
   * @returns {Promise<{route_id, direction_id, stops: [{stop_id,stop_name,latitude,longitude,stop_sequence}]}>}
   */
  async fetchRouteStops(routeId, direction = 0) {
    const key = this._cacheKey('stops', routeId, direction);
    const cached = this._fromCache(key);
    if (cached) return cached;

    try {
      const data = await apiService.fetchWithRetry(
        `${apiService.proxyUrl}/route/${routeId}/stops?direction_id=${direction}`
      );
      this._toCache(key, data);
      return data;
    } catch (e) {
      console.error(`❌ Erro ao obter paragens da linha ${routeId} dir ${direction}:`, e);
      return null;
    }
  }

  /**
   * Obter shape E paragens de uma linha em paralelo.
   * @returns {Promise<{shape, stops}>}
   */
  async fetchRouteOverlayData(routeId, direction = 0) {
    const [shapeResult, stopsResult] = await Promise.allSettled([
      this.fetchRouteShape(routeId, direction),
      this.fetchRouteStops(routeId, direction)
    ]);
    return {
      shape: shapeResult.status === 'fulfilled' ? shapeResult.value : null,
      stops: stopsResult.status === 'fulfilled' ? stopsResult.value : null
    };
  }

  /**
   * Obter shape E paragens para múltiplas linhas em paralelo (para filtros com várias linhas).
   * @param {Array<{routeId, direction, color, text_color}>} routes
   * @returns {Promise<Array<{routeId, direction, color, text_color, shape, stops}>>}
   */
  async fetchMultipleRoutesOverlay(routes) {
    const results = await Promise.allSettled(
      routes.map(r => this.fetchRouteOverlayData(r.routeId, r.direction ?? 0)
        .then(data => ({ ...r, ...data }))
      )
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Listar todas as linhas disponíveis.
   * @returns {Promise<Array<{id, number, name, color, text_color}>>}
   */
  async fetchRoutesList() {
    const key = 'routes_list';
    const cached = this._fromCache(key);
    if (cached) return cached;

    try {
      const data = await apiService.fetchWithRetry(
        `${apiService.proxyUrl}/routes/list`
      );
      const routes = data?.routes || [];
      this._toCache(key, routes);
      return routes;
    } catch (e) {
      console.error('❌ Erro ao obter lista de linhas:', e);
      return [];
    }
  }

  /**
   * Limpar cache (útil em testes ou após reload forçado).
   */
  clearCache() {
    this._cache.clear();
  }
}

export const routeService = new RouteService();
