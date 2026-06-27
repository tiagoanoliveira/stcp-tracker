/**
 * Core API Service - Centraliza todas as chamadas API
 *
 * FONTES DE VEÍCULOS:
 *   'mqtt'     - Porto Digital MQTT/WebSocket (event-driven, sem polling) — ÚNICA fonte activa
 *   'primary'  - stcp.live via Cloudflare Worker (polling HTTP) — desactivado
 *   'fallback' - FIWARE Broker via Cloudflare Worker (polling HTTP) — desactivado
 *
 * O FIWARE foi removido como fonte de dados. A WebSocket liga sempre antes
 * do site acabar de carregar, por isso não é necessário bootstrap via REST.
 * Se o MQTT demorar, o mqttVehicleService emite 'mqtt:noDataTimeout' e o
 * UI mostra um banner de aviso.
 */

import { mqttVehicleService } from '../services/mqttVehicleService.js';

class ApiService {
  constructor() {
    this.proxyUrl  = 'https://stcp-worker.tiagoanoliveira.pt';
    this.retries   = 3;
    this.delayMs   = 500;
    this.timeoutMs = 10000;

    // Fonte de veículos: apenas 'mqtt' em produção
    this.vehiclesSource = 'mqtt';
  }

  setVehiclesSource(source) {
    if (['primary', 'fallback', 'mqtt'].includes(source)) {
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
   * Veículos em tempo real — exclusivamente via MQTT.
   * Devolve o snapshot em memória actualizado pelo mqttVehicleService.
   * Enquanto o MQTT ainda não tiver dados, devolve [] e o UI aguarda
   * pelo evento 'mqtt:vehicleUpdate' para renderizar.
   */
  async fetchBusData() {
    const source = this.getVehiclesSource();

    if (source === 'mqtt') {
      // Devolve snapshot em memória — pode ser [] nos primeiros segundos.
      // O mqttVehicleService emite 'mqtt:noDataTimeout' se passarem 15s sem dados.
      return mqttVehicleService.getAllVehicles();
    }

    // Modo polling (mantido apenas para debug manual)
    try {
      const path = source === 'fallback' ? '/vehicles/fiware' : '/vehicles';
      const data = await this.fetchWithRetry(
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
      return vehicles;
    } catch (error) {
      console.error('❌ Erro ao obter dados dos autocarros:', error);
      return [];
    }
  }

  // ─── Paragens e rotas ──────────────────────────────────────────────────────

  async fetchStopRealtime(stopId) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/realtime`);
    } catch (error) {
      console.warn(`⚠️ fetchStopRealtime(${stopId}) falhou — usando apenas MQTT TripUpdate`, error);
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

  async fetchStopServices(stopId, date) {
    try {
      return await this.fetchWithRetry(`${this.proxyUrl}/${stopId}/services?date=${date}`);
    } catch (error) {
      console.error(`❌ Erro ao obter serviços da paragem ${stopId} para ${date}:`, error);
      return null;
    }
  }

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
