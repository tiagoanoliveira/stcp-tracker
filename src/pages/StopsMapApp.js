/**
 * StopsMapApp - Aplicação de mapa de paragens
 * Fase 3+4: RouteFilterBar global + LineOverlayManager + direction toggle
 *
 * Dois modos de uso da barra de filtro:
 *
 * A) MODO GLOBAL (nenhuma paragem aberta)
 *    - Seleccionar linha(s) substitui os markers de paragem pelas paragens
 *      dessa(s) linha(s) e desenha as polylines no mapa.
 *    - Limpar filtro volta ao comportamento normal (loadNearbyStops).
 *    - Botão →/← no chip muda a direcção (ida/volta) e redesenha.
 *
 * B) MODO DETALHE (painel de chegadas aberto)
 *    - A barra de filtro global fica desactivada.
 *    - Os chips no painel de chegadas controlam markers de autocarros
 *      E desenham a polyline da linha seleccionada.
 */

import { geolocationService }    from '../core/geolocationService.js';
import { apiService }             from '../core/apiService.js';
import { stopService }            from '../services/stopService.js';
import { vehicleService }         from '../services/vehicleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { scheduleService }        from '../services/scheduleService.js';
import { routeService }           from '../services/routeService.js';
import { MapManager }             from '../map/MapManager.js';
import { StopMarkerManager }      from '../map/markers/StopMarkerManager.js';
import { BusMarkerManager }       from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }     from '../map/LineOverlayManager.js';
import { createCenterControl }    from '../map/controls/CenterControl.js';
import { createBusMapControl }    from '../map/controls/BusMapControl.js';
import { NextArrivals }           from '../ui/components/NextArrivals.js';
import { LoadingSpinner }         from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }         from '../ui/components/RouteFilterBar.js';
import { iconCache }              from '../ui/design/iconCache.js';

