/**
 * StopsMapApp - Aplicação de mapa de paragens
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
    
    // Estado da paragem atual
    this.currentStopId = null;
    this.currentStopPosition = null;
    this.refreshInterval = null;

    // Estado da pesquisa
    this.isSearchActive = false;
    this.suppressMapChangeUntil = 0;
    this._searchGeneration = 0;
    
    // Raio dinâmico
    this.currentRadius = 1000;
    this.isLoadingStops = false;
    this.loadStopsDebounce = null;
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando StopsMapApp...');
      this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa de paragens...');

      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);
      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      this.stopMarkerManager = new StopMarkerManager(this.mapManager.map);
      this.busMarkerManager = new BusMarkerManager(this.mapManager.map);

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick((data) => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
      this.nextArrivals.onRefresh(() => this.handleRefreshArrivals());

      await this.setupGeolocation();
      this.setupEventListeners();
      this.setupMapListeners();
      await this.loadNearbyStops();

      this.loadingOverlay.remove();
      this.loadingOverlay = null;
    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
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
      this.mapManager.centerOn([41.1579, -8.6291], 13);
    }
  }

  setupEventListeners() {
    const searchInput = document.getElementById('stop-search');
    const clearBtn = document.getElementById('search-clear');
    if (!searchInput) return;

    let searchTimeout;

    // Mostrar/esconder botão × e lançar pesquisa
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      if (clearBtn) {
        clearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
      }
      searchTimeout = setTimeout(() => this.handleSearch(), 300);
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimeout);
        this.handleSearch();
      }
    });

    // Botão × limpa a pesquisa
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.handleClearSearch());
    }
  }

  setupMapListeners() {
    if (!this.mapManager?.map) return;
    this.mapManager.map.on('zoomend', () => this.handleMapChange());
    this.mapManager.map.on('moveend', () => this.handleMapChange());
  }

  handleMapChange() {
    if (this.nextArrivals?.isVisible) return;
    if (this.isSearchActive) return;
    if (Date.now() < this.suppressMapChangeUntil) return;
    clearTimeout(this.loadStopsDebounce);
    this.loadStopsDebounce = setTimeout(() => this.loadNearbyStops(), 500);
  }

  calculateRadiusFromZoom(zoom) {
    if (zoom >= 18) return 500;
    if (zoom >= 16) return 1000;
    if (zoom >= 14) return 2000;
    if (zoom >= 12) return 4000;
    return 6000;
  }

  async loadNearbyStops() {
    if (this.isLoadingStops) return;
    this.isLoadingStops = true;
    try {
      const center = this.mapManager.map.getCenter();
      const zoom = this.mapManager.map.getZoom();
      this.currentRadius = this.calculateRadiusFromZoom(zoom);
      console.log(`📍 Carregando paragens (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}) raio: ${this.currentRadius}m`);
      const stops = await stopService.getNearbyStops(center.lat, center.lng, this.currentRadius);
      if (stops.length === 0) { this.stopMarkerManager.clearAllMarkers(); return; }
      this.stopMarkerManager.updateStopMarkers(stops, false, (stop) => this.handleStopClick(stop));
    } catch (error) {
      console.error('❌ Erro ao carregar paragens:', error);
    } finally {
      this.isLoadingStops = false;
    }
  }

  // -------------------------------------------------------------------------
  // Pesquisa
  // -------------------------------------------------------------------------

  async handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();
    this.isSearchActive = Boolean(query);

    if (!query) {
      this.loadNearbyStops();
      return;
    }

    const generation = ++this._searchGeneration;
    const results = await stopService.searchStops(query);
    if (generation !== this._searchGeneration) return; // descartado

    if (results.length === 0) {
      this.stopMarkerManager.clearAllMarkers();
      this.showError('Nenhuma paragem encontrada');
      return;
    }

    this.stopMarkerManager.updateStopMarkers(results, false, (stop) => this.handleStopClick(stop));
    this.suppressMapChangeUntil = Date.now() + 1500;

    if (results.length === 1) {
      this.mapManager.centerOn([results[0].latitude, results[0].longitude], 16);
    } else {
      this.mapManager.fitBounds(results.map(s => [s.latitude, s.longitude]));
    }
  }

  /**
   * Limpa a caixa de pesquisa, esconde o botão × e volta ao modo normal.
   * Usado tanto pelo click no botão × como pelo handleCloseArrivals.
   * @param {boolean} focusInput - Se true, foca o input após limpar
   * @param {number} reloadDelay - ms antes de recarregar as paragens próximas (0 = imediato)
   */
  _clearSearch(focusInput = false, reloadDelay = 0) {
    const searchInput = document.getElementById('stop-search');
    const clearBtn = document.getElementById('search-clear');

    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    this.isSearchActive = false;
    this._searchGeneration++; // cancelar qualquer pesquisa em curso

    if (focusInput && searchInput) searchInput.focus();

    if (reloadDelay > 0) {
      setTimeout(() => this.loadNearbyStops(), reloadDelay);
    } else {
      this.loadNearbyStops();
    }
  }

  /** Chamado pelo click no botão × */
  handleClearSearch() {
    this._clearSearch(true, 0);
  }

  // -------------------------------------------------------------------------
  // Paragem / Chegadas
  // -------------------------------------------------------------------------

  async handleStopClick(stop) {
    this.currentStopId = stop.stop_id;
    this.currentStopPosition = [stop.latitude, stop.longitude];
    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.stopMarkerManager.showOnlyMarker(stop.stop_id);
    this.mapManager.map.closePopup();
    await this.loadStopArrivals(stop.stop_id);
    this.startAutoRefresh();
  }

  async loadStopArrivals(stopId) {
    try {
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60);
      if (arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.busMarkerManager.clearAllMarkers();
        this.nextArrivals.updateLastUpdate();
        return;
      }
      const vehicles = await apiService.fetchBusData();
      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
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

    if (busesToShow.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      return;
    }

    this.busMarkerManager.updateBusMarkers(busesToShow);

    setTimeout(() => {
      const mapHeight = this.mapManager.map.getSize().y;
      const panelHeight = mapHeight * 0.5; // NextArrivals ocupa ~50vh

      if (busPositions.length === 1) {
        // 1 autocarro: offset para que fique na metade superior visível
        const offsetY = Math.round(panelHeight * 0.5);
        this.mapManager.centerOnWithOffset(busPositions[0], 16, offsetY);
      } else {
        // Vários autocarros: padding assimétrico correto (API Leaflet) + minZoom
        this.mapManager.fitBounds(busPositions, {
          paddingTopLeft: [20, 60],
          paddingBottomRight: [20, panelHeight],
          maxZoom: 18,
          minZoom: 13  // evita zoom excessivamente afastado por causa do padding
        });
      }
    }, 150);
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;
    if (!location || !this.mapManager) return;
    const coords = [location.latitude, location.longitude];
    const mapHeight = this.mapManager.map.getSize().y;
    const offsetY = Math.round(mapHeight * 0.25);
    this.mapManager.centerOnWithOffset(coords, 17, offsetY);
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) marker.openPopup();
  }

  handleRefreshArrivals() {
    if (this.currentStopId) this.loadStopArrivals(this.currentStopId);
  }

  handleCloseArrivals() {
    this.stopAutoRefresh();
    this.busMarkerManager.clearAllMarkers();

    const wasSearchActive = this.isSearchActive;
    const returnPosition = this.currentStopPosition;

    this.currentStopId = null;
    this.currentStopPosition = null;

    // Centrar sempre na posição da paragem que estava selecionada
    if (returnPosition) {
      this.suppressMapChangeUntil = Date.now() + 1800;
      this.mapManager.centerOn(returnPosition, 16);
    }

    if (wasSearchActive) {
      // Pesquisa estava ativa: limpar e recarregar paragens normais
      // Aguardar a animação do centerOn antes de recarregar
      this._clearSearch(false, 700);
    } else {
      // Modo normal: mostrar paragens já carregadas
      this.stopMarkerManager.showAllMarkers();
    }
  }

  // -------------------------------------------------------------------------
  // Auto-refresh
  // -------------------------------------------------------------------------

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      if (this.currentStopId) this.loadStopArrivals(this.currentStopId);
    }, 5000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  showError(message) {
    console.error('❌', message);
    const el = document.getElementById('error-message');
    if (el) {
      el.textContent = message;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 5000);
    }
  }

  cleanup() {
    this.stopAutoRefresh();
    geolocationService.stopWatching();
    if (this.stopMarkerManager) this.stopMarkerManager.clearAllMarkers();
    if (this.busMarkerManager) this.busMarkerManager.clearAllMarkers();
    if (this.nextArrivals) this.nextArrivals.destroy();
    if (this.mapManager) this.mapManager.cleanup();
  }
}

if (typeof window !== 'undefined') {
  const app = new StopsMapApp();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }
  window.addEventListener('beforeunload', () => app.cleanup());
}
