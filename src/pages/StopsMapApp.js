/**
 * StopsMapApp - Aplicação de mapa de paragens
 *
 * Integração MQTT:
 *  - Quando REALTIME_BUSES_ENABLED, o MQTT é iniciado no initialize().
 *  - onVehicleUpdate recebe veículos JÁ PROCESSADOS (formato { latitude,
 *    longitude, line, displayLine, direction, tripId, ... }) porque
 *    mqttVehicleService.start() chama vehicleService.processBusData()
 *    internamente antes de chamar o callback.
 *  - Não chamar processBusData() uma segunda vez sobre estes objectos.
 *
 * FILTRO DE MARCADORES MQTT (_allowedTripIds):
 *  - updateBusMap() preenche this._allowedTripIds com os tripIds das
 *    chegadas em tempo real da paragem activa.
 *  - _handleMqttVehicleUpdate() só desenha o marcador se o tripId do
 *    veículo estiver em _allowedTripIds. Isto impede que autocarros de
 *    outras paragens sejam desenhados conforme os updates MQTT chegam.
 *  - Quando o painel fecha (handleCloseArrivals), _allowedTripIds é limpo.
 *
 * VIEWPORT / RECENTRAMENTO:
 *  - Ao clicar numa paragem (handleStopClick), o mapa centra-se
 *    imediatamente na localização da paragem (zoom 16), independentemente
 *    de já existirem autocarros ou não.
 *  - Quando os autocarros chegam (updateBusMap com centerMap=true),
 *    o mapa recentra sobre eles.
 *  - Ao clicar numa chegada específica no painel, handleArrivalClick()
 *    centra em zoom 17 com offset de 35% da altura para que o marcador
 *    fique bem acima do painel.
 *  - _recenterOnPositions() usa paddingBottomRight com 60% da altura do
 *    painel + 100px extra para que os marcadores não fiquem tapados.
 *
 * BOTÃO DE REFRESH:
 *  - handleRefreshArrivals() passa forceRefresh=true para que o cache
 *    seja ignorado e os dados sejam sempre buscados à rede.
 *  - O intervalo de 5 s também passa forceRefresh=true pelo mesmo motivo.
 *
 * DIRECÇÃO DO SHAPE (handleArrivalFilterChange):
 *  - Para cada linha filtrada, pede as paragens da direcção 0.
 *  - Se a paragem actual (currentStopId) não estiver nessa lista, usa direcção 1.
 *
 * BANNER DE SERVIÇO INDISPONÍVEL:
 *  - mqtt:noDataTimeout (15 s sem dados) → mostra AnnouncementBanner.
 *  - mqtt:dataRestored → esconde o banner.
 */

import { geolocationService }    from '../core/geolocationService.js';
import { apiService }             from '../core/apiService.js';
import { stopService }            from '../services/stopService.js';
import {normalizeDestinationText, vehicleService} from '../services/vehicleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { scheduleService }        from '../services/scheduleService.js';
import { routeService }           from '../services/routeService.js';
import { routeFilterState }       from '../services/routeFilterState.js';
import { mqttVehicleService }     from '../services/mqttVehicleService.js';
import { eventBus }               from '../core/eventBus.js';
import { MapManager }             from '../map/MapManager.js';
import { StopMarkerManager }      from '../map/markers/StopMarkerManager.js';
import { BusMarkerManager }       from '../map/markers/BusMarkerManager.js';
import { LineOverlayManager }     from '../map/LineOverlayManager.js';
import { createCenterControl }    from '../map/controls/CenterControl.js';
import { createBusMapControl }    from '../map/controls/BusMapControl.js';
import { createLinesControl }     from '../map/controls/LinesControl.js';
import { createTutorialControl }  from '../map/controls/TutorialControl.js';
import { NextArrivals }           from '../ui/components/NextArrivals.js';
import { LoadingSpinner }         from '../ui/components/LoadingSpinner.js';
import { RouteFilterBar }         from '../ui/components/RouteFilterBar.js';
import { FavouritesPanel }        from '../ui/components/FavouritesPanel.js';
import { TutorialModal }          from '../ui/components/TutorialModal.js';
import { favouritesManager }      from '../services/FavouritesManager.js';
import { iconCache }              from '../ui/design/iconCache.js';
import { AnnouncementBanner }     from '../ui/components/AnnouncementBanner.js';
import { REALTIME_BUSES_ENABLED } from '../config/featureFlags.js';

