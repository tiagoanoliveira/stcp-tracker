import { mqttVehicleService } from '../services/mqttVehicleService.js';

class ApiService {
  constructor() {
    this.proxyUrl = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries = 3;
    this.delayMs = 500;
    this.timeoutMs = 10000;
    this.vehiclesSource = 'mqtt';
  }

  setVehiclesSource(source) {
    if (['primary', 'mqtt'].includes(source)) {
      this.vehiclesSource = source;
    }
  }

  getVehiclesSource() {
    return this.vehiclesSource;
  }

  buildUrl(path, params = null) {
    const url = new URL(`${this.proxyUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      });
    }
    return url.toString();
  }

  async fetchWithRetry(
      url,
      options = {},
      retries = this.retries,
      delayMs = this.delayMs,
      timeoutMs = this.timeoutMs
  ) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(options.headers || {}),
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  normalizeColor(value, fallback = '#187EC2') {
    if (!value) return fallback;
    const v = String(value).trim();
    return v.startsWith('#') ? v : `#${v}`;
  }

  normalizeRoute(route) {
    if (!route) return null;

    const rawId =
        String(route.route_id || route.id || route.number || route.route_short_name || '').trim();

    const rawNumber =
        String(route.number || route.route_short_name || route.route_id || route.id || '').trim();

    const operator = route.operator ?? route.source ?? this.inferRouteOperator({
      ...route,
      id: rawId,
      number: rawNumber,
    });

    return {
      ...route,
      id: rawId,
      routeId: rawId,
      number: rawNumber,
      name: String(route.name ?? route.route_long_name ?? rawNumber).trim(),
      color: this.normalizeColor(route.color ?? route.route_color, '#187EC2'),
      text_color: this.normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
      textcolor: this.normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
      operator,
      source: operator,
    };
  }

  inferRouteOperator(route) {
    const explicit = String(route.operator ?? route.source ?? '').toLowerCase();
    if (explicit) return explicit;

    const id = String(route.id ?? '');
    const number = String(route.number ?? '');

    if (id === 'MB1' || number === 'MB1' || number.startsWith('MB')) return 'metrobus';
    if (/^\d{4,}$/.test(number) || /^\d{4,}$/.test(id)) return 'unir';
    return 'stcp';
  }

  normalizeStop(stop) {
    if (!stop) return null;

    const stopId = String(stop.stop_id ?? stop.stopid ?? stop.id ?? stop.code ?? '');
    const stopCode = String(stop.stop_code ?? stop.stopcode ?? stop.code ?? stopId);
    const stopName = String(stop.stop_name ?? stop.stopname ?? stop.name ?? stopId);
    const latitude = Number(stop.latitude ?? stop.stop_lat ?? stop.lat);
    const longitude = Number(stop.longitude ?? stop.stop_lon ?? stop.lon ?? stop.lng);

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
      operator: stop.operator ?? stop.source ?? 'stcp',
      source: stop.source ?? stop.operator ?? 'stcp',
      routes: Array.isArray(stop.routes)
          ? stop.routes.map(route => this.normalizeRoute(route)).filter(Boolean)
          : [],
    };
  }

