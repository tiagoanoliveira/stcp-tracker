/**
 * Core API Service - Centraliza todas as chamadas API
 */

class ApiService {
  constructor() {
    this.fiwareUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.proxyUrl = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries = 3;
    this.delayMs = 500;
    this.timeoutMs = 10000;
  }

  async fetchWithRetry(url, options = {}, retries = this.retries, delayMs = this.delayMs, timeoutMs = this.timeoutMs) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }

  async fetchBusData() {
    try {
      const data = await this.fetchWithRetry(this.fiwareUrl, {}, this.retries, this.delayMs, 5000);
      if (!Array.isArray(data)) { console.error('\u274c Dados inv\u00e1lidos recebidos da API FIWARE'); return []; }
      return data;
    } catch (error) {
      console.error('\u274c Erro ao obter dados dos autocarros:', error);
      return [];
    }
  }

  async fetchStopRealtime(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/realtime`);
    } catch (error) {
      console.error(`\u274c Erro ao obter dados da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchStopRoutes(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/routes`);
    } catch (error) {
      console.error(`\u274c Erro ao obter rotas da paragem ${stopId}:`, error);
      return { display_routes: [], dropdown_routes: [] };
    }
  }

  async fetchStopSchedule(stopId, routeId, serviceId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/schedule?route_id=${routeId}&service_id=${encodedServiceId}`);
    } catch (error) {
      console.error(`\u274c Erro ao obter schedule de ${routeId} (${serviceId}) para ${stopId}:`, error);
      return null;
    }
  }

  /**
   * ⭐ NOVO: Info completa de uma paragem (nome, coordenadas, linhas com cores)
   * Usa o endpoint GET /{stopId}/info do worker.
   * Cache de 30 min no worker; aqui sem cache extra (j\u00e1 vem cacheado).
   */
  async fetchStopInfo(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/info`);
    } catch (error) {
      console.error(`\u274c Erro ao obter info da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchNearbyStops(lat, lng, radius) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/nearby/${lat}/${lng}/${radius}`);
    } catch (error) {
      console.error(`\u274c Erro ao obter paragens pr\u00f3ximas (${lat}, ${lng}, ${radius}m):`, error);
      return { stops: [] };
    }
  }

  async fetchSearchStops(query, limit = 100) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`);
    } catch (error) {
      console.error(`\u274c Erro ao pesquisar paragens "${query}":`, error);
      return { stops: [] };
    }
  }

  async fetchRouteSchedule(routeId, serviceId, directionId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      return await this.fetchWithRetry(`${this.proxyUrl}/route/${routeId}/schedule?service_id=${encodedServiceId}&direction_id=${directionId}`);
    } catch (error) {
      console.error(`\u274c Erro ao obter schedule da rota ${routeId} (${serviceId}, dir ${directionId}):`, error);
      return null;
    }
  }

  async fetchJSON(filePath) {
    try {
      const response = await fetch(filePath);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`\u274c Erro ao carregar ${filePath}:`, error);
      return filePath.includes('calendar') ? {} : [];
    }
  }

  async fetchCalendarData() {
    return await this.fetchJSON('./resources/calendar.json');
  }
}

export const apiService = new ApiService();
