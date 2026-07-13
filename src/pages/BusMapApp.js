/**
 * BusMapApp - Mapa de autocarros em tempo real
 */

import { apiService }             from '../core/apiService.js';
import { geolocationService }     from '../core/geolocationService.js';
import { autoRefreshManager }     from '../core/autoRefreshManager.js';
import { vehicleService }         from '../services/vehicleService.js';
import { routeService }           from '../services/routeService.js';
import { scheduleService }        from '../services/scheduleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { routeFilterState }       from '../services/routeFilterState.js';
import { MapManager }             from '../map/MapManager.js';
import { BusMarkerManager }       from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }     from '../map/LineOverlayManager.js';
import { LastUpdateDisplay }      from '../ui/components/LastUpdateDisplay.js';
import { LoadingSpinner }         from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }         from '../ui/components/RouteFilterBar.js';
import { NextArrivals }           from '../ui/components/NextArrivals.js';
import { FavouritesPanel }        from '../ui/components/FavouritesPanel.js';
import { favouritesManager }      from '../services/FavouritesManager.js';
import { TutorialModal }          from '../ui/components/TutorialModal.js';
import { createCenterControl }    from '../map/controls/CenterControl.js';
import { createStopsControl }     from '../map/controls/StopsControl.js';
import { createLinesControl }     from '../map/controls/LinesControl.js';
import { createTutorialControl }  from '../map/controls/TutorialControl.js';
import { AnnouncementBanner }     from '../ui/components/AnnouncementBanner.js';
import { REALTIME_BUSES_ENABLED } from '../config/featureFlags.js';

export class BusMapApp {
  constructor(options = {}) {
    this.mapElementId    = options.mapElementId    || 'map';
    this.refreshInterval = options.refreshInterval || 5000;

    this.mapManager         = null;
    this.busMarkerManager   = null;
    this.lineOverlayManager = null;
    this.routeFilterBar     = null;
    this.nextArrivals       = null;
    this.favouritesPanel    = null;
    this.tutorialModal      = null;
    this.lastUpdateDisplay  = new LastUpdateDisplay();
    this.centerControl      = null;
    this.stopsControl       = null;
    this.linesControl       = null;
    this.tutorialControl    = null;
    this.loadingOverlay     = null;

    this._selectedRoutes    = new Set();
    this._routeDirMap       = new Map();
    this._allProcessedBuses = [];

    this._arrivalsRefreshInterval = null;
    this._currentStopId           = null;
    this._currentStopName         = null;
    this._currentStopPosition     = null;
    this._currentBusPositions     = [];
    this._busMapCentered          = false;

    // Controlo de fonte de veículos e fallback
    this._vehiclesSource        = 'primary'; // 'primary' (stcp.live) ou 'fallback' (FIWARE via worker)
    this._primaryEmptySince     = null;
    this._fallbackPromptVisible = false;
  }