  normalizeVehiclesResponse(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.vehicles)) return data.vehicles;
    return [];
  }

  normalizeStopsResponse(data) {
    const stops = Array.isArray(data) ? data : Array.isArray(data?.stops) ? data.stops : [];
    return stops.map(stop => this.normalizeStop(stop)).filter(Boolean);
  }

  normalizeRoutesResponse(data) {
    const routes = Array.isArray(data) ? data : Array.isArray(data?.routes) ? data.routes : [];
    return routes.map(route => this.normalizeRoute(route)).filter(Boolean);
  }

  async fetchBusData() {
    if (this.vehiclesSource === 'mqtt') {
      return mqttVehicleService.getAllVehicles();
    }

    try {
      const data = await this.fetchWithRetry(this.buildUrl('/vehicles'), {}, this.retries, this.delayMs, 8000);
      return this.normalizeVehiclesResponse(data);
    } catch (error) {
      console.error('❌ Erro ao obter dados dos veículos:', error);
      return [];
    }
  }

  async fetchUnirVehicles() {
    try {
      const data = await this.fetchWithRetry(this.buildUrl('/vehicles/unir'), {}, this.retries, this.delayMs, 5000);
      return this.normalizeVehiclesResponse(data);
    } catch (error) {
      console.warn('⚠️ Erro ao obter veículos UNIR:', error);
      return [];
    }
  }

  async fetchStopRealtime(stopId) {
    try {
      return await this.fetchWithRetry(this.buildUrl(`/${encodeURIComponent(stopId)}/realtime`));
    } catch (error) {
      console.warn(`⚠️ fetchStopRealtime(${stopId}) falhou`, error);
      return null;
    }
  }

  async fetchStopRoutes(stopId) {
    try {
      const data = await this.fetchWithRetry(this.buildUrl(`/${encodeURIComponent(stopId)}/routes`));
      return { routes: this.normalizeRoutesResponse(data) };
    } catch (error) {
      console.error(`❌ Erro ao obter rotas da paragem ${stopId}:`, error);
      return { routes: [] };
    }
  }

  async fetchStopSchedule(stopId, routeId, serviceId) {
    try {
      return await this.fetchWithRetry(
          this.buildUrl(`/${encodeURIComponent(stopId)}/schedule`, {
            route_id: routeId,
            service_id: serviceId,
          })
      );
    } catch (error) {
      console.error(`❌ Erro ao obter schedule de ${routeId} (${serviceId}) para ${stopId}:`, error);
      return null;
    }
  }

  async fetchStopScheduleUnir(stopId) {
    try {
      return await this.fetchWithRetry(
          this.buildUrl(`/${encodeURIComponent(stopId)}/schedule`)
      );
    } catch (error) {
      console.warn(`⚠️ fetchStopScheduleUnir(${stopId}) falhou`, error);
      return null;
    }
  }

  async fetchStopInfo(stopId) {
    try {
      const data = await this.fetchWithRetry(this.buildUrl(`/${encodeURIComponent(stopId)}/info`));
      return this.normalizeStop(data);
    } catch (error) {
      console.error(`❌ Erro ao obter info da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchNearbyStops(lat, lng, radius) {
    try {
      const data = await this.fetchWithRetry(this.buildUrl(`/nearby/${lat}/${lng}/${radius}`));
      return { ...data, stops: this.normalizeStopsResponse(data) };
    } catch (error) {
      console.error(`❌ Erro ao obter paragens próximas (${lat}, ${lng}, ${radius}m):`, error);
      return { stops: [] };
    }
  }

  async fetchSearchStops(query, limit = 100) {
    try {
      const data = await this.fetchWithRetry(
          this.buildUrl('/search', { q: query.trim(), limit })
      );
      return { ...data, stops: this.normalizeStopsResponse(data) };
    } catch (error) {
      console.error(`❌ Erro ao pesquisar paragens "${query}":`, error);
      return { stops: [] };
    }
  }

  async fetchRouteSchedule(routeId, serviceId, directionId = 0) {
    try {
      return await this.fetchWithRetry(
          this.buildUrl(`/route/${encodeURIComponent(routeId)}/schedule`, {
            service_id: serviceId,
            direction_id: directionId,
          })
      );
    } catch (error) {
      console.error(`❌ Erro ao obter schedule da rota ${routeId} (${serviceId}, dir ${directionId}):`, error);
      return null;
    }
  }

  async fetchRouteShape(routeId, directionId = 0) {
    try {
      return await this.fetchWithRetry(
          this.buildUrl(`/route/${encodeURIComponent(routeId)}/shape`, {
            direction_id: directionId,
          })
      );
    } catch (error) {
      console.error(`❌ Erro ao obter shape da rota ${routeId} dir ${directionId}:`, error);
      return null;
    }
  }

  async fetchRouteStops(routeId, directionId = 0) {
    try {
      const data = await this.fetchWithRetry(
          this.buildUrl(`/route/${encodeURIComponent(routeId)}/stops`, {
            direction_id: directionId,
          })
      );

      if (!data?.stops) return data;

      return {
        ...data,
        stops: data.stops.map(stop => this.normalizeStop(stop)).filter(Boolean),
      };
    } catch (error) {
      console.error(`❌ Erro ao obter paragens da rota ${routeId} dir ${directionId}:`, error);
      return null;
    }
  }

  async fetchRoutesList() {
    try {
      const data = await this.fetchWithRetry(this.buildUrl('/routes/list'));
      return this.normalizeRoutesResponse(data);
    } catch (error) {
      console.error('❌ Erro ao obter lista de rotas:', error);
      return [];
    }
  }
}

const apiService = new ApiService();

export { apiService, ApiService };
export default apiService;