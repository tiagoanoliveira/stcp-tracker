/**
 * routeService - gestão e normalização de rotas/overlays
 */

import { apiService } from '../core/apiService.js';

class RouteService {
  constructor() {
    this.cache = new Map();
    this.cacheTtlMs = 60 * 60 * 1000;
  }

  _cacheKey(type, routeId, directionId = 0, extra = '') {
    return `${type}:${String(routeId)}:${Number(directionId)}:${extra}`;
  }

  _getCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.ts > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  _setCache(key, data) {
    this.cache.set(key, { ts: Date.now(), data });
    return data;
  }

  _normalizeColor(value, fallback = '#187EC2') {
    if (!value) return fallback;
    const str = String(value).trim();
    return str.startsWith('#') ? str : `#${str}`;
  }

  _inferOperator(route = {}) {
    const explicit = String(route.operator ?? route.source ?? '').toLowerCase();
    if (explicit) return explicit;

    const id = String(route.routeId || route.id || route.route_id || route.number || route.route_short_name || '').trim();
    const number = String(route.number || route.route_short_name || route.routeId || route.id || route.route_id || '').trim();

    if (id === 'MB1' || number === 'MB1' || number.startsWith('MB')) return 'metrobus';
    if (/^\d{4,}$/.test(number) || /^\d{4,}$/.test(id)) return 'unir';
    return 'stcp';
  }

  _normalizeRoute(route) {
    if (!route) return null;

    const id = String(route.routeId || route.id || route.route_id || route.number || route.route_short_name || '').trim();
    const number = String(route.number || route.route_short_name || route.routeId || route.id || route.route_id || '').trim();
    const operator = this._inferOperator(route);

    return {
      ...route,
      id,
      routeId: id,
      number,
      name: String(route.name ?? route.route_long_name ?? number),
      color: this._normalizeColor(route.color ?? route.route_color, '#187EC2'),
      text_color: this._normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
      textcolor: this._normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
      operator,
      source: operator,
    };
  }

  _normalizeStop(stop, idx = 0) {
    if (!stop) return null;

    const stopId = String(stop.stop_id ?? stop.stopid ?? stop.id ?? stop.code ?? '');
    const stopCode = String(stop.stop_code ?? stop.stopcode ?? stop.code ?? stopId);
    const stopName = String(stop.stop_name ?? stop.stopname ?? stop.name ?? stopId);
    const latitude = Number(stop.latitude ?? stop.stop_lat ?? stop.lat);
    const longitude = Number(stop.longitude ?? stop.stop_lon ?? stop.lon ?? stop.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      ...stop,
      stop_id: stopId,
      stopid: stopId,
      stop_code: stopCode,
      stopcode: stopCode,
      stop_name: stopName,
      stopname: stopName,
      latitude,
      longitude,
      stop_sequence: Number(stop.stop_sequence ?? idx + 1),
    };
  }

  _normalizeStopsPayload(payload) {
    const rawStops = Array.isArray(payload?.stops)
        ? payload.stops
        : Array.isArray(payload)
            ? payload
            : [];

    return {
      ...payload,
      stops: rawStops.map((stop, idx) => this._normalizeStop(stop, idx)).filter(Boolean),
    };
  }

  _normalizeShapePayload(payload) {
    if (!payload) return { coordinates: [] };

    if (Array.isArray(payload)) {
      return {
        coordinates: payload
            .map((p, idx) => ({
              lat: Number(p.shape_pt_lat ?? p.lat ?? p.latitude),
              lng: Number(p.shape_pt_lon ?? p.lon ?? p.lng ?? p.longitude),
              sequence: Number(p.shape_pt_sequence ?? p.sequence ?? idx + 1),
            }))
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      };
    }

    if (Array.isArray(payload.coordinates)) {
      return {
        ...payload,
        coordinates: payload.coordinates
            .map((p, idx) => {
              if (Array.isArray(p)) {
                return {
                  lat: Number(p[0]),
                  lng: Number(p[1]),
                  sequence: idx + 1,
                };
              }
              return {
                lat: Number(p.lat ?? p.latitude),
                lng: Number(p.lng ?? p.lon ?? p.longitude),
                sequence: Number(p.sequence ?? idx + 1),
              };
            })
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      };
    }

    if (payload?.geometry?.type === 'LineString' && Array.isArray(payload.geometry.coordinates)) {
      return {
        ...payload,
        coordinates: payload.geometry.coordinates
            .map(([lng, lat], idx) => ({
              lat: Number(lat),
              lng: Number(lng),
              sequence: idx + 1,
            }))
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      };
    }

    if (payload?.geometry?.type === 'MultiLineString' && Array.isArray(payload.geometry.coordinates)) {
      const coords = payload.geometry.coordinates.flatMap(line =>
          line.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
      );

      return {
        ...payload,
        coordinates: coords
            .map((p, idx) => ({ ...p, sequence: idx + 1 }))
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      };
    }

    if (payload?.type === 'Feature' && payload?.geometry) {
      return this._normalizeShapePayload(payload.geometry);
    }

    if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
      const feature = payload.features.find(f =>
          ['LineString', 'MultiLineString'].includes(f?.geometry?.type)
      );
      return feature ? this._normalizeShapePayload(feature.geometry) : { coordinates: [] };
    }