export class StopsMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.mapManager          = null;
    this.stopMarkerManager   = null;
    this.busMarkerManager    = null;
    this.lineOverlayManager  = null;
    this.routeFilterBar      = null;
    this.centerControl       = null;
    this.busMapControl       = null;
    this.nextArrivals        = null;
    this.loadingOverlay      = null;

    this.currentStopId       = null;
    this.currentStopPosition = null;
    this.refreshInterval     = null;
    this.busMapCentered      = false;
    this.currentBusPositions = [];

    this.isSearchActive         = false;
    this.suppressMapChangeUntil = 0;
    this._searchGeneration      = 0;

    this.currentRadius     = 1000;
    this.isLoadingStops    = false;
    this.loadStopsDebounce = null;

    // Filtro global de linhas (modo A)
    this._globalSelectedRoutes    = new Set();
    this._globalSelectedRouteObjs = [];
    this._lineFilterMode          = false;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async initialize() {
    try {
      this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa de paragens...');

      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);
      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      this.stopMarkerManager  = new StopMarkerManager(this.mapManager.map);
      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
      this.nextArrivals.onRefresh(() => this.handleRefreshArrivals());
      this.nextArrivals.onFilterChange(selected => this.handleArrivalFilterChange(selected));

      // Barra de filtro global de linhas
      this.routeFilterBar = new RouteFilterBar('route-filter-bar');
      this.routeFilterBar.mount();
      this.routeFilterBar.setLoading(true);
      this.routeFilterBar.onFilterChange((selected, routeObjs) =>
        this._handleGlobalRouteFilterChange(selected, routeObjs)
      );
      routeService.fetchRoutesList()
        .then(routes => this.routeFilterBar.setRoutes(routes))
        .catch(() => this.routeFilterBar.setLoading(false));

      await this.setupGeolocation();
      this.setupEventListeners();
      this.setupMapListeners();
      await this.loadNearbyStops();

      this.loadingOverlay.remove();
      this.loadingOverlay = null;
    } catch (error) {
      console.error('\u274C Erro na inicializa\u00e7\u00e3o:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
      this.showError('Erro ao inicializar aplica\u00e7\u00e3o');
    }
  }

  async setupGeolocation() {
    try {
      const position = await geolocationService.getCurrentPosition();
      this.mapManager.updateUserMarker(position);
      this.mapManager.centerOn(position, 15);
    } catch (error) {
      console.warn('\u26A0\uFE0F Não foi possível obter localização:', error.message);
      this.mapManager.centerOn([41.1579, -8.6291], 13);
    }
  }

  setupEventListeners() {
    const searchInput = document.getElementById('stop-search');
    const clearBtn    = document.getElementById('search-clear');
    if (!searchInput) return;

    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      if (clearBtn) clearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
      searchTimeout = setTimeout(() => this.handleSearch(), 300);
    });
    searchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimeout); this.handleSearch(); }
    });
    if (clearBtn) clearBtn.addEventListener('click', () => this.handleClearSearch());
  }

  setupMapListeners() {
    if (!this.mapManager?.map) return;
    this.mapManager.map.on('zoomend', () => this.handleMapChange());
    this.mapManager.map.on('moveend', () => this.handleMapChange());
    this.mapManager.map.on('popupclose', () => {
      if (this.nextArrivals?.isVisible && this.currentBusPositions.length > 0)
        setTimeout(() => this.recenterOnBuses(), 200);
    });
  }

  handleMapChange() {
    if (this.nextArrivals?.isVisible) return;
    if (this.isSearchActive) return;
    if (this._lineFilterMode) return;
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
      const zoom   = this.mapManager.map.getZoom();
      this.currentRadius = this.calculateRadiusFromZoom(zoom);
      const stops = await stopService.getNearbyStops(center.lat, center.lng, this.currentRadius);
      if (this.nextArrivals?.isVisible) return;
      if (stops.length === 0) { this.stopMarkerManager.clearAllMarkers(); return; }
      this.stopMarkerManager.updateStopMarkers(stops, false, stop => this.handleStopClick(stop));
    } catch (error) {
      console.error('\u274C Erro ao carregar paragens:', error);
    } finally {
      this.isLoadingStops = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Filtro GLOBAL de linhas (Modo A)
  // ---------------------------------------------------------------------------

  async _handleGlobalRouteFilterChange(selected, routeObjs) {
    if (this.nextArrivals?.isVisible) return;

    this._globalSelectedRoutes    = selected;
    this._globalSelectedRouteObjs = routeObjs;

    if (selected.size === 0) {
      this._lineFilterMode = false;
      this.lineOverlayManager.clearAll();
      this.stopMarkerManager.clearAllMarkers();
      this._setGlobalFilterBarDisabled(false);
      await this.loadNearbyStops();
      return;
    }

    this._lineFilterMode = true;

    // direction vem do RouteFilterBar (0 = ida, 1 = volta)
    const routesToFetch = routeObjs.map(r => ({
      routeId:    String(r.id || r.number),
      direction:  r.direction ?? 0,
      color:      r.color      || '#187EC2',
      text_color: r.text_color || '#FFFFFF'
    }));

    const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
    this.lineOverlayManager.setRoutes(overlayData);

    // Paragens da(s) linha(s)
    const allStops = [];
    overlayData.forEach(r => (r.stops?.stops || []).forEach(s => allStops.push(s)));
    const uniqueStops = Array.from(new Map(allStops.map(s => [s.stop_id, s])).values());

    this.stopMarkerManager.clearAllMarkers();
    if (uniqueStops.length > 0) {
      this.stopMarkerManager.updateStopMarkers(uniqueStops, false, stop => this.handleStopClick(stop));
    }

    this.lineOverlayManager.fitBounds();
  }

  _setGlobalFilterBarDisabled(disabled) {
    const el = document.getElementById('route-filter-bar');
    if (!el) return;
    el.dataset.disabled   = disabled ? 'true' : 'false';
    el.title              = disabled ? 'Feche o painel de chegadas para usar o filtro de linhas' : '';
  }

  // ---------------------------------------------------------------------------
  // Pesquisa
  // ---------------------------------------------------------------------------

  async handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();
    this.isSearchActive = Boolean(query);
    if (!query) { this.loadNearbyStops(); return; }

    const generation = ++this._searchGeneration;
    const results = await stopService.searchStops(query);
    if (generation !== this._searchGeneration) return;

    if (results.length === 0) { this.stopMarkerManager.clearAllMarkers(); this.showError('Nenhuma paragem encontrada'); return; }

    this.stopMarkerManager.updateStopMarkers(results, false, stop => this.handleStopClick(stop));
    this.suppressMapChangeUntil = Date.now() + 1500;
    if (results.length === 1) {
      this.mapManager.centerOn([results[0].latitude, results[0].longitude], 16);
    } else {
      this.mapManager.fitBounds(results.map(s => [s.latitude, s.longitude]));
    }
  }

  _clearSearch(focusInput = false, reloadDelay = 0) {
    const searchInput = document.getElementById('stop-search');
    const clearBtn    = document.getElementById('search-clear');
    if (searchInput) searchInput.value = '';
    if (clearBtn)    clearBtn.style.display = 'none';
    this.isSearchActive = false;
    this._searchGeneration++;
    if (focusInput && searchInput) searchInput.focus();
    if (reloadDelay > 0) setTimeout(() => this.loadNearbyStops(), reloadDelay);
    else this.loadNearbyStops();
  }

  handleClearSearch() { this._clearSearch(true, 0); }

  // ---------------------------------------------------------------------------
  // Paragem / Chegadas
  // ---------------------------------------------------------------------------

  async handleStopClick(stop) {
    this.currentStopId       = stop.stop_id;
    this.currentStopPosition = [stop.latitude, stop.longitude];
    this.busMapCentered      = false;
    this.currentBusPositions = [];

    clearTimeout(this.loadStopsDebounce);
    this.loadStopsDebounce = null;

    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.stopMarkerManager.showOnlyMarker(stop.stop_id);
    this.mapManager.map.closePopup();
    this._setGlobalFilterBarDisabled(true);

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes
      : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    await this.loadStopArrivals(stop.stop_id, true);
    this.startAutoRefresh();
  }

  async loadStopArrivals(stopId, centerMap = false) {
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
      await this.updateBusMap(arrivals, vehicles, centerMap);
    } catch (error) {
      console.error('\u274C Erro ao carregar chegadas:', error);
      this.nextArrivals.hideLoading();
      this.showError('Erro ao carregar informações da paragem');
    }
  }

  async updateBusMap(arrivals, vehicles, centerMap = false) {
    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      this.currentBusPositions = [];
      return;
    }

    const busesToShow = [];
    const busPositions = [];

    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;
      const vehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      if (!vehicle) continue;

      // processBusData é agora síncrono (sem await) - headsign lazy no popup
      const processedBus = vehicleService.processBusData(vehicle);
      if (!processedBus) continue;

      busesToShow.push(processedBus);
      busPositions.push([processedBus.latitude, processedBus.longitude]);

      const routeNum = String(
        arrival.route_short_name || arrival.route_number ||
        arrival.route_id         || processedBus.line    || ''
      );
      this.busMarkerManager.setRouteForMarker(processedBus.id, routeNum);
    }

    if (busesToShow.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      this.currentBusPositions = [];
      return;
    }

    this.busMarkerManager.updateBusMarkers(busesToShow);
    this.currentBusPositions = busPositions;

    const activeFilter = this.nextArrivals?.selectedRoutes;
    if (activeFilter && activeFilter.size > 0) {
      const visiblePositions = this.busMarkerManager.filterByRoutes(activeFilter);
      if (centerMap && !this.busMapCentered && visiblePositions.length > 0) {
        this.busMapCentered = true;
        setTimeout(() => this._recenterOnPositions(visiblePositions), 150);
      }
    } else if (centerMap && !this.busMapCentered) {
      this.busMapCentered = true;
      setTimeout(() => this.recenterOnBuses(), 150);
    }
  }

  // ---------------------------------------------------------------------------
  // Filtro de linhas no painel de chegadas (Modo B)
  // ---------------------------------------------------------------------------

  async handleArrivalFilterChange(selectedRoutes) {
    const visiblePositions = this.busMarkerManager.filterByRoutes(selectedRoutes);

    if (selectedRoutes.size === 0) {
      this.lineOverlayManager.clearAll();
    } else {
      // No painel de chegadas não temos direction toggle, usa sempre ida (0)
      const routeObjs = (this.nextArrivals?.availableRoutes || [])
        .filter(r => selectedRoutes.has(r.number))
        .map(r => ({
          routeId:    String(r.id || r.number),
          direction:  0,
          color:      r.color      || '#187EC2',
          text_color: r.text_color || '#FFFFFF'
        }));

      const overlayData = await routeService.fetchMultipleRoutesOverlay(routeObjs);
      this.lineOverlayManager.setRoutes(overlayData);
    }

    if (visiblePositions.length > 0) {
      this._recenterOnPositions(visiblePositions);
    } else if (selectedRoutes.size > 0 && this.lineOverlayManager.hasActiveLayers()) {
      this.lineOverlayManager.fitBounds({ panelHeightRatio: 0.5 });
    }
  }

  recenterOnBuses() { this._recenterOnPositions(this.currentBusPositions); }

  _recenterOnPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    const mapHeight   = this.mapManager.map.getSize().y;
    const panelHeight = mapHeight * 0.5;
    if (positions.length === 1) {
      this.mapManager.centerOnWithOffset(positions[0], 16, Math.round(panelHeight * 0.5));
    } else {
      this.mapManager.fitBounds(positions, {
        paddingTopLeft:     [60, 60],
        paddingBottomRight: [60, panelHeight + 60],
        maxZoom: 16, minZoom: 13
      });
    }
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;
    if (!location || !this.mapManager) return;
    const offsetY = Math.round(this.mapManager.map.getSize().y * 0.25);
    this.mapManager.centerOnWithOffset([location.latitude, location.longitude], 17, offsetY);
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) marker.openPopup();
  }

  handleRefreshArrivals() {
    if (this.currentStopId) this.loadStopArrivals(this.currentStopId, false);
  }

  handleCloseArrivals() {
    this.stopAutoRefresh();
    this.busMarkerManager.clearAllMarkers();
    this.lineOverlayManager.clearAll();
    this.busMapCentered      = false;
    this.currentBusPositions = [];

    const wasSearchActive = this.isSearchActive;
    const returnPosition  = this.currentStopPosition;
    this.currentStopId       = null;
    this.currentStopPosition = null;

    this._setGlobalFilterBarDisabled(false);

    if (returnPosition) {
      this.suppressMapChangeUntil = Date.now() + 1800;
      this.mapManager.centerOn(returnPosition, 16);
    }

    if (wasSearchActive) {
      this._clearSearch(false, 700);
    } else if (this._lineFilterMode && this._globalSelectedRoutes.size > 0) {
      this._handleGlobalRouteFilterChange(this._globalSelectedRoutes, this._globalSelectedRouteObjs);
    } else {
      this.stopMarkerManager.showAllMarkers();
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      if (this.currentStopId) this.loadStopArrivals(this.currentStopId, false);
    }, 5000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  showError(message) {
    console.error('\u274C', message);
    const el = document.getElementById('error-message');
    if (el) { el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 5000); }
  }

  cleanup() {
    this.stopAutoRefresh();
    geolocationService.stopWatching();
    if (this.stopMarkerManager)  this.stopMarkerManager.clearAllMarkers();
    if (this.busMarkerManager)   this.busMarkerManager.clearAllMarkers();
    if (this.lineOverlayManager) this.lineOverlayManager.clearAll();
    if (this.routeFilterBar)     this.routeFilterBar.destroy();
    if (this.nextArrivals)       this.nextArrivals.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
  }
}

if (typeof window !== 'undefined') {
  const app = new StopsMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
