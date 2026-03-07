/**
 * StopsMapApp - Aplicação de mapa de paragens
 * Usa: MapManager, StopMarkerManager, BusMarkerManager, NextArrivals, LoadingSpinner
 */

import { geolocationService } from '../core/geolocationService.js';
import { apiService } from '../core/apiService.js';
import { stopService } from '../services/stopService.js';
import { vehicleService } from '../services/vehicleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { scheduleService } from '../services/scheduleService.js';
import { MapManager } from '../map/MapManager.js';
import { StopMarkerManager } from '../map/markers/StopMarkerManager.js';
import { BusMarkerManager } from '../map/markers/BusMarkerManager.js';
import { createCenterControl } from '../map/controls/CenterControl.js';
import { createBusMapControl } from '../map/controls/BusMapControl.js';
import { NextArrivals } from '../ui/components/NextArrivals.js';
import { LoadingSpinner } from '../ui/components/LoadingSpinner.js';
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
    this.loadingOverlay = null;
    
    // Estado
    this.currentStopId = null;
    this.currentStopPosition = null;
    this.refreshInterval = null;

    // ⭐ NOVO: estado da pesquisa e supressão de reload
    this.isSearchActive = false;
    this.suppressMapChangeUntil = 0;
    
    // ⭐ NOVO: Raio dinâmico baseado no zoom
    this.currentRadius = 1000; // Metro padrão
    this.isLoadingStops = false;
    this.loadStopsDebounce = null;
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando StopsMapApp...');

      // ✨ Mostrar loading inicial
      this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa de paragens...');

      // 1. Carregar calendário (para service_id)
      await scheduleService.loadScheduleData();

      // 2. Inicializar mapa
      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      // 3. Adicionar controlos
      this.centerControl = createCenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition()
      );
      this.centerControl.addTo(this.mapManager.map);

      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      // 4. Inicializar marker managers
      this.stopMarkerManager = new StopMarkerManager(this.mapManager.map);
      this.busMarkerManager = new BusMarkerManager(this.mapManager.map);

      // 5. Inicializar NextArrivals panel
      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      
      this.nextArrivals.onArrivalClick((data) => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
      this.nextArrivals.onRefresh(() => this.handleRefreshArrivals());

      // 6. Configurar geolocalização
      await this.setupGeolocation();

      // 7. Configurar event listeners
      this.setupEventListeners();

      // 8. ✨ Configurar listeners de zoom/movimento para raio dinâmico
      this.setupMapListeners();

      // 9. ✨ Carregar paragens próximas via API
      await this.loadNearbyStops();

      // ✨ Remover loading
      this.loadingOverlay.remove();
      this.loadingOverlay = null;

    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      if (this.loadingOverlay) {
        this.loadingOverlay.remove();
      }
      this.showError('Erro ao inicializar aplicação');
    }
  }

  async setupGeolocation() {
    try {
      const position = await geolocationService.getCurrentPosition();
      this.mapManager.updateUserMarker(position);
      this.mapManager.centerOn(position, 15);
    } catch (error) {
      console.warn('⚠️ Não foi possível obter localização:', error.message);
      // Usar centro do Porto como fallback
      this.mapManager.centerOn([41.1579, -8.6291], 13);
    }
  }

  setupEventListeners() {
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

  /**
   * ⭐ NOVO: Configurar listeners de zoom/movimento para raio dinâmico
   */
  setupMapListeners() {
    if (!this.mapManager || !this.mapManager.map) return;

    // Listener de zoom end
    this.mapManager.map.on('zoomend', () => {
      this.handleMapChange();
    });

    // Listener de movimento end (drag, pan)
    this.mapManager.map.on('moveend', () => {
      this.handleMapChange();
    });
  }

  /**
   * ⭐ NOVO: Handler de mudança do mapa (zoom/movimento) com debounce
   */
  handleMapChange() {
    // Não recarregar se NextArrivals estiver aberto
    if (this.nextArrivals && this.nextArrivals.isVisible) {
      return;
    }

    // Não recarregar enquanto há pesquisa ativa (para não "apagar" os resultados)
    if (this.isSearchActive) {
      return;
    }

    // Ignorar eventos imediatamente após ações programáticas (ex: centerOn da pesquisa)
    if (Date.now() < this.suppressMapChangeUntil) {
      return;
    }

    // Debounce para evitar múltiplas chamadas
    clearTimeout(this.loadStopsDebounce);
    this.loadStopsDebounce = setTimeout(() => {
      this.loadNearbyStops();
    }, 500); // 500ms debounce
  }

  /**
   * ⭐ NOVO: Calcular raio dinâmico baseado no zoom
   */
  calculateRadiusFromZoom(zoom) {
    // Zoom 18+ (muito próximo)
    if (zoom >= 18) return 500;
    
    // Zoom 16-17 (próximo)
    if (zoom >= 16) return 1000;
    
    // Zoom 14-15 (médio)
    if (zoom >= 14) return 2000;
    
    // Zoom 12-13 (afastado)
    if (zoom >= 12) return 4000;
    
    // Zoom < 12 (muito afastado)
    return 6000;
  }

  /**
   * ⭐ NOVO: Carregar paragens próximas via API
   */
  async loadNearbyStops() {
    // Prevenir múltiplas chamadas simultâneas
    if (this.isLoadingStops) return;
    this.isLoadingStops = true;

    try {
      // Obter centro do mapa
      const center = this.mapManager.map.getCenter();
      const lat = center.lat;
      const lng = center.lng;
      const zoom = this.mapManager.map.getZoom();

      // ✨ Calcular raio dinâmico
      this.currentRadius = this.calculateRadiusFromZoom(zoom);

      console.log(`📍 Carregando paragens (${lat.toFixed(4)}, ${lng.toFixed(4)}) raio: ${this.currentRadius}m, zoom: ${zoom}`);

      // Buscar paragens próximas via API
      const stops = await stopService.getNearbyStops(lat, lng, this.currentRadius);

      if (stops.length === 0) {
        console.warn('⚠️ Nenhuma paragem encontrada nesta área');
        this.stopMarkerManager.clearAllMarkers();
        return;
      }

      console.log(`✅ ${stops.length} paragens carregadas`);

      // Atualizar marcadores
      this.stopMarkerManager.updateStopMarkers(stops, false, (stop) => {
        this.handleStopClick(stop);
      });

    } catch (error) {
      console.error('❌ Erro ao carregar paragens:', error);
    } finally {
      this.isLoadingStops = false;
    }
  }

  handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();

    this.isSearchActive = Boolean(query);

    if (!query) {
      // Se pesquisa vazia, recarregar paragens da área atual
      this.loadNearbyStops();
      return;
    }

    // Pesquisar no cache local
    const results = stopService.searchStops(query);
    
    if (results.length === 0) {
      this.stopMarkerManager.clearAllMarkers();
      this.showError('Nenhuma paragem encontrada');
      return;
    }

    this.stopMarkerManager.updateStopMarkers(results, false, (stop) => {
      this.handleStopClick(stop);
    });

    // Suprimir reloads automáticos disparados pelo moveend/zoomend desta ação
    this.suppressMapChangeUntil = Date.now() + 1200;

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
    
    // Abrir painel (mostrará loading automaticamente)
    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    
    // Mostrar apenas o marcador desta paragem
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
      // Obter chegadas combinadas (realtime + programadas)
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60);
      
      if (arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.busMarkerManager.clearAllMarkers();
        this.nextArrivals.updateLastUpdate();
        return;
      }
      
      // Buscar dados de veículos (para mostrar localização)
      const vehicles = await apiService.fetchBusData();

      // Atualizar painel
      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
      
      // Mostrar autocarros no mapa
      await this.updateBusMap(arrivals, vehicles);
      
    } catch (error) {
      console.error('❌ Erro ao carregar chegadas:', error);
      this.nextArrivals.hideLoading();
      this.showError('Erro ao carregar informações da paragem');
    }
  }

  async updateBusMap(arrivals, vehicles) {
    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      return;
    }

    const busesToShow = [];
    const busPositions = [];

    // ✨ Processar veículos de forma assíncrona
    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;
      
      const vehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      
      if (vehicle) {
        const processedBus = await vehicleService.processBusData(vehicle);
        
        if (processedBus) {
          busesToShow.push(processedBus);
          busPositions.push([processedBus.latitude, processedBus.longitude]);
        }
      }
    }

    // Atualizar marcadores
    if (busesToShow.length > 0) {
      this.busMarkerManager.updateBusMarkers(busesToShow);

      // Ajustar zoom (considerando painel inferior de 50vh)
      setTimeout(() => {
        const mapHeight = this.mapManager.map.getSize().y;
        const panelHeight = mapHeight * 0.5;

        if (busPositions.length === 1) {
          // ⭐ IMPORTANTE: deslocar o centro para baixo para o autocarro ficar visível acima do painel
          const offsetY = panelHeight * 0.5; // ~25% da altura total
          this.mapManager.centerOnWithOffset(busPositions[0], 16, offsetY);
        } else if (busPositions.length > 1) {
          this.mapManager.fitBounds(busPositions, { 
            padding: [60, 60, panelHeight + 60, 60],
            maxZoom: 15
          });
        }
      }, 100);
    } else {
      this.busMarkerManager.clearAllMarkers();
    }
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;

    if (!location || !this.mapManager) return;

    const coords = [location.latitude, location.longitude];

    // ⭐ IMPORTANTE: ao centrar num autocarro, aplicar o mesmo offset do painel inferior
    const mapHeight = this.mapManager.map.getSize().y;
    const panelHeight = mapHeight * 0.5;
    const offsetY = panelHeight * 0.5;

    this.mapManager.centerOnWithOffset(coords, 17, offsetY);
    
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
    this.stopAutoRefresh();
    this.busMarkerManager.clearAllMarkers();
    this.stopMarkerManager.showAllMarkers();
    
    if (this.currentStopPosition) {
      this.mapManager.centerOn(this.currentStopPosition, 16);
    }
    
    this.currentStopId = null;
    this.currentStopPosition = null;
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    
    this.refreshInterval = setInterval(() => {
      if (this.currentStopId) {
        this.loadStopArrivals(this.currentStopId);
      }
    }, 5000);
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

// Auto-inicializar
if (typeof window !== 'undefined') {
  const app = new StopsMapApp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }

  window.addEventListener('beforeunload', () => app.cleanup());
}
