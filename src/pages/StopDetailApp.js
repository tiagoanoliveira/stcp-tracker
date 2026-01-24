/**
 * StopDetailApp - Aplicação de detalhes de paragem com chegadas em tempo real
 * Usa: MapManager, BusMarkerManager, apiService, stopService, eventBus, autoRefreshManager
 */

import { apiService } from '../core/apiService.js';
import { eventBus } from '../core/eventBus.js';
import { autoRefreshManager } from '../core/autoRefreshManager.js';
import { stopService } from '../services/stopService.js';
import { MapManager } from '../map/MapManager.js';
import { BusMarkerManager } from '../map/markers/BusMarkerManager.js';
import { ArrivalsList } from '../ui/components/ArrivalsList.js';
import { LastUpdateDisplay } from '../ui/components/LastUpdateDisplay.js';

export class StopDetailApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.refreshInterval = options.refreshInterval || 30000; // 30s
    this.stopId = null;
    this.mapManager = null;
    this.busMarkerManager = null;
    this.arrivalsList = new ArrivalsList();
    this.lastUpdateDisplay = new LastUpdateDisplay();
    this.lastBusPositions = [];
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando StopDetailApp...');

      // 1. Obter stop_id da URL
      this.stopId = this.getStopIdFromUrl();
      if (!this.stopId) {
        this.showError('Código de paragem não especificado.');
        return;
      }

      console.log(`🎯 Paragem: ${this.stopId}`);

      // 2. Carregar dados de paragens
      await stopService.loadStopsData();
      console.log('✓ Dados de paragens carregados');

      // 3. Inicializar mapa
      this.mapManager = new MapManager(this.mapElementId, { zoom: 15 });
      this.mapManager.initialize(() => {
        if (this.lastBusPositions.length > 0) {
          const bounds = L.latLngBounds(this.lastBusPositions);
          return bounds.getCenter();
        }
        return null;
      });
      await this.mapManager.waitForReady();
      console.log('✓ Mapa inicializado');

      // 4. Inicializar bus marker manager
      this.busMarkerManager = new BusMarkerManager(this.mapManager.map);

      // 5. Inicializar componentes UI
      this.arrivalsList.initialize();
      this.lastUpdateDisplay.initialize();

      // 6. Setup event listeners
      this.setupEventListeners();

      // 7. Primeira busca de dados
      await this.loadStopData();

      // 8. Iniciar auto-refresh
      this.startAutoRefresh();

      console.log('✅ StopDetailApp inicializado com sucesso');
    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      this.showError('Erro ao inicializar aplicação');
    }
  }

  getStopIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  setupEventListeners() {
    // Escutar cliques nas chegadas
    eventBus.on('arrivalClicked', (data) => this.handleArrivalClick(data));
  }

  startAutoRefresh() {
    autoRefreshManager.start(
      'stop-detail',
      () => this.loadStopData(),
      this.refreshInterval
    );
    console.log(`🔄 Auto-refresh iniciado (${this.refreshInterval}ms)`);
  }

  async loadStopData() {
    try {
      console.log('🔄 Atualizando dados da paragem...');

      // 1. Buscar dados de chegadas
      const stopData = await apiService.fetchStopRealtime(this.stopId);

      if (!stopData) {
        this.showError('Não foi possível carregar dados da paragem.');
        return;
      }

      // 2. Atualizar título da página
      this.updateStopTitle(stopData.stop_name);

      // 3. Se não houver chegadas
      if (!stopData.arrivals || stopData.arrivals.length === 0) {
        console.log('⚠ Nenhuma chegada prevista');
        this.arrivalsList.render([], []);
        this.busMarkerManager.clearAllMarkers();
        this.lastUpdateDisplay.update();
        return;
      }

      // 4. Buscar dados de veículos
      const vehicles = await apiService.fetchBusData();
      console.log(`✓ ${vehicles.length} veículos obtidos`);

      // 5. Atualizar mapa e lista de chegadas
      this.updateBusMap(stopData.arrivals, vehicles);
      this.arrivalsList.render(stopData.arrivals, vehicles);
      this.lastUpdateDisplay.update();

      console.log(`✓ ${stopData.arrivals.length} chegadas atualizadas`);
    } catch (error) {
      console.error('❌ Erro ao carregar dados:', error);
      this.showError('Erro ao atualizar informações.');
    }
  }

  updateStopTitle(stopName) {
    const titleElement = document.getElementById('stop-title');
    if (titleElement && stopName) {
      titleElement.textContent = `Paragem: ${stopName}`;
    }
  }

  updateBusMap(arrivals, vehicles) {
    console.log(`🗺️ Atualizando mapa com ${arrivals.length} chegadas`);

    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      this.lastBusPositions = [];
      return;
    }

    const busPositions = [];
    const processedBuses = [];

    arrivals.forEach(arrival => {
      const vehicle = this.matchVehicleToTrip(vehicles, arrival.trip_id);

      if (vehicle) {
        const location = this.extractVehicleLocation(vehicle);

        if (location) {
          busPositions.push([location.latitude, location.longitude]);

          processedBuses.push({
            id: vehicle.id,
            line: arrival.route_short_name,
            latitude: location.latitude,
            longitude: location.longitude,
            speed: location.speed,
            busNumber: vehicle.fleetVehicleId ? vehicle.fleetVehicleId.value : 'N/A',
            destination: arrival.trip_headsign,
            arrivalTime: arrival.arrival_minutes
          });
        }
      }
    });

    this.lastBusPositions = busPositions;
    this.busMarkerManager.updateBusMarkers(processedBuses);

    // Ajustar mapa para mostrar todos os autocarros
    if (busPositions.length > 0) {
      this.mapManager.fitBounds(busPositions, { padding: [50, 50], maxZoom: 16 });
    }

    console.log(`✓ ${processedBuses.length} autocarros no mapa`);
  }

  matchVehicleToTrip(vehicles, tripId) {
    if (!vehicles || !tripId) return null;

    return vehicles.find(v => {
      if (!v.annotations || !v.annotations.value) return false;

      for (const annotation of v.annotations.value) {
        const decoded = decodeURIComponent(annotation);
        if (decoded.startsWith('stcp:trip:') && decoded.slice(10) === tripId) {
          return true;
        }
      }
      return false;
    });
  }

  extractVehicleLocation(vehicle) {
    if (!vehicle || !vehicle.location || !vehicle.location.value) return null;

    const coords = vehicle.location.value.coordinates;
    if (!coords || coords.length < 2) return null;

    return {
      latitude: coords[1],
      longitude: coords[0],
      speed: vehicle.speed ? vehicle.speed.value : 'N/A'
    };
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;

    if (!location || !this.mapManager.map) return;

    const coords = [location.latitude, location.longitude];
    this.mapManager.centerOn(coords, 17);

    // Abrir popup do marcador
    setTimeout(() => {
      this.busMarkerManager.openPopup(vehicleId);
    }, 300);
  }

  showError(message) {
    console.error('❌', message);
    this.arrivalsList.showError(message);
  }

  cleanup() {
    autoRefreshManager.stop('stop-detail');
    eventBus.off('arrivalClicked');
    if (this.busMarkerManager) {
      this.busMarkerManager.clearAllMarkers();
    }
    if (this.mapManager) {
      this.mapManager.cleanup();
    }
    console.log('🗑 StopDetailApp cleanup concluído');
  }
}

// Auto-inicializar quando DOM estiver pronto
if (typeof window !== 'undefined') {
  const app = new StopDetailApp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }

  // Cleanup ao sair da página
  window.addEventListener('beforeunload', () => app.cleanup());
}