    return {
      ...payload,
      coordinates: [],
    };
  }

  async fetchRoutesList(forceRefresh = false) {
    const key = 'routes:list';

    if (!forceRefresh) {
      const cached = this._getCache(key);
      if (cached) return cached;
    }

    try {
      // STCP/metrobus via proxy atual
      const stcpRoutes = await apiService.fetchRoutesList();
      const stcpNormalized = (Array.isArray(stcpRoutes) ? stcpRoutes : [])
          .map(route => this._normalizeRoute(route))
          .filter(Boolean);

      // UNIR via GTFS API
      const unirRoutes = await apiService.fetchGtfsUnirRoutesList();
      const unirNormalized = (Array.isArray(unirRoutes) ? unirRoutes : [])
          .map(route => this._normalizeRoute(route))
          .filter(Boolean);

      // Combinar (se quiseres, podes deduplicar por number+operator)
      const normalized = [...stcpNormalized, ...unirNormalized];

      return this._setCache(key, normalized);
    } catch (error) {
      console.error('❌ routeService.fetchRoutesList falhou:', error);
      return [];
    }
  }

  async fetchRouteShape(routeId, directionId = 0, forceRefresh = false, operatorHint = null) {
    const key = this._cacheKey('shape', routeId, directionId);

    if (!forceRefresh) {
      const cached = this._getCache(key);
      if (cached) return cached;
    }

    try {
      let payload;
      if (String(operatorHint).toLowerCase() === 'unir') {
        // UNIR via GTFS API
        payload = await apiService.fetchGtfsRouteShape(routeId, directionId);
        // payload.shapes: flatten para lista simples de pontos
        if (payload?.shapes?.length) {
          const points = payload.shapes.flatMap(shape => shape.points || []);
          payload = points;
        }
      } else {
        // STCP/metrobus via proxy atual
        payload = await apiService.fetchRouteShape(routeId, directionId);
      }

      const normalized = this._normalizeShapePayload(payload);
      return this._setCache(key, normalized);
    } catch (error) {
      console.error(`❌ routeService.fetchRouteShape(${routeId}, ${directionId}) falhou:`, error);
      return { coordinates: [] };
    }
  }

  async fetchRouteStops(routeId, directionId = 0, forceRefresh = false, operatorHint = null) {
    const key = this._cacheKey('stops', routeId, directionId);

    if (!forceRefresh) {
      const cached = this._getCache(key);
      if (cached) return cached;
    }

    try {
      let payload;
      if (String(operatorHint).toLowerCase() === 'unir') {
        payload = await apiService.fetchGtfsRouteStops(routeId, directionId);
      } else {
        payload = await apiService.fetchRouteStops(routeId, directionId);
      }
      const normalized = this._normalizeStopsPayload(payload);
      return this._setCache(key, normalized);
    } catch (error) {
      console.error(`❌ routeService.fetchRouteStops(${routeId}, ${directionId}) falhou:`, error);
      return { stops: [] };
    }
  }

  async fetchRouteOverlay(routeObj, forceRefresh = false) {
    const route = this._normalizeRoute(routeObj);
    if (!route) return null;

    const direction = Number(route.direction ?? 0);

    const [shape, stops] = await Promise.all([
      this.fetchRouteShape(route.routeId, direction, forceRefresh, route.operator),
      this.fetchRouteStops(route.routeId, direction, forceRefresh, route.operator),
    ]);

    return {
      routeId: route.routeId,
      id: route.id,
      number: route.number,
      name: route.name,
      color: route.color,
      text_color: route.text_color,
      textcolor: route.textcolor,
      operator: route.operator,
      source: route.source,
      direction,
      shape,
      stops,
    };
  }

  async fetchMultipleRoutesOverlay(routeObjs = [], forceRefresh = false) {
    const results = await Promise.all(
        (routeObjs || []).map(routeObj => this.fetchRouteOverlay(routeObj, forceRefresh))
    );

    return results.filter(Boolean);
  }

  clearCache() {
    this.cache.clear();
  }
}

const routeService = new RouteService();

export { routeService, RouteService };
export default routeService;