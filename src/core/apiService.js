/**
 * Core API Service - Centraliza todas as chamadas API
 * Responsável por: fetch de dados FIWARE, trips, calendar, stops, routes, schedules, com retry logic
 */

class ApiService {
  constructor() {
    this.fiwareUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.proxyUrl = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries = 3;
    this.delayMs = 500;
    this.timeoutMs = 10000; // 10s para APIs STCP (podem ser lentas)
  }

  /**
   * Fetch genérico com retry e timeout
   */
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

  /**
   * Fetch de autocarros em tempo real da API FIWARE
   */
  async fetchBusData() {
    try {
      const data = await this.fetchWithRetry(this.fiwareUrl, {}, this.retries, this.delayMs, 5000);
      
      if (!Array.isArray(data)) {
        console.error('❌ Dados inválidos recebidos da API FIWARE');
        return [];
      }
      
      return data;
    } catch (error) {
      console.error('❌ Erro ao obter dados dos autocarros:', error);
      return [];
    }
  }

  /**
   * Fetch de dados em tempo real de uma paragem via proxy
   */
  async fetchStopRealtime(stopId) {
    try {
      const url = `${this.proxyUrl}/${stopId}/realtime`;
      return await this.fetchWithRetry(url);
    } catch (error) {
      console.error(`❌ Erro ao obter dados da paragem ${stopId}:`, error);
      return null;
    }
  }

  /**
   * Fetch de rotas que servem uma paragem via proxy
   * @param {string} stopId - Código da paragem
   * @returns {Promise<Object>} Objeto com display_routes e dropdown_routes
   */
  async fetchStopRoutes(stopId) {
    try {
      const url = `${this.proxyUrl}/${stopId}/routes`;
      return await this.fetchWithRetry(url);
    } catch (error) {
      console.error(`❌ Erro ao obter rotas da paragem ${stopId}:`, error);
      return { display_routes: [], dropdown_routes: [] };
    }
  }

  /**
   * Fetch de horário programado de uma rota numa paragem via proxy
   * @param {string} stopId - Código da paragem
   * @param {string} routeId - ID da rota (ex: "200")
   * @param {string} serviceId - ID do serviço (ex: "DIAS UTEIS", "SAB", "DOM")
   * @returns {Promise<Object>} Objeto com schedule por hora
   */
  async fetchStopSchedule(stopId, routeId, serviceId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      const url = `${this.proxyUrl}/${stopId}/schedule?route_id=${routeId}&service_id=${encodedServiceId}`;
      return await this.fetchWithRetry(url);
    } catch (error) {
      console.error(`❌ Erro ao obter schedule de ${routeId} (${serviceId}) para ${stopId}:`, error);
      return null;
    }
  }

  /**
   * ⭐ NOVO: Fetch de paragens próximas via proxy
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} radius - Raio em metros
   * @returns {Promise<Object>} Objeto com array de paragens ordenadas por distância
   */
  async fetchNearbyStops(lat, lng, radius) {
    try {
      const url = `${this.proxyUrl}/nearby/${lat}/${lng}/${radius}`;
      return await this.fetchWithRetry(url);
    } catch (error) {
      console.error(`❌ Erro ao obter paragens próximas (${lat}, ${lng}, ${radius}m):`, error);
      return { stops: [] };
    }
  }

  /**
   * ⭐ NOVO: Fetch de schedule completo de uma rota via proxy
   * @param {string} routeId - ID da rota (ex: "200")
   * @param {string} serviceId - ID do serviço (ex: "DIAS UTEIS")
   * @param {string|number} directionId - Direção (0 ou 1)
   * @returns {Promise<Object>} Objeto com schedule completo da rota
   */
  async fetchRouteSchedule(routeId, serviceId, directionId) {
    try {
      const encodedServiceId = encodeURIComponent(serviceId);
      const url = `${this.proxyUrl}/route/${routeId}/schedule?service_id=${encodedServiceId}&direction_id=${directionId}`;
      return await this.fetchWithRetry(url);
    } catch (error) {
      console.error(`❌ Erro ao obter schedule da rota ${routeId} (${serviceId}, dir ${directionId}):`, error);
      return null;
    }
  }

  /**
   * Fetch de ficheiro estático JSON
   * DEPRECADO: Será removido após migração completa para APIs
   */
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

  /**
   * Fetch de calendar.json (ainda necessário para determinar tipo de dia)
   */
  async fetchCalendarData() {
    return await this.fetchJSON('./resources/calendar.json');
  }
}

export const apiService = new ApiService();
