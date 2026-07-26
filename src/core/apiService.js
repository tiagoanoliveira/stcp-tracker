/**
 * Core API Service - centraliza todas as chamadas API
 * Compatível com o proxy unificado STCP / UNIR / MetroBus.
 */

import { mqttVehicleService } from '../services/mqttVehicleService.js';

class ApiService {
  constructor() {
    this.proxyUrl = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries = 3;
    this.delayMs = 500;
    this.timeoutMs = 10000;

    // 'mqtt' = produção normal
    // 'primary' = polling /vehicles
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
    if (params && typeof params === 'object') {
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

  normalizeVehiclesResponse(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.vehicles)) return data.vehicles;
    return [];
  }

  normalizeStopsResponse(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.stops)) return data.stops;
    return [];
  }

  normalizeRoutesResponse(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.routes)) return data.routes;
    return [];
  }

  /**
   * Veículos em tempo real — preferencialmente via MQTT.
   */
  async fetchBusData() {
    const source = this.getVehiclesSource();

    if (source === 'mqtt') {
      return mqttVehicleService.getAllVehicles();
    }

    try {
      const data = await this.fetchWithRetry(
          this.buildUrl('/vehicles'),
          {},
          this.retries,
          this.delayMs,
          8000
      );
      return this.normalizeVehiclesResponse(data);
    } catch (error) {
      console.error('❌ Erro ao obter dados dos veículos:', error);
      return [];
    }
  }

  async fetchUnirVehicles() {
    try {
      const data = await this.fetchWithRetry(
          this.buildUrl('/vehicles/unir'),
          {},
          this.retries,
          this.delayMs,
          5000
      );
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
      return {
        routes: this.normalizeRoutesResponse(data),
      };
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

  async fetchStopServices(stopId, date) {
    try {
      return await this.fetchWithRetry(
          this.buildUrl(`/${encodeURIComponent(stopId)}/services`, { date })
      );
    } catch (error) {
      console.error(`❌ Erro ao obter serviços da paragem ${stopId} para ${date}:`, error);
      return null;
    }
  }

  async fetchStopInfo(stopId) {
    try {
      return await this.fetchWithRetry(this.buildUrl(`/${encodeURIComponent(stopId)}/info`));
    } catch (error) {
      console.error(`❌ Erro ao obter info da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchNearbyStops(lat, lng, radius) {
    try {
      const data = await this.fetchWithRetry(
          this.buildUrl(`/nearby/${lat}/${lng}/${radius}`)
      );
      return {
        ...data,
        stops: this.normalizeStopsResponse(data),
      };
    } catch (error) {
      console.error(`❌ Erro ao obter paragens próximas (${lat}, ${lng}, ${radius}m):`, error);
      return { stops: [] };
    }
  }

  async fetchSearchStops(query, limit = 100) {
    try {
      const data = await this.fetchWithRetry(
          this.buildUrl('/search', {
            q: query.trim(),
            limit,
          })
      );
      return {
        ...data,
        stops: this.normalizeStopsResponse(data),
      };
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
      console.error(
          `❌ Erro ao obter schedule da rota ${routeId} (${serviceId}, dir ${directionId}):`,
          error
      );
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
      return await this.fetchWithRetry(
          this.buildUrl(`/route/${encodeURIComponent(routeId)}/stops`, {
            direction_id: directionId,
          })
      );
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

  async fetchJSON(filePath) {
    try {
      const response = await fetch(filePath);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`❌ Erro ao carregar ${filePath}:`, error);
      return filePath.includes('calendar') ? {} : [];
    }
  }

  async fetchCalendarData() {
    return await this.fetchJSON('./resources/calendar.json');
  }
}

export const apiService = new ApiService();