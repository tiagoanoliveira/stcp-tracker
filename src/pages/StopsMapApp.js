/**
 * StopsMapApp - Aplicação de mapa de paragens
 * Usa: MapManager, StopMarkerManager, BusMarkerManager, NextArrivals, vehicleService
 */

import { geolocationService } from '../core/geolocationService.js';
import { apiService } from '../core/apiService.js';
import { stopService } from '../services/stopService.js';
import { vehicleService } from '../services/vehicleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { MapManager } from '../map/MapManager.js';
import { StopMarkerManager } from '../map/markers/StopMarkerManager.js';
import { BusMarkerManager } from '../map/markers/BusMarkerManager.js';
import { createCenterControl } from '../map/controls/CenterControl.js';
import { createBusMapControl } from '../map/controls/BusMapControl.js';
import { NextArrivals } from '../ui/components/NextArrivals.js';
import { iconCache } from '../ui/design/iconCache.js';

export class StopsMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.mapManager = null;
    this.stopMarkerManager = null;
    this.busMarkerManager = null;
    this.centerControl = null;
    this.busMapControl = null;
    this.nextArrivals = null;
    
    // Estado
    this.currentStopId = null;
    this.currentStopPosition = null;
    this.refreshInterval = null;
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando StopsMapApp...');

      // 1. Carregar dados de paragens
      await stopService.loadStopsData();

      // 2. Inicializar mapa
      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      // 3. Adicionar controlo de centrar
      this.centerControl = createCenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition()
      );
      this.centerControl.addTo(this.mapManager.map);

      // 4. Adicionar controlo de voltar ao busmap
      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      // 5. Inicializar stop marker manager
      this.stopMarkerManager = new StopMarkerManager(this.mapManager.map);
      
      // 6. Inicializar bus marker manager
      this.busMarkerManager = new BusMarkerManager(this.mapManager.map);

      // 7. Inicializar NextArrivals panel
      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      
      // Callbacks
      this.nextArrivals.onArrivalClick((data) => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
      this.nextArrivals.onRefresh(() => this.handleRefreshArrivals());

      // 8. Configurar geolocalização
      this.setupGeolocation();

      // 9. Configurar event listeners
      this.setupEventListeners();

      // 10. Mostrar paragens
      this.displayAllStops();

    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      this.showError('Erro ao inicializar aplicação');
    }
  }

  setupGeolocation() {
    geolocationService.getCurrentPosition()
      .then(position => {
        this.mapManager.updateUserMarker(position);
        this.displayNearbyStops();
      })
      .catch(error => {
        console.warn('⚠ Não foi possível obter localização:', error.message);
        this.displayAllStops();
      });
  }

  setupEventListeners() {
    // Pesquisa ao escrever (debounced)
    const searchInput = document.getElementById('stop-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.handleSearch();
        }, 300);
      });

      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(searchTimeout);
          this.handleSearch();
        }
      });
    }
  }

  displayAllStops() {
    const stops = stopService.getAllStops();
    this.stopMarkerManager.updateStopMarkers(stops, false, (stop) => {
      this.handleStopClick(stop);
    });
  }

  displayNearbyStops() {
    const userPos = this.mapManager.getUserPosition();
    if (!userPos) {
      this.displayAllStops();
      return;
    }

    const nearbyStops = stopService.getNearbyStops(userPos[0], userPos[1], 2000);
    
    if (nearbyStops.length > 0) {
      this.stopMarkerManager.updateStopMarkers(nearbyStops, true, (stop) => {
        this.handleStopClick(stop);
      });
      this.mapManager.centerOn(userPos, 15);
    } else {
      this.displayAllStops();
    }
  }

  handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();

    if (!query) {
      this.displayNearbyStops();
      return;
    }

    const results = stopService.searchStops(query);
    
    if (results.length === 0) {
      this.stopMarkerManager.clearAllMarkers();
      return;
    }

    this.stopMarkerManager.updateStopMarkers(results, false, (stop) => {
      this.handleStopClick(stop);
    });

    if (results.length === 1) {
      this.mapManager.centerOn([results[0].latitude, results[0].longitude], 16);
    } else {
      const positions = results.map(s => [s.latitude, s.longitude]);
      this.mapManager.fitBounds(positions);
    }
  }

  async handleStopClick(stop) {
    this.currentStopId = stop.stop_id;
    this.currentStopPosition = [stop.latitude, stop.longitude];
    
    // Abrir painel (passar stopId para mostrar código)
    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    
    // Mostrar apenas o marcador desta paragem (esconder os outros)
    this.stopMarkerManager.showOnlyMarker(stop.stop_id);
    
    // Fechar popup da paragem
    this.mapManager.map.closePopup();

    // Carregar e mostrar chegadas
    await this.loadStopArrivals(stop.stop_id);
    
    // Iniciar auto-refresh
    this.startAutoRefresh();
  }

  async loadStopArrivals(stopId) {
    try {
      // Usar o serviço de chegadas planeadas para obter chegadas combinadas (realtime + programadas)
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60);
      
      if (arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.busMarkerManager.clearAllMarkers();
        this.nextArrivals.updateLastUpdate();
        return;
      }
      
      // Buscar dados de veículos (para mostrar localização dos autocarros)
      const vehicles = await apiService.fetchBusData();

      // Atualizar painel com TODAS as chegadas
      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
      
      // Filtrar e mostrar apenas autocarros que vão à paragem
      this.updateBusMap(arrivals, vehicles);
      
    } catch (error) {
      console.error('❌ Erro ao carregar chegadas:', error);
      this.showError('Erro ao carregar informações da paragem');
    }
  }

  updateBusMap(arrivals, vehicles) {
    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      return;
    }

    // Filtrar e processar veículos que correspondem às chegadas
    const busesToShow = [];
    const busPositions = [];

    arrivals.forEach(arrival => {
      // Apenas tentar fazer match para chegadas em tempo real
      if (!arrival.is_realtime) return;
      
      const vehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      
      if (vehicle) {
        // Processar veículo usando vehicleService.processBusData()
        const processedBus = vehicleService.processBusData(vehicle, arrival.trip_headsign);
        
        if (processedBus) {
          busesToShow.push(processedBus);
          busPositions.push([processedBus.latitude, processedBus.longitude]);
        }
      }
    });

    // Atualizar marcadores de autocarros
    if (busesToShow.length > 0) {
      this.busMarkerManager.updateBusMarkers(busesToShow);

      // Ajustar zoom do mapa para mostrar todos os autocarros
      // IMPORTANTE: Como o painel ocupa metade inferior (50vh),
      // precisamos ajustar o padding para centrar na metade superior
      setTimeout(() => {
        if (busPositions.length === 1) {
          // Se for apenas 1 autocarro, centrar nele com zoom 16
          this.mapManager.centerOn(busPositions[0], 16);
        } else if (busPositions.length > 1) {
          // Se forem vários, ajustar bounds para ver todos
          // Padding maior em baixo para compensar o painel (50vh = ~metade do ecrã)
          const mapHeight = this.mapManager.map.getSize().y;
          const panelHeight = mapHeight * 0.5; // 50% do ecrã
          
          this.mapManager.fitBounds(busPositions, { 
            padding: [60, 60, panelHeight + 60, 60], // top, right, bottom, left
            maxZoom: 15
          });
        }
      }, 100);
    } else {
      // Nenhum autocarro encontrado - limpar mapa
      this.busMarkerManager.clearAllMarkers();
    }
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;

    if (!location || !this.mapManager) return;
    
    // Fazer zoom no autocarro (na metade superior do ecrã)
    const coords = [location.latitude, location.longitude];
    this.mapManager.centerOn(coords, 17);
    
    // Abrir popup do marcador
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) {
      marker.openPopup();
    }
  }

  handleRefreshArrivals() {
    if (this.currentStopId) {
      this.loadStopArrivals(this.currentStopId);
    }
  }

  handleCloseArrivals() {
    // Parar auto-refresh
    this.stopAutoRefresh();
    
    // Limpar autocarros do mapa
    this.busMarkerManager.clearAllMarkers();
    
    // Mostrar todas as paragens novamente
    this.stopMarkerManager.showAllMarkers();
    
    // Voltar à paragem que foi consultada
    if (this.currentStopPosition) {
      this.mapManager.centerOn(this.currentStopPosition, 16);
    }
    
    // Limpar estado
    this.currentStopId = null;
    this.currentStopPosition = null;
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    
    this.refreshInterval = setInterval(() => {
      if (this.currentStopId) {
        this.loadStopArrivals(this.currentStopId);
      }
    }, 5000); // 5 segundos
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  showError(message) {
    console.error('❌', message);
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('show');
      setTimeout(() => {
        errorElement.classList.remove('show');
      }, 5000);
    }
  }

  cleanup() {
    this.stopAutoRefresh();
    geolocationService.stopWatching();
    
    if (this.stopMarkerManager) {
      this.stopMarkerManager.clearAllMarkers();
    }
    
    if (this.busMarkerManager) {
      this.busMarkerManager.clearAllMarkers();
    }
    
    if (this.nextArrivals) {
      this.nextArrivals.destroy();
    }
    
    if (this.mapManager) {
      this.mapManager.cleanup();
    }
  }
}

// Auto-inicializar quando DOM estiver pronto
if (typeof window !== 'undefined') {
  const app = new StopsMapApp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }

  // Cleanup ao sair da página
  window.addEventListener('beforeunload', () => app.cleanup());
}
