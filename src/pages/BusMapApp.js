/**
 * BusMapApp - Mapa de autocarros em tempo real
 *
 * Deep-link: ?stop=<stop_id>[&line=<route_number>[&dir=<0|1>]]
 * Abre automaticamente o painel de chegadas da paragem indicada,
 * com o filtro de linha pré-seleccionado se especificado.
 */

import { apiService }             from '../core/apiService.js';
import { geolocationService }     from '../core/geolocationService.js';
import { autoRefreshManager }     from '../core/autoRefreshManager.js';
import { vehicleService }         from '../services/vehicleService.js';
import { routeService }           from '../services/routeService.js';
import { scheduleService }        from '../services/scheduleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { MapManager }             from '../map/MapManager.js';
import { BusMarkerManager }       from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }     from '../map/LineOverlayManager.js';
import { LastUpdateDisplay }      from '../ui/components/LastUpdateDisplay.js';
import { LoadingSpinner }         from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }         from '../ui/components/RouteFilterBar.js';
import { NextArrivals }           from '../ui/components/NextArrivals.js';
import { createCenterControl }    from '../map/controls/CenterControl.js';
import { createStopsControl }     from '../map/controls/StopsControl.js';

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

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data => this._handleArrivalClick(data));
      this.nextArrivals.onClose(()          => this._handleCloseArrivals());
      this.nextArrivals.onRefresh(()        => this._handleRefreshArrivals());

      this.lineOverlayManager.onStopClick(stop => this._handleStopClick(stop));

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

      // Deep-link: abrir paragem/filtro especificado na URL
      await this._handleDeepLink();

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
      .catch(err => console.warn('\u26A0\uFE0F Localização indisponível:', err.message));
  }

  setupEventListeners() {
    const btn = document.getElementById('refresh-now');
    if (btn) btn.addEventListener('click', () => autoRefreshManager.forceRefresh('bus-map'));
  }

  startAutoRefresh() {
    autoRefreshManager.start('bus-map', () => this.fetchAndUpdateBuses(), this.refreshInterval);
  }

  // ---------------------------------------------------------------------------
  // Deep-link
  // ---------------------------------------------------------------------------

  /**
   * Lê parâmetros da URL e activa filtro/paragem automaticamente.
   *
   * Formatos suportados:
   *   index.html?stop=<stop_id>
   *   index.html?stop=<stop_id>&line=<route_number>&dir=<0|1>
   *   index.html?line=<route_number>&dir=<0|1>
   */
  async _handleDeepLink() {
    const params  = new URLSearchParams(window.location.search);
    const stopId  = params.get('stop');
    const lineNum = params.get('line');
    const dir     = parseInt(params.get('dir') ?? '0', 10);

    if (!stopId && !lineNum) return;

    // Pré-seleccionar linha no filtro
    if (lineNum) {
      await this._waitForRoutes();
      const route = (this.routeFilterBar.routes || []).find(r => String(r.number) === String(lineNum));
      if (route) {
        const direction = isNaN(dir) ? 0 : dir;
        this.routeFilterBar.selected.set(route.number, { route, direction });
        this.routeFilterBar._render();
        await this._handleRouteFilterChange(
          new Set([route.number]),
          [{ ...route, direction }]
        );
      }
    }

    // Abrir painel de chegadas
    if (stopId) {
      try {
        const stopInfo = await apiService.fetchStopInfo(stopId);
        const stop = {
          stop_id:   stopId,
          stop_name: stopInfo?.stop_name || `Paragem ${stopId}`,
          latitude:  stopInfo?.latitude  || 41.1579,
          longitude: stopInfo?.longitude || -8.6291,
          routes:    stopInfo?.routes    || []
        };
        this.mapManager.centerOn([stop.latitude, stop.longitude], 16);
        await this._handleStopClick(stop);
      } catch (e) {
        console.warn('Deep-link: paragem não encontrada', stopId, e);
      }
    }
  }

  /** Aguarda até o RouteFilterBar ter linhas carregadas (máx 5s) */
  _waitForRoutes() {
    return new Promise(resolve => {
      if (this.routeFilterBar?.routes?.length > 0) { resolve(); return; }
      const check = setInterval(() => {
        if (this.routeFilterBar?.routes?.length > 0) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
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
    // Cancelar refresh anterior antes de abrir nova paragem
    this._stopArrivalsRefresh();
    this.busMarkerManager.clearAllMarkers();

    this._currentStopId       = stop.stop_id;
    this._currentStopPosition = [stop.latitude, stop.longitude];
    this._busMapCentered      = false;
    this._currentBusPositions = [];

    // show() actualiza nome/código mesmo que o painel já esteja visível
    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes
      : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    await this._loadStopArrivals(stop.stop_id, true);
    this._startArrivalsRefresh();

    // Manter a URL sincronizada
    this._pushStopToURL(stop.stop_id);
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
    this.mapManager.centerOnWithOffset([location.latitude, location.longitude], 17, offsetY);
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

    // Limpar ?stop da URL
    this._clearStopFromURL();

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
  // URL sync
  // ---------------------------------------------------------------------------

  _pushStopToURL(stopId) {
    const params = new URLSearchParams(window.location.search);
    params.set('stop', stopId);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  _clearStopFromURL() {
    const params = new URLSearchParams(window.location.search);
    params.delete('stop');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
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
