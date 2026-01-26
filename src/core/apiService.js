/**
 * Core API Service - Centraliza todas as chamadas API
 * Responsável por: fetch de dados FIWARE, trips, calendar, stops, com retry logic
 */

class ApiService {
  constructor() {
    this.fiwareUrl = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';
    this.proxyUrl = 'https://stcp-tracker.tiagoanoliveira.pt';
    this.retries = 3;
    this.delayMs = 500;
    this.timeoutMs = 1000;
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
      console.log('⏳ Buscando dados de autocarros da API FIWARE...');
      const data = await this.fetchWithRetry(this.fiwareUrl);
      
      if (!Array.isArray(data)) {
        console.error('❌ Dados inválidos recebidos da API FIWARE');
        return [];
      }
      
      console.log(`✓ ${data.length} autocarros carregados`);
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
      const url = `${this.proxyUrl}/${stopId}`;
      console.log(`🔄 Buscando dados da paragem ${stopId} via proxy...`);
      
      const data = await this.fetchWithRetry(url);
      console.log(`✓ Dados da paragem ${stopId} recebidos`);
      return data;
    } catch (error) {
      console.error(`❌ Erro ao obter dados da paragem ${stopId}:`, error);
      return null;
    }
  }

  /**
   * Fetch de ficheiro estático JSON
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
   * Fetch de trips.json
   */
  async fetchTripsData() {
    console.log('⏳ Carregando trips.json...');
    return await this.fetchJSON('./resources/trips.json');
  }

  /**
   * Fetch de calendar.json
   */
  async fetchCalendarData() {
    console.log('⏳ Carregando calendar.json...');
    return await this.fetchJSON('./resources/calendar.json');
  }

  /**
   * Fetch de stops.json
   */
  async fetchStopsData() {
    console.log('⏳ Carregando stops.json...');
    return await this.fetchJSON('./resources/stops.json');
  }
}

export const apiService = new ApiService();
