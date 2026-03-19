/**
 * BusMapApp - Mapa de autocarros em tempo real
 */

import { apiService }          from '../core/apiService.js';
import { geolocationService }  from '../core/geolocationService.js';
import { autoRefreshManager }  from '../core/autoRefreshManager.js';
import { vehicleService }      from '../services/vehicleService.js';
import { routeService }        from '../services/routeService.js';
import { MapManager }          from '../map/MapManager.js';
import { BusMarkerManager }    from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }  from '../map/LineOverlayManager.js';
import { LastUpdateDisplay }   from '../ui/components/LastUpdateDisplay.js';
import { LoadingSpinner }      from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }      from '../ui/components/RouteFilterBar.js';
import { createCenterControl } from '../map/controls/CenterControl.js';
import { createStopsControl }  from '../map/controls/StopsControl.js';

export class BusMapApp {
  constructor(options = {}) {
    this.mapElementId    = options.mapElementId    || 'map';
    this.refreshInterval = options.refreshInterval || 5000;

    this.mapManager         = null;
    this.busMarkerManager   = null;
    this.lineOverlayManager = null;
    this.routeFilterBar     = null;
    this.lastUpdateDisplay  = new LastUpdateDisplay();
    this.centerControl      = null;
    this.stopsControl       = null;
    this.loadingOverlay     = null;

    this._selectedRoutes    = new Set();
    // Map<routeNumber, direction> para filtrar markers por linha e direção
    this._routeDirMap       = new Map();
    this._allProcessedBuses = [];
  }

  async initialize() {
    try {
      console.log('\uD83D\uDE80 Inicializando BusMapApp...');
      this.loadingOverlay = LoadingSpinner.createOverlay('A carregar mapa de autocarros...');

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);
      this.stopsControl = createStopsControl(this.mapManager.map);
      this.stopsControl.addTo(this.mapManager.map);

      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      this.routeFilterBar = new RouteFilterBar('route-filter-bar');
      this.routeFilterBar.mount();
      this.routeFilterBar.setLoading(true);
      this.routeFilterBar.onFilterChange((selected, routeObjs) =>
        this._handleRouteFilterChange(selected, routeObjs)
      );

      routeService.fetchRoutesList().then(routes => {
        this.routeFilterBar.setRoutes(routes);
      }).catch(() => {
        this.routeFilterBar.setLoading(false);
      });

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

      // Guardar linha E direção de cada marcador
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

  async _handleRouteFilterChange(selected, routeObjs) {
    this._selectedRoutes = selected;

    // Actualizar mapa linha -> direção
    this._routeDirMap = new Map(routeObjs.map(r => [String(r.number), r.direction ?? 0]));

    if (selected.size === 0) {
      this.lineOverlayManager.clearAll();
      this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
      // Repor todos os markers visíveis
      this.busMarkerManager.filterByRoutes(new Set());
      return;
    }

    // Filtrar markers imediatamente por linha e direção
    this.busMarkerManager.filterByRoutes(selected, this._routeDirMap);

    // Carregar shapes
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

  showError(message) {
    console.error('\u274C', message);
    const el = document.getElementById('error-message');
    if (el) { el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 5000); }
  }

  cleanup() {
    autoRefreshManager.stop('bus-map');
    geolocationService.stopWatching();
    if (this.busMarkerManager)   this.busMarkerManager.clearAllMarkers();
    if (this.lineOverlayManager) this.lineOverlayManager.clearAll();
    if (this.routeFilterBar)     this.routeFilterBar.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
  }
}

if (typeof window !== 'undefined') {
  const app = new BusMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