// ─── Helpers de debug ──────────────────────────────────────────────────────────
// Activar com: localStorage.setItem('BUS_DEBUG', '1') e recarregar.
// Desactivar:  localStorage.removeItem('BUS_DEBUG')
const _busDebug = () => { try { return localStorage.getItem('BUS_DEBUG') === '1'; } catch { return false; } };
const _log  = (...a) => { if (_busDebug()) console.log  ('%c[BUS DEBUG]', 'color:#01696f;font-weight:bold', ...a); };
const _warn = (...a) => { if (_busDebug()) console.warn ('%c[BUS DEBUG]', 'color:#964219;font-weight:bold', ...a); };

export class StopsMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.mapManager          = null;
    this.stopMarkerManager   = null;
    this.busMarkerManager    = null;
    this.lineOverlayManager  = null;
    this.routeFilterBar      = null;
    this.favouritesPanel     = null;
    this.tutorialModal       = null;
    this.centerControl       = null;
    this.busMapControl       = null;
    this.linesControl        = null;
    this.tutorialControl     = null;
    this.nextArrivals        = null;
    this.loadingOverlay      = null;

    this.currentStopId       = null;
    this.currentStopName     = null;
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

    this._globalSelectedRoutes    = new Set();
    this._globalSelectedRouteObjs = [];
    this._lineFilterMode          = false;

    this._mqttActive     = false;
    this._noDataBannerId = 'mqtt-no-data';

    /**
     * Set de tripIds das chegadas em tempo real da paragem activa.
     * Preenchido por updateBusMap(); limpo ao fechar o painel.
     */
    this._allowedTripIds = new Set();
  }

  async initialize() {
    try {
      this.loadingOverlay = LoadingSpinner.createOverlay('Que alterações gostarias de ver? Clica <a href="https://tiagoanoliveira.pt/support/a260e7bee11b401b9fd09290e8a8d6d9">aqui</a> ou no link do rodapé e envia as tuas sugestões!');

      if (!REALTIME_BUSES_ENABLED) {
        AnnouncementBanner.show(
          'Localização dos autocarros temporariamente indisponível. Motivo: Ausência de dados por parte da STCP.',
          { type: 'warning', id: 'rt-unavailable', dismissible: false }
        );
      }
      
      // Aviso temporário — STCP
      AnnouncementBanner.show(
        'Estamos a fazer alterações com o objetivo de te trazer mais informação e mais exata. Por essa razão poderás detetar falhas no acesso à informação. Pedimos desculpa pelo incomodo, seremos breves. Hora estimada de conclusão dos trabalhos: 22:00',
        { type: 'info', id: 'stcp-warning', dismissible: false }
      );
     
      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);

      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      this.tutorialControl = createTutorialControl(this.mapManager.map, () => this.tutorialModal?.open());
      this.tutorialControl.addTo(this.mapManager.map);

      this.stopMarkerManager  = new StopMarkerManager(this.mapManager.map);
      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      this.tutorialModal = new TutorialModal({ page: 'stopsmap' });
      this.tutorialModal.mount();

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
      // IMPORTANTE: devolve a Promise para que o botão aguarde o fim antes
      // de remover a animação de rotação (classe 'refreshing')
      this.nextArrivals.onRefresh(() => this.handleRefreshArrivals());
      this.nextArrivals.onFilterChange(selected => this.handleArrivalFilterChange(selected));
      this.nextArrivals.onFavouriteClick(stopId => this._toggleFavourite(stopId));
      this.nextArrivals.onIsFavourite(stopId => favouritesManager.isFavourite(stopId));

      this.lineOverlayManager.onStopClick(stop => this.handleStopClick(stop));

      this.favouritesPanel = new FavouritesPanel();
      this.favouritesPanel.mount();

      this.routeFilterBar = new RouteFilterBar('route-filter-bar');
      this.routeFilterBar.mount();
      this.routeFilterBar.setLoading(true);
      this.routeFilterBar.onFilterChange((selected, routeObjs) =>
        this._handleGlobalRouteFilterChange(selected, routeObjs)
      );

      routeService.fetchRoutesList()
        .then(routes => {
          this.routeFilterBar.setRoutes(routes);
          iconCache.registerRouteColors(routes);
        })
        .catch(() => this.routeFilterBar.setLoading(false));

      await this.setupGeolocation();
      this.setupEventListeners();
      this.setupMapListeners();

      if (REALTIME_BUSES_ENABLED) {
        this._startMqtt();
      }

      const deepLinkHandled = await this._handleDeepLink();
      if (!deepLinkHandled) await this.loadNearbyStops();

      this.loadingOverlay.remove();
      this.loadingOverlay = null;

      this.tutorialModal.showIfFirstVisit();

    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
      this.showError('Erro ao inicializar aplicação');
    }
  }

  // ── MQTT ──────────────────────────────────────────────────────────────────────

  _startMqtt() {
    eventBus.on('mqtt:noDataTimeout', () => {
      AnnouncementBanner.show(
        '⚠️ Os dados de localização em tempo real não estão disponíveis de momento. ' +
        'Isto é uma falha no serviço externo — o teu dispositivo e rede estão OK.',
        { type: 'warning', id: this._noDataBannerId, dismissible: true }
      );
    });

    eventBus.on('mqtt:dataRestored', () => {
      AnnouncementBanner.hide(this._noDataBannerId);
    });

    mqttVehicleService.start({
      onVehicleUpdate:  (vehicle)   => this._handleMqttVehicleUpdate(vehicle),
      onVehicleExpired: (vehicleId) => this._handleMqttVehicleExpired(vehicleId),
      onConnected:      ()          => { this._mqttActive = true; },
      onDisconnected:   ()          => { this._mqttActive = false; },
    }).catch(err => {
      console.error('❌ Falha ao iniciar MQTT:', err);
      this._mqttActive = false;
    });
  }

  _handleMqttVehicleUpdate(vehicle) {
    if (!this.currentStopId) return;
    if (!this.busMarkerManager) return;

    const activeFilter = routeFilterState.selectedRoutes;
    const vehicleLine  = String(vehicle.displayLine || vehicle.line || '');

    if (activeFilter.size > 0) {
      // Com filtro de linha activo: mostrar sempre os veículos dessa linha/direcção
      if (!activeFilter.has(vehicleLine)) return;
      const activeDirMap = routeFilterState.dirMap;
      if (activeDirMap.has(vehicleLine) && vehicle.direction !== activeDirMap.get(vehicleLine)) return;
    } else if (this._allowedTripIds.size > 0) {
      // Sem filtro: manter restrição às chegadas previstas para esta paragem
      if (!vehicle.tripId || !this._allowedTripIds.has(vehicle.tripId)) {
        return;
      }
    }

    _log(
        `onVehicleUpdate PERMITIDO id:${vehicle.id} linha:${vehicle.displayLine}`,
        `tripId:${vehicle.tripId} lat:${vehicle.latitude?.toFixed(5)} lng:${vehicle.longitude?.toFixed(5)}`,
        `marcadores actuais: ${this.busMarkerManager.getMarkerCount()}`
    );

    this.busMarkerManager.updateSingleBusMarker(vehicle);

    _log(`→ marcadores após upsert: ${this.busMarkerManager.getMarkerCount()}`);
  }

  _handleMqttVehicleExpired(vehicleId) {
    if (!this.busMarkerManager) return;
    if (this.busMarkerManager.markers[vehicleId]) {
      _log(`TTL expirado: remover marcador id:${vehicleId}`);
      this.busMarkerManager.removeBusMarker(vehicleId);
      this.currentBusPositions = this.busMarkerManager
        .getAllPositions()
        .map(ll => [ll.lat, ll.lng]);
    }
  }

  // ── Geolocalização ────────────────────────────────────────────────────────────

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
      console.error('❌ Erro ao carregar paragens:', error);
    } finally {
      this.isLoadingStops = false;
    }
  }

  async _handleDeepLink() {
    const params  = new URLSearchParams(window.location.search);
    const stopId  = params.get('stop');
    const lineNum = params.get('line');
    const dir     = parseInt(params.get('dir') ?? '0', 10);
    if (!stopId && !lineNum) return false;

    if (lineNum && this.routeFilterBar) {
      await this._waitForRoutes();
      const route = (this.routeFilterBar.routes || []).find(r => String(r.number) === String(lineNum));
      if (route) {
        const direction = isNaN(dir) ? 0 : dir;
        this.routeFilterBar.selected.set(route.number, { route, direction });
        this.routeFilterBar._render();
        await this._handleGlobalRouteFilterChange(new Set([route.number]), [{ ...route, direction }]);
      }
    }

    if (stopId) {
      try {
        const stopInfo = await apiService.fetchStopInfo(stopId);
        const stop = {
          stop_id:   stopInfo?.stop_id   || stopId,
          stop_name: stopInfo?.stop_name || `Paragem ${stopId}`,
          latitude:  stopInfo?.latitude  || 41.1579,
          longitude: stopInfo?.longitude || -8.6291,
          routes:    stopInfo?.routes    || []
        };
        this.mapManager.centerOn([stop.latitude, stop.longitude], 16);
        if (!this._lineFilterMode) await this.loadNearbyStops();
        await this.handleStopClick(stop);
      } catch (e) {
        console.warn('Deep-link: paragem não encontrada', stopId, e);
      }
    }
    return true;
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

  async _handleGlobalRouteFilterChange(selected, routeObjs) {
    routeFilterState.set(selected, routeObjs);
    this._globalSelectedRoutes    = new Set(selected);
    this._globalSelectedRouteObjs = routeObjs;

    if (selected.size === 0) {
      this._lineFilterMode = false;
      this.lineOverlayManager.clearAll();
      this.stopMarkerManager.clearAllMarkers();
      this._setGlobalFilterBarDisabled(false);
      if (this.nextArrivals?.isVisible) {
        this.nextArrivals._renderArrivals();
        this.busMarkerManager.filterByRoutes(new Set());
      } else {
        await this.loadNearbyStops();
      }
      return;
    }

    this._lineFilterMode = true;
    const routesToFetch = routeObjs.map(r => ({
      routeId:    String(r.id || r.number),
      direction:  r.direction ?? 0,
      color:      r.color      || '#187EC2',
      text_color: r.text_color || '#FFFFFF'
    }));
    const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
    this.lineOverlayManager.setRoutes(overlayData);

    if (this.nextArrivals?.isVisible) {
      this.nextArrivals._renderArrivals();
      this.busMarkerManager.filterByRoutes(selected, routeFilterState.dirMap);
      return;
    }

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
    el.dataset.disabled = disabled ? 'true' : 'false';
    el.title            = disabled ? 'Feche o painel de chegadas para usar o filtro de linhas' : '';
  }

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
    if (results.length === 1) { this.mapManager.centerOn([results[0].latitude, results[0].longitude], 16); }
    else { this.mapManager.fitBounds(results.map(s => [s.latitude, s.longitude])); }
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

  async handleStopClick(stop) {
    this.stopAutoRefresh();
    this.busMarkerManager.clearAllMarkers();

    this.currentStopId       = stop.stop_id;
    this.currentStopName = normalizeDestinationText(stop.stop_name)
    this.currentStopPosition = [stop.latitude, stop.longitude];
    this.busMapCentered      = false;
    this.currentBusPositions = [];

    this._allowedTripIds.clear();
    this._restrictToAllowedTrips = false;

    clearTimeout(this.loadStopsDebounce);
    this.loadStopsDebounce = null;

    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();
    this._setGlobalFilterBarDisabled(true);

    if (!this._lineFilterMode) {
      this.stopMarkerManager.showOnlyMarker(stop.stop_id);
    }
    this.stopMarkerManager.setSelectedStop(stop.stop_id);

    this.suppressMapChangeUntil = Date.now() + 2000;
    this.mapManager.centerOn([stop.latitude, stop.longitude], 16);

    // Limpar cache da paragem para garantir fetch fresco na primeira abertura
    plannedArrivalsService.clearCache(stop.stop_id);

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    // Primeiro load: forceRefresh=true para garantir dados frescos
    await this.loadStopArrivals(stop.stop_id, true, true);
    this.startAutoRefresh();
    this._pushStopToURL(stop.stop_id);
  }

  _pushStopToURL(stopId) {
    const params = new URLSearchParams(window.location.search);
    params.set('stop', stopId);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  /**
   * Carrega chegadas para a paragem activa.
   *
   * @param {string}  stopId       - ID da paragem
   * @param {boolean} centerMap    - recentrar o mapa nos autocarros (só 1.º load)
   * @param {boolean} forceRefresh - ignorar cache e forçar fetch à rede
   */
  async loadStopArrivals(stopId, centerMap = false, forceRefresh = false) {
    try {
      // forceRefresh=true: botão de refresh e intervalo de 5 s
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60, forceRefresh);

      if (!arrivals || arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.busMarkerManager.clearAllMarkers();
        this.nextArrivals.updateLastUpdate();
        this._allowedTripIds.clear();
        this._restrictToAllowedTrips = false;
        return;
      }

      let vehicles = [];
      if (REALTIME_BUSES_ENABLED) {
        if (this._mqttActive && mqttVehicleService.hasData()) {
          vehicles = mqttVehicleService.getAllVehicles();
          _log(`loadStopArrivals: usando MQTT — ${vehicles.length} veículos em memória`);
        } else {
          _log('loadStopArrivals: MQTT sem dados ainda — fallback HTTP');
          const raw = await apiService.fetchBusData();
          vehicles = vehicleService.processBusDataBatch(raw);
          _log(`loadStopArrivals: HTTP devolveu ${vehicles.length} veículos processados`);
        }
      }

      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();

      if (REALTIME_BUSES_ENABLED) {
        await this.updateBusMap(arrivals, vehicles, centerMap);
      }
    } catch (error) {
      console.error('❌ Erro ao carregar chegadas:', error);
      this.nextArrivals.hideLoading();
      this.showError('Erro ao carregar informações da paragem');
    }
  }

  async updateBusMap(arrivals, vehicles, centerMap = false) {
    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      this.currentBusPositions = [];
      this._allowedTripIds.clear();
      return;
    }

    _log(`updateBusMap: ${arrivals.length} chegadas, ${vehicles.length} veículos disponíveis`);

    const busesToShow  = [];
    const busPositions = [];

    const vehiclesByTripId = new Map();
    for (const v of vehicles) {
      if (v.tripId) vehiclesByTripId.set(v.tripId, v);
    }

    const realtimeTripIds = arrivals
      .filter(a => a.is_realtime && a.trip_id)
      .map(a => a.trip_id);
    const mqttDirect = REALTIME_BUSES_ENABLED
      ? mqttVehicleService.getVehiclesByTripIds(realtimeTripIds)
      : [];
    const mqttByTripId = new Map(mqttDirect.map(v => [v.tripId, v]));

    _log(`updateBusMap: ${realtimeTripIds.length} chegadas RT, ${mqttDirect.length} veículos MQTT por tripId`);

    let matched = 0, notFound = 0;
    const newAllowedTripIds = new Set();

    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;

      const arrTripId = arrival.trip_id;
      _log(`  chegada linha:${arrival.route_short_name || arrival.route_id} tripId:${arrTripId} is_realtime:true`);

      if (arrTripId) newAllowedTripIds.add(arrTripId);

      let processedBus = arrTripId ? mqttByTripId.get(arrTripId) : null;

      if (!processedBus && arrTripId) {
        processedBus = vehiclesByTripId.get(arrTripId);
        if (processedBus) _log(`    → match por tripId exacto`);
      }

      if (!processedBus) {
        const matched3 = vehicleService.matchVehicleToTrip(vehicles, arrTripId);
        if (matched3) {
          processedBus = matched3;
          if (matched3.tripId) newAllowedTripIds.add(matched3.tripId);
          _log(`    → match por matchVehicleToTrip (fuzzy)`);
        }
      }
      if (!processedBus) {
        _warn(`    → sem veículo para tripId:${arrTripId} linha:${arrival.route_short_name || arrival.route_id}`);
        notFound++;
        continue;
      }

      matched++;
      _log(`    → veículo encontrado id:${processedBus.id} lat:${processedBus.latitude?.toFixed(5)} lng:${processedBus.longitude?.toFixed(5)}`);

      // Passar o atraso da chegada para o veículo (evita recalcular no popup)
      processedBus._delaySec = arrival.delay ?? null;

      busesToShow.push(processedBus);
      busPositions.push([processedBus.latitude, processedBus.longitude]);

      const routeNum = String(
        arrival.route_short_name || arrival.route_number ||
        arrival.route_id || processedBus.displayLine || processedBus.line || ''
      );
      this.busMarkerManager.setRouteForMarker(processedBus.id, routeNum);
    }

    _log(`updateBusMap: ${matched} matched, ${notFound} sem veículo`);

    this._allowedTripIds = newAllowedTripIds;
    _log(`updateBusMap: _allowedTripIds actualizado com ${newAllowedTripIds.size} tripId(s):`, [...newAllowedTripIds]);

    if (busesToShow.length === 0) {
      _warn('updateBusMap: nenhum veículo para mostrar — marcadores limpos');
      this.busMarkerManager.clearAllMarkers();
      this.currentBusPositions = [];
      this._restrictToAllowedTrips = true;
      return;
    }

    _log(`updateBusMap: a chamar updateBusMarkers com ${busesToShow.length} veículo(s)`);
    this._restrictToAllowedTrips = true;
    this.busMarkerManager.updateBusMarkers(busesToShow);
    this.currentBusPositions = busPositions;

    const panelFilter  = this.nextArrivals?.selectedRoutes;
    const activeFilter = (panelFilter?.size > 0)
      ? panelFilter
      : (routeFilterState.hasActive() ? routeFilterState.selectedRoutes : null);

    let visiblePositions = busPositions;
    if (activeFilter) {
      visiblePositions = this.busMarkerManager.filterByRoutes(activeFilter, routeFilterState.dirMap);
    }

    if (centerMap && !this.busMapCentered) {
      this.busMapCentered = true;
      const positionsForCenter = visiblePositions.length > 0 ? visiblePositions : busPositions;
      _log(`updateBusMap: recentrar mapa em ${positionsForCenter.length} posição(ões)`);
      setTimeout(() => this._recenterOnPositions(positionsForCenter), 150);
    }
  }

  async handleArrivalFilterChange(selectedRoutes) {
    const effectiveFilter = selectedRoutes.size > 0
        ? selectedRoutes
        : routeFilterState.selectedRoutes;

    const availableRoutes = this.nextArrivals?.availableRoutes || [];
    const resolvedDirMap  = new Map();

    if (this.currentStopId && effectiveFilter.size > 0) {
      await Promise.all(Array.from(effectiveFilter).map(async routeNum => {
        const r       = availableRoutes.find(rt => String(rt.number) === String(routeNum));
        const routeId = String(r?.id || routeNum);
        let direction = 0;
        try {
          const stopsDir0 = await routeService.fetchRouteStops(routeId, 0);
          const stopIds0  = (stopsDir0?.stops || []).map(s => String(s.stop_id));
          if (!stopIds0.includes(String(this.currentStopId))) direction = 1;
          _log(`handleArrivalFilterChange linha:${routeId} paragem:${this.currentStopId} dir0 tem ${stopIds0.length} paragens → usar dir:${direction}`);
        } catch (e) {
          _warn(`handleArrivalFilterChange: erro ao obter paragens dir0 para linha ${routeId}`, e);
        }
        resolvedDirMap.set(String(routeNum), direction);
      }));
    }

    // Actualizar o estado global com as direcções correctas.
    routeFilterState.updateDirections(resolvedDirMap);

    const visiblePositions = this.busMarkerManager.filterByRoutes(effectiveFilter, resolvedDirMap);

    if (selectedRoutes.size === 0 && !routeFilterState.hasActive()) {
      this.lineOverlayManager.clearAll();
    } else {
      const sourceRoutes = selectedRoutes.size > 0 ? selectedRoutes : routeFilterState.selectedRoutes;
      const routeObjs = availableRoutes
          .filter(r => sourceRoutes.has(String(r.number)))
          .map(r => ({
            routeId:    String(r.id || r.number),
            direction:  resolvedDirMap.get(String(r.number)) ?? 0,
            color:      r.color      || '#187EC2',
            text_color: r.text_color || '#FFFFFF'
          }));

      if (routeObjs.length > 0) {
        const overlayData = await routeService.fetchMultipleRoutesOverlay(routeObjs);
        this.lineOverlayManager.setRoutes(overlayData);
      }
    }
    if (visiblePositions.length > 0) { this._recenterOnPositions(visiblePositions); }
    else if (this.lineOverlayManager.hasActiveLayers()) { this.lineOverlayManager.fitBounds({ panelHeightRatio: 0.5 }); }
  }

  recenterOnBuses() { this._recenterOnPositions(this.currentBusPositions); }

  /**
   * Recentra o mapa sobre um conjunto de posições, deixando o marcador
   * visível acima do painel inferior.
   *
   * Bug 1 FIX: quando há apenas 1 posição, o offset anterior era +panelH
   * (60% da altura), deslocando o centro para baixo e empurrando o marcador
   * para cima do viewport. Corrigido para +panelH/2, que posiciona o ponto
   * no centro da área visível acima do painel.
   */
  _recenterOnPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    const mapH   = this.mapManager.map.getSize().y;
    const panelH = Math.round(mapH * 0.6);

    if (positions.length === 1) {
      // Offset positivo = desloca o ponto de referência para baixo no ecrã,
      // o que faz o marcador aparecer mais acima (centrado na zona visível).
      // Usar metade da altura do painel para ficar centrado na área livre.
      this.mapManager.centerOnWithOffset(positions[0], 17, Math.round(panelH / 2));
      return;
    }

    this.mapManager.fitBounds(positions, {
      paddingTopLeft:     [80, 30],
      paddingBottomRight: [30, panelH + 10],
      maxZoom: 18,
      minZoom: 14,
    });
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;
    if (!location || !this.mapManager) return;
    const lat = location.lat ?? location.latitude;
    const lon = location.lon ?? location.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      _warn(`handleArrivalClick: coordenadas inválidas para vehicleId:${vehicleId}`, location);
      return;
    }
    _log(`handleArrivalClick: centrar em [${lat.toFixed(5)}, ${lon.toFixed(5)}] zoom 17 vehicleId:${vehicleId}`);
    const offsetY = Math.round(this.mapManager.map.getSize().y * 0.20);
    this.mapManager.centerOnWithOffset([lat, lon], 18, offsetY);
    const marker = this.busMarkerManager.markers[vehicleId];
    if (marker) marker.openPopup();
  }

  /**
   * Chamado pelo botão de refresh no painel.
   * Passa forceRefresh=true para ignorar o cache e buscar dados frescos.
   * Devolve a Promise para que o listener do botão aguarde o fim antes
   * de remover a animação de rotação.
   */
  handleRefreshArrivals() {
    if (!this.currentStopId) return Promise.resolve();
    return this.loadStopArrivals(this.currentStopId, false, true);
  }

  handleCloseArrivals() {
    this.stopAutoRefresh();
    this.busMarkerManager.clearAllMarkers();
    this.lineOverlayManager.clearAll();
    this.busMapCentered      = false;
    this.currentBusPositions = [];
    this._allowedTripIds.clear();
    this._restrictToAllowedTrips = false;

    const wasSearchActive = this.isSearchActive;
    const returnPosition  = this.currentStopPosition;
    this.currentStopId       = null;
    this.currentStopName     = null;
    this.currentStopPosition = null;
    this._setGlobalFilterBarDisabled(false);
    this.stopMarkerManager.setSelectedStop(null);

    const params = new URLSearchParams(window.location.search);
    params.delete('stop');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));

    if (returnPosition) { this.suppressMapChangeUntil = Date.now() + 1800; this.mapManager.centerOn(returnPosition, 16); }
    if (wasSearchActive) { this._clearSearch(false, 700); }
    else if (this._lineFilterMode && routeFilterState.hasActive()) {
      this._handleGlobalRouteFilterChange(
        routeFilterState.selectedRoutes,
        routeFilterState.selectedRouteObjs
      );
    } else { this.stopMarkerManager.showAllMarkers(); }
  }

  _toggleFavourite(stopId) {
    if (!stopId) return;
    const name    = this.currentStopName || `Paragem ${stopId}`;
    const lineNum = routeFilterState.selectedRoutes.size === 1
      ? [...routeFilterState.selectedRoutes][0]
      : null;
    const dir = lineNum ? (routeFilterState.dirMap.get(lineNum) ?? 0) : null;
    const added = favouritesManager.toggle(stopId, name, {
      line:    lineNum,
      dir:     dir,
      baseUrl: window.location.pathname
    });
    this.nextArrivals.refreshFavouriteBtn();
    this.favouritesPanel.refresh();
    if (added) { this.favouritesPanel.open(); setTimeout(() => this.favouritesPanel.close(), 1800); }
  }

  /**
   * Inicia o intervalo de refresh automático a cada 5 s.
   * Passa forceRefresh=true para garantir que o cache é ignorado.
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      if (this.currentStopId) this.loadStopArrivals(this.currentStopId, false, true);
    }, 5000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  showError(message) {
    console.error('❌', message);
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
    if (this.favouritesPanel)    this.favouritesPanel.destroy();
    if (this.tutorialModal)      this.tutorialModal.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
    if (REALTIME_BUSES_ENABLED)  mqttVehicleService.stop();
    eventBus.off('mqtt:noDataTimeout');
    eventBus.off('mqtt:dataRestored');
    routeFilterState.clear();
    this._allowedTripIds.clear();
  }
}

if (typeof window !== 'undefined') {
  const app = new StopsMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
