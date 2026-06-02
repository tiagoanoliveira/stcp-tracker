/**
 * Core API Service - Centraliza todas as chamadas API
 */

class ApiService {
  constructor() {
    this.fiwareUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.proxyUrl  = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries   = 3;
    this.delayMs   = 500;
    this.timeoutMs = 10000;

    // Fonte de veículos: 'primary' (stcp.live) ou 'fallback' (FIWARE via worker)
    this.vehiclesSource = 'primary';
  }

  setVehiclesSource(source) {
    if (source === 'primary' || source === 'fallback') {
      this.vehiclesSource = source;
    }
  }

  getVehiclesSource() {
    return this.vehiclesSource;
  }

  async fetchWithRetry(url, options = {}, retries = this.retries, delayMs = this.delayMs, timeoutMs = this.timeoutMs) {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
        const response   = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }

  /**
   * Veículos em tempo real (stcp.live como primário, FIWARE como fallback),
   * sempre via Cloudflare Worker.
   *
   * Resposta esperada do worker:
   *   { success: true, source: 'stcp-live'|'fiware', vehicles: [...] }
   */
  async fetchBusData() {
    try {
      const source = this.getVehiclesSource();
      const path   = source === 'fallback' ? '/vehicles/fiware' : '/vehicles';
      const data   = await this.fetchWithRetry(
        `${this.proxyUrl}${path}`,
        {},
        this.retries,
        this.delayMs,
        8000
      );

      const vehicles = Array.isArray(data)
        ? data
        : Array.isArray(data?.vehicles)
          ? data.vehicles
          : [];

      if (!Array.isArray(vehicles)) {
        console.error('❌ Dados inválidos recebidos do worker de veículos');
        return [];
      }

      return vehicles;
    } catch (error) {
      console.error('❌ Erro ao obter dados dos autocarros:', error);
      return [];
    }
  }

  async fetchStopRealtime(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/realtime`);
    } catch (error) {
      console.error(`❌ Erro ao obter dados da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchStopRoutes(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/routes`);
    } catch (error) {
      console.error(`❌ Erro ao obter rotas da paragem ${stopId}:`, error);
      return { display_routes: [], dropdown_routes: [] };
    }
  }

  async fetchStopSchedule(stopId, routeId, serviceId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/schedule?route_id=${routeId}&service_id=${encodedServiceId}`);
    } catch (error) {
      console.error(`❌ Erro ao obter schedule de ${routeId} (${serviceId}) para ${stopId}:`, error);
      return null;
    }
  }

  /**
   * Obtém os serviços ativos para uma paragem numa data específica.
   * Passa pelo proxy Cloudflare Worker para evitar erros de CORS.
   * Rota do proxy: GET /{stopId}/services?date={date}
   * @param {string} stopId - Código da paragem (ex: "PLNT2")
   * @param {string} date - Data no formato YYYY-MM-DD (ex: "2026-04-02")
   * @returns {Promise<Object>} Objeto com active_service_id e lista de serviços
   */
  async fetchStopServices(stopId, date) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/services?date=${date}`);
    } catch (error) {
      console.error(`❌ Erro ao obter serviços da paragem ${stopId} para ${date}:`, error);
      return null;
    }
  }

  /**
   * Info completa de uma paragem (nome, coordenadas, linhas com cores)
   * Usa o endpoint GET /{stopId}/info do worker.
   */
  async fetchStopInfo(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/info`);
    } catch (error) {
      console.error(`❌ Erro ao obter info da paragem ${stopId}:`, error);
      return null;
    }
  }

  async fetchNearbyStops(lat, lng, radius) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/nearby/${lat}/${lng}/${radius}`);
    } catch (error) {
      console.error(`❌ Erro ao obter paragens próximas (${lat}, ${lng}, ${radius}m):`, error);
      return { stops: [] };
    }
  }

  async fetchSearchStops(query, limit = 100) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`);
    } catch (error) {
      console.error(`❌ Erro ao pesquisar paragens "${query}":`, error);
      return { stops: [] };
    }
  }

  async fetchRouteSchedule(routeId, serviceId, directionId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      return await this.fetchWithRetry(`${this.proxyUrl}/route/${routeId}/schedule?service_id=${encodedServiceId}&direction_id=${directionId}`);
    } catch (error) {
      console.error(`❌ Erro ao obter schedule da rota ${routeId} (${serviceId}, dir ${directionId}):`, error);
      return null;
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