  async initialize() {
    try {
      // O overlay de loading é criado sobre o elemento #map (posição absoluta),
      // por isso os restantes componentes da página ficam visíveis enquanto o mapa carrega.
      const mapEl = document.getElementById(this.mapElementId);
      this.loadingOverlay = LoadingSpinner.createOverlay(
        'A carregar mapa de autocarros...',
        mapEl  // passa o elemento pai — o overlay fica absoluto sobre ele
      );

      if (!REALTIME_BUSES_ENABLED) {
        AnnouncementBanner.show(
          'Localização dos autocarros temporariamente indisponível. Motivo: Ausência de dados por parte da STCP.',
          { type: 'warning', id: 'rt-unavailable', dismissible: false }
        );
      }
      
      // Aviso temporário — STCP
      AnnouncementBanner.show(
        'Por motivos desconhecidos a linha 200 não está a apresentar dados em tempo real - verifique o horário planeado nas próximas chegadas.',
        { type: 'warning', id: 'stcp-warning', dismissible: false }
      );
      
      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      // Centrar automaticamente na localização do utilizador ao abrir a página.
      // O zoom 16 é suficiente para ver os autocarros nas ruas ao redor.
      // Fazemos isto antes de adicionar os controlos para que a posição inicial
      // já esteja definida quando o utilizador interagir pela primeira vez.
      this._initUserLocation();

      this.centerControl = createCenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition(),
        // Callback para atualizar o marcador com a posição fresca do GPS
        (freshPosition) => this.mapManager.updateUserMarker(freshPosition)
      );
      this.centerControl.addTo(this.mapManager.map);

      this.stopsControl = createStopsControl(this.mapManager.map);
      this.stopsControl.addTo(this.mapManager.map);

      this.linesControl = createLinesControl(this.mapManager.map);
      this.linesControl.addTo(this.mapManager.map);

      this.tutorialControl = createTutorialControl(this.mapManager.map, () => this.tutorialModal?.open());
      this.tutorialControl.addTo(this.mapManager.map);

      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      this.tutorialModal = new TutorialModal({ page: 'busmap' });
      this.tutorialModal.mount();

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data => this._handleArrivalClick(data));
      this.nextArrivals.onClose(()          => this._handleCloseArrivals());
      this.nextArrivals.onRefresh(()        => this._handleRefreshArrivals());
      this.nextArrivals.onFavouriteClick(stopId => this._toggleFavourite(stopId));
      this.nextArrivals.onIsFavourite(stopId => favouritesManager.isFavourite(stopId));
      this.nextArrivals.onFilterChange(selected => this._handleArrivalFilterChange(selected));

      this.lineOverlayManager.onStopClick(stop => this._handleStopClick(stop));

      this.favouritesPanel = new FavouritesPanel();
      this.favouritesPanel.mount();

      this.routeFilterBar = new RouteFilterBar('route-filter-bar');
      this.routeFilterBar.mount();
      this.routeFilterBar.setLoading(true);
      this.routeFilterBar.onFilterChange((selected, routeObjs) =>
        this._handleRouteFilterChange(selected, routeObjs)
      );
      routeService.fetchRoutesList().then(routes => {
        this.routeFilterBar.setRoutes(routes);
      }).catch(() => this.routeFilterBar.setLoading(false));

      this.setupEventListeners();
      this.lastUpdateDisplay.initialize();

      // Garante que o apiService começa em modo primário (stcp.live)
      apiService.setVehiclesSource(this._vehiclesSource);

      if (REALTIME_BUSES_ENABLED) {
        this.loadingOverlay.update('Agora tens uma app mais rápida com localizações mais precisas. Esperemos que gostes!');
        await this.fetchAndUpdateBuses();
        this.startAutoRefresh();
      }

      this.loadingOverlay.remove();
      this.loadingOverlay = null;

      await this._handleDeepLink();

