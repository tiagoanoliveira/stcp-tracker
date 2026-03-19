/**
 * BusMapApp - Mapa de autocarros em tempo real
 *
 * Fase 5: painel de próximas chegadas acessível a partir dos markers
 *         de paragem desenhados pelas overlays de linha.
 */

import { apiService }            from '../core/apiService.js';
import { geolocationService }    from '../core/geolocationService.js';
import { autoRefreshManager }    from '../core/autoRefreshManager.js';
import { vehicleService }        from '../services/vehicleService.js';
import { routeService }          from '../services/routeService.js';
import { scheduleService }       from '../services/scheduleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { MapManager }            from '../map/MapManager.js';
import { BusMarkerManager }      from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }    from '../map/LineOverlayManager.js';
import { LastUpdateDisplay }     from '../ui/components/LastUpdateDisplay.js';
import { LoadingSpinner }        from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }        from '../ui/components/RouteFilterBar.js';
import { NextArrivals }          from '../ui/components/NextArrivals.js';
import { createCenterControl }   from '../map/controls/CenterControl.js';
import { createStopsControl }    from '../map/controls/StopsControl.js';

export class BusMapApp {
  constructor(options = {}) {
    this.mapElementId    = options.mapElementId    || 'map';
    this.refreshInterval = options.refreshInterval || 5000;

    this.mapManager         = null;
    this.busMarkerManager   = null;
    this.lineOverlayManager = null;
    this.routeFilterBar     = null;
    this.nextArrivals       = null;
    this.lastUpdateDisplay  = new LastUpdateDisplay();
    this.centerControl      = null;
    this.stopsControl       = null;
    this.loadingOverlay     = null;

    this._selectedRoutes    = new Set();
    this._routeDirMap       = new Map();
    this._allProcessedBuses = [];

    // Estado do painel de chegadas
    this._arrivalsRefreshInterval = null;
    this._currentStopId           = null;
    this._currentStopPosition     = null;
    this._currentBusPositions     = [];
    this._busMapCentered          = false;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async initialize() {
    try {
      console.log('\uD83D\uDE80 Inicializando BusMapApp...');
      this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa de autocarros...');

      // Carregar dados de horários (necessário para próximas chegadas)
      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);
      this.stopsControl = createStopsControl(this.mapManager.map);
      this.stopsControl.addTo(this.mapManager.map);

      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      // Painel de próximas chegadas
      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data  => this._handleArrivalClick(data));
      this.nextArrivals.onClose(()           => this._handleCloseArrivals());
      this.nextArrivals.onRefresh(()         => this._handleRefreshArrivals());

      // Callback do LineOverlayManager: botão "Próximos autocarros" nos stop markers
      this.lineOverlayManager.onStopClick(stop => this._handleStopClick(stop));

      // Barra de filtro de linhas
      this.routeFilterBar = new RouteFilterBar('route-filter-bar');
      this.routeFilterBar.mount();
      this.routeFilterBar.setLoading(true);
      this.routeFilterBar.onFilterChange((selected, routeObjs) =>
        this._handleRouteFilterChange(selected, routeObjs)
      );
      routeService.fetchRoutesList().then(routes => {
        this.routeFilterBar.setRoutes(routes);
      }).catch(() => this.routeFilterBar.setLoading(false));

      this.setupGeolocation();
      this.setupEventListeners();
      this.lastUpdateDisplay.initialize();

      this.loadingOverlay.update('A carregar autocarros...');
      await this.fetchAndUpdateBuses();

      this.loadingOverlay.remove();
      this.loadingOverlay = null;

      this.startAutoRefresh();
      console.log('\u2705 BusMapApp inicializado');
    } catch (error) {
      console.error('\u274C Erro na inicializa\u00e7\u00e3o:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
      this.showError('Erro ao inicializar aplica\u00e7\u00e3o');
    }
  }

  setupGeolocation() {
    geolocationService.getCurrentPosition()
      .then(position => this.mapManager.updateUserMarker(position))
      .catch(err => console.warn('\u26A0\uFE0F Localiza\u00e7\u00e3o indispon\u00edvel:', err.message));
  }

  setupEventListeners() {
    const btn = document.getElementById('refresh-now');
    if (btn) btn.addEventListener('click', () => autoRefreshManager.forceRefresh('bus-map'));
  }

  startAutoRefresh() {
    autoRefreshManager.start('bus-map', () => this.fetchAndUpdateBuses(), this.refreshInterval);
  }

  // ---------------------------------------------------------------------------
  // Fetch + update de autocarros
  // ---------------------------------------------------------------------------

  async fetchAndUpdateBuses() {
    try {
      const rawBusData = await apiService.fetchBusData();
      if (!Array.isArray(rawBusData) || rawBusData.length === 0) {
        this.busMarkerManager.clearAllMarkers();
        this.lastUpdateDisplay.update();
        return;
      }

      const processed = await vehicleService.processBusDataBatch(rawBusData);
      this._allProcessedBuses = processed;

      processed.forEach(bus => {
        this.busMarkerManager.setRouteForMarker(bus.id, bus.line || '', bus.direction);
      });

      const toShow = this._selectedRoutes.size > 0
        ? processed.filter(b => this._selectedRoutes.has(String(b.line || '')))
        : processed;

      this.busMarkerManager.updateBusMarkers(toShow);

      if (this._selectedRoutes.size > 0) {
        this.busMarkerManager.filterByRoutes(this._selectedRoutes, this._routeDirMap);
      }

      this.lastUpdateDisplay.update();
    } catch (error) {
      console.error('\u274C Erro ao atualizar autocarros:', error);
      this.showError('Erro ao obter dados dos autocarros');
    }
  }