      this.tutorialModal.showIfFirstVisit();

    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
      this.showError('Erro ao inicializar aplicação');
    }
  }

  /**
   * Tenta obter a localização atual do utilizador e centra o mapa nessa posição.
   * zoom 16 = ruas visíveis ao redor do utilizador com autocarros legíveis.
   * Não bloqueia a inicialização — corre em background.
   */
  _initUserLocation() {
    geolocationService.getCurrentPosition()
      .then(position => {
        this.mapManager.updateUserMarker(position);
        this.mapManager.centerOn(position, 16);
      })
      .catch(err => console.warn('⚠️ Localização indisponível:', err.message));
  }

  setupEventListeners() {
    const btn = document.getElementById('refresh-now');
    if (btn) btn.addEventListener('click', () => autoRefreshManager.forceRefresh('bus-map'));
  }

  startAutoRefresh() {
    autoRefreshManager.start('bus-map', () => this.fetchAndUpdateBuses(), this.refreshInterval);
  }

  async _handleDeepLink() {
    const params  = new URLSearchParams(window.location.search);
    const stopId  = params.get('stop');
    const lineNum = params.get('line');
    const dir     = parseInt(params.get('dir') ?? '0', 10);

    if (!stopId && !lineNum) return;

    if (lineNum) {
      await this._waitForRoutes();
      const route = (this.routeFilterBar.routes || []).find(r => String(r.number) === String(lineNum));
      if (route) {
        const direction = isNaN(dir) ? 0 : dir;
        this.routeFilterBar.selected.set(route.number, { route, direction });
        this.routeFilterBar._render();
        await this._handleRouteFilterChange(new Set([route.number]), [{ ...route, direction }]);
      }
    }

    if (stopId) {
      try {
        const stopInfo = await apiService.fetchStopInfo(stopId);
        const stop = {
          stop_id:   stopInfo?.stop_id   || stopId,
          stop_code: stopInfo?.stop_code || stopId,
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

  _waitForRoutes() {
    return new Promise(resolve => {
      if (this.routeFilterBar?.routes?.length > 0) { resolve(); return; }
      const check = setInterval(() => {
        if (this.routeFilterBar?.routes?.length > 0) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
  }

  async fetchAndUpdateBuses() {
    try {
      const rawBusData = await apiService.fetchBusData();
      const source     = apiService.getVehiclesSource();

      // Monitorizar "10s sem qualquer veículo" em modo primário (stcp.live)
      if (source === 'primary') {
        if (Array.isArray(rawBusData) && rawBusData.length > 0) {
          this._primaryEmptySince = null;
        } else {
          const now = Date.now();
          if (!this._primaryEmptySince) {
            this._primaryEmptySince = now;
          } else if (!this._fallbackPromptVisible && now - this._primaryEmptySince > 10_000) {
            this._showFallbackPrompt();
          }
        }
      }

      if (!Array.isArray(rawBusData) || rawBusData.length === 0) {
        this.busMarkerManager.clearAllMarkers();
        this.lastUpdateDisplay.update();
        return;
      }

      const processed = await vehicleService.processBusDataBatch(rawBusData);
      this._allProcessedBuses = processed;

      processed.forEach(bus => {
        this.busMarkerManager.setRouteForMarker(
          bus.id,
          bus.displayLine || bus.line || '',
          bus.direction
        );
      });

      const activeRoutes = routeFilterState.selectedRoutes;
      const toShow = activeRoutes.size > 0
        ? processed.filter(b => activeRoutes.has(String(b.displayLine || b.line || '')))
        : processed;

      this.busMarkerManager.updateBusMarkers(toShow);
      if (activeRoutes.size > 0) {
        this.busMarkerManager.filterByRoutes(activeRoutes, routeFilterState.dirMap);
      }
      this.lastUpdateDisplay.update();
    } catch (error) {
      console.error('❌ Erro ao atualizar autocarros:', error);
      this.showError('Erro ao obter dados dos autocarros');
    }
  }

  async _handleRouteFilterChange(selected, routeObjs) {
    routeFilterState.set(selected, routeObjs);
    this._selectedRoutes = new Set(selected);
    this._routeDirMap    = new Map(routeObjs.map(r => [String(r.number), r.direction ?? 0]));

    if (selected.size === 0) {
      this.lineOverlayManager.clearAll();
      if (REALTIME_BUSES_ENABLED) {
        this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
        this.busMarkerManager.filterByRoutes(new Set());
      }
      if (this.nextArrivals?.isVisible) {
        this.nextArrivals._renderArrivals();
      }
      return;
    }

    if (REALTIME_BUSES_ENABLED) {
      this.busMarkerManager.filterByRoutes(selected, this._routeDirMap);
    }

    if (this.nextArrivals?.isVisible) {
      this.nextArrivals._renderArrivals();
    }

    const routesToFetch = routeObjs.map(r => ({
      routeId:    String(r.id || r.number),
      direction:  r.direction ?? 0,
      color:      r.color      || '#187EC2',
      text_color: r.text_color || '#FFFFFF'
    }));
    const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
    this.lineOverlayManager.setRoutes(overlayData);

    if (REALTIME_BUSES_ENABLED) {
      const visiblePositions = this.busMarkerManager.filterByRoutes(selected, this._routeDirMap);
      if (visiblePositions.length > 0) {
        this._fitToPositions(visiblePositions);
        return;
      }
    }
    if (this.lineOverlayManager.hasActiveLayers()) {
      this.lineOverlayManager.fitBounds();
    }
  }

  _handleArrivalFilterChange(selectedInPanel) {
    const effectiveFilter = selectedInPanel.size > 0
      ? selectedInPanel
      : routeFilterState.selectedRoutes;
    this.busMarkerManager.filterByRoutes(effectiveFilter, routeFilterState.dirMap);
  }

  async _handleStopClick(stop) {
    this._stopArrivalsRefresh();
    this.busMarkerManager.clearAllMarkers();

    this._currentStopId       = stop.stop_id;
    this._currentStopName     = stop.stop_name;
    this._currentStopPosition = [stop.latitude, stop.longitude];
    this._busMapCentered      = false;
    this._currentBusPositions = [];

    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    await this._loadStopArrivals(stop.stop_id, true);
    this._startArrivalsRefresh();
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
      const vehicles = REALTIME_BUSES_ENABLED ? await apiService.fetchBusData() : [];
      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
      if (REALTIME_BUSES_ENABLED) {
        await this._updateArrivalsOnMap(arrivals, vehicles, centerMap);
      }
    } catch (error) {
      console.error('❌ Erro ao carregar chegadas:', error);
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
        arrival.route_id || processedBus.displayLine || processedBus.line || ''
      );
      this.busMarkerManager.setRouteForMarker(processedBus.id, routeNum);
    }

    if (busesToShow.length === 0) return;
    this.busMarkerManager.updateBusMarkers(busesToShow);
    this._currentBusPositions = busPositions;

    const effectiveFilter = this.nextArrivals?.selectedRoutes?.size > 0
      ? this.nextArrivals.selectedRoutes
      : routeFilterState.selectedRoutes;

    let visiblePositions = busPositions;
    if (effectiveFilter.size > 0) {
      visiblePositions = this.busMarkerManager.filterByRoutes(effectiveFilter, routeFilterState.dirMap);
    }

    if (centerMap && !this._busMapCentered && visiblePositions.length > 0) {
      this._busMapCentered = true;
      setTimeout(() => this._recenterOnPositions(visiblePositions), 150);
    } else if (centerMap && !this._busMapCentered && busPositions.length > 0) {
      this._busMapCentered = true;
      setTimeout(() => this._recenterOnPositions(busPositions), 150);
    }
  }

  /**
   * Clique num autocarro nas próximas chegadas — foca no mapa.
   * `location` vem de vehicleService.extractVehicleLocation → { lat, lon }
   */
  _handleArrivalClick(data) {
    const { vehicleId, location } = data;
    if (!location || !this.mapManager) return;
    const lat = location.lat ?? location.latitude;
    const lon = location.lon ?? location.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const offsetY = Math.round(this.mapManager.map.getSize().y * 0.25);
    this.mapManager.centerOnWithOffset([lat, lon], 17, offsetY);
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) marker.openPopup();
  }

  _handleRefreshArrivals() {
    if (this._currentStopId) this._loadStopArrivals(this._currentStopId, false);
  }

  _handleCloseArrivals() {
    this._stopArrivalsRefresh();
    this._currentStopId       = null;
    this._currentStopName     = null;
    this._currentStopPosition = null;
    this._busMapCentered      = false;
    this._currentBusPositions = [];
    this._clearStopFromURL();
    if (REALTIME_BUSES_ENABLED) {
      const activeRoutes = routeFilterState.selectedRoutes;
      if (activeRoutes.size > 0) {
        this.busMarkerManager.filterByRoutes(activeRoutes, routeFilterState.dirMap);
      } else {
        this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
      }
    }
  }

  _toggleFavourite(stopId) {
    if (!stopId) return;
    const name    = this._currentStopName || `Paragem ${stopId}`;
    const lineNum = routeFilterState.selectedRoutes.size === 1
      ? [...routeFilterState.selectedRoutes][0]
      : null;
    const dir   = lineNum ? (routeFilterState.dirMap.get(lineNum) ?? 0) : null;
    const added = favouritesManager.toggle(stopId, name, {
      line:    lineNum,
      dir:     dir,
      baseUrl: window.location.pathname
    });
    this.nextArrivals.refreshFavouriteBtn();
    this.favouritesPanel.refresh();
    if (added) { this.favouritesPanel.open(); setTimeout(() => this.favouritesPanel.close(), 1800); }
  }

  _startArrivalsRefresh() {
    this._stopArrivalsRefresh();
    this._arrivalsRefreshInterval = setInterval(() => {
      if (this._currentStopId) this._loadStopArrivals(this._currentStopId, false);
    }, 5000);
  }

  _stopArrivalsRefresh() {
    if (this._arrivalsRefreshInterval) { clearInterval(this._arrivalsRefreshInterval); this._arrivalsRefreshInterval = null; }
  }

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

  _fitToPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    if (positions.length === 1) { this.mapManager.centerOn(positions[0], 16); return; }
    this.mapManager.fitBounds(positions, { paddingTopLeft: [60, 100], paddingBottomRight: [60, 60], maxZoom: 16, minZoom: 11 });
  }

  _recenterOnPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    const panelHeight = this.mapManager.map.getSize().y * 0.5;
    if (positions.length === 1) { this.mapManager.centerOnWithOffset(positions[0], 16, Math.round(panelHeight * 0.5)); return; }
    this.mapManager.fitBounds(positions, { paddingTopLeft: [60, 60], paddingBottomRight: [60, panelHeight + 60], maxZoom: 16, minZoom: 13 });
  }

  _showFallbackPrompt() {
    this._fallbackPromptVisible = true;

    let modal = document.getElementById('vehicles-fallback-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'vehicles-fallback-modal';
      modal.className = 'fallback-modal-overlay';
      modal.innerHTML = `
        <div class="fallback-modal">
          <h2>Método de localização indisponível</h2>
          <p>O método atual de localização dos autocarros com elevada precisão encontra-se indisponível. Deseja utilizar um método alternativo mas menos preciso?</p>
          <div class="fallback-modal-actions">
            <button id="fallback-btn-wait"  class="btn-secondary">Aguardar</button>
            <button id="fallback-btn-switch" class="btn-primary">Alterar para informação alternativa</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#fallback-btn-wait')?.addEventListener('click', () => {
        this._primaryEmptySince     = Date.now();
        this._fallbackPromptVisible = false;
        modal.remove();
      });

      modal.querySelector('#fallback-btn-switch')?.addEventListener('click', async () => {
        this._vehiclesSource        = 'fallback';
        this._fallbackPromptVisible = false;
        this._primaryEmptySince     = null;
        apiService.setVehiclesSource('fallback');

        modal.remove();

        AnnouncementBanner.show(
          'A mostrar localização dos autocarros com base em informação alternativa, possivelmente menos precisa.',
          { type: 'info', id: 'rt-fallback', dismissible: true }
        );

        await this.fetchAndUpdateBuses();
      });
    } else {
      modal.style.display = 'flex';
    }
  }

  showError(message) {
    console.error('❌', message);
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
    if (this.favouritesPanel)    this.favouritesPanel.destroy();
    if (this.tutorialModal)      this.tutorialModal.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
    routeFilterState.clear();
  }
}

if (typeof window !== 'undefined') {
  const app = new BusMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