  // ---------------------------------------------------------------------------
  // Filtro de linhas
  // ---------------------------------------------------------------------------

  async _handleRouteFilterChange(selected, routeObjs) {
    this._selectedRoutes = selected;
    this._routeDirMap    = new Map(routeObjs.map(r => [String(r.number), r.direction ?? 0]));

    if (selected.size === 0) {
      this.lineOverlayManager.clearAll();
      this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
      this.busMarkerManager.filterByRoutes(new Set());
      return;
    }

    this.busMarkerManager.filterByRoutes(selected, this._routeDirMap);

    const routesToFetch = routeObjs.map(r => ({
      routeId:    String(r.id || r.number),
      direction:  r.direction ?? 0,
      color:      r.color      || '#187EC2',
      text_color: r.text_color || '#FFFFFF'
    }));

    const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
    this.lineOverlayManager.setRoutes(overlayData);

    const visiblePositions = this.busMarkerManager.filterByRoutes(selected, this._routeDirMap);
    if (visiblePositions.length > 0) {
      this._fitToPositions(visiblePositions);
    } else if (this.lineOverlayManager.hasActiveLayers()) {
      this.lineOverlayManager.fitBounds();
    }
  }

  // ---------------------------------------------------------------------------
  // Painel de próximas chegadas
  // ---------------------------------------------------------------------------

  async _handleStopClick(stop) {
    this._currentStopId       = stop.stop_id;
    this._currentStopPosition = [stop.latitude, stop.longitude];
    this._busMapCentered      = false;
    this._currentBusPositions = [];

    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();

    // Carregar rotas da paragem
    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes
      : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    await this._loadStopArrivals(stop.stop_id, true);
    this._startArrivalsRefresh();
  }

  async _loadStopArrivals(stopId, centerMap = false) {
    try {
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60);
      if (arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.nextArrivals.updateLastUpdate();
        return;
      }
      const vehicles = await apiService.fetchBusData();
      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
      await this._updateArrivalsOnMap(arrivals, vehicles, centerMap);
    } catch (error) {
      console.error('\u274C Erro ao carregar chegadas:', error);
      this.nextArrivals.hideLoading();
      this.showError('Erro ao carregar informações da paragem');
    }
  }

  async _updateArrivalsOnMap(arrivals, vehicles, centerMap = false) {
    const busesToShow  = [];
    const busPositions = [];

    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;
      const vehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      if (!vehicle) continue;
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

    if (busesToShow.length === 0) return;

    this.busMarkerManager.updateBusMarkers(busesToShow);
    this._currentBusPositions = busPositions;

    if (centerMap && !this._busMapCentered && busPositions.length > 0) {
      this._busMapCentered = true;
      setTimeout(() => this._recenterOnPositions(busPositions), 150);
    }
  }

  _handleArrivalClick(data) {
    const { vehicleId, location } = data;
    if (!location || !this.mapManager) return;
    const offsetY = Math.round(this.mapManager.map.getSize().y * 0.25);
    this.mapManager.centerOnWithOffset(
      [location.latitude, location.longitude], 17, offsetY
    );
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) marker.openPopup();
  }

  _handleRefreshArrivals() {
    if (this._currentStopId) this._loadStopArrivals(this._currentStopId, false);
  }

  _handleCloseArrivals() {
    this._stopArrivalsRefresh();
    this._currentStopId       = null;
    this._currentStopPosition = null;
    this._busMapCentered      = false;
    this._currentBusPositions = [];
    // Não limpa os bus markers globais — retoma os autocarros da linha filtrada
    if (this._selectedRoutes.size > 0) {
      this.busMarkerManager.filterByRoutes(this._selectedRoutes, this._routeDirMap);
    } else {
      this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
    }
  }

  _startArrivalsRefresh() {
    this._stopArrivalsRefresh();
    this._arrivalsRefreshInterval = setInterval(() => {
      if (this._currentStopId) this._loadStopArrivals(this._currentStopId, false);
    }, 5000);
  }

  _stopArrivalsRefresh() {
    if (this._arrivalsRefreshInterval) {
      clearInterval(this._arrivalsRefreshInterval);
      this._arrivalsRefreshInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Utils de mapa
  // ---------------------------------------------------------------------------

  _fitToPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    if (positions.length === 1) {
      this.mapManager.centerOn(positions[0], 16);
    } else {
      this.mapManager.fitBounds(positions, {
        paddingTopLeft: [60, 100], paddingBottomRight: [60, 60],
        maxZoom: 16, minZoom: 11
      });
    }
  }

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

  showError(message) {
    console.error('\u274C', message);
    const el = document.getElementById('error-message');
    if (el) { el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 5000); }
  }

  cleanup() {
    autoRefreshManager.stop('bus-map');
    this._stopArrivalsRefresh();
    geolocationService.stopWatching();
    if (this.busMarkerManager)   this.busMarkerManager.clearAllMarkers();
    if (this.lineOverlayManager) this.lineOverlayManager.clearAll();
    if (this.routeFilterBar)     this.routeFilterBar.destroy();
    if (this.nextArrivals)       this.nextArrivals.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
  }
}

if (typeof window !== 'undefined') {
  const app = new BusMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
