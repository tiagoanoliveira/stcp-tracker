/**
 * StopsMapApp - Aplicação de mapa de paragens
 *
 * Integração MQTT:
 *  - Quando REALTIME_BUSES_ENABLED, o MQTT é iniciado no initialize().
 *  - onVehicleUpdate: actualiza o marcador individual em tempo real.
 *  - onVehicleExpired: remove o marcador do veículo expirado (TTL 30 s).
 *  - loadStopArrivals usa mqttVehicleService.getAllVehicles() em vez de
 *    apiService.fetchBusData(), eliminando o polling HTTP.
 *  - O intervalo de autoRefresh mantém-se para refrescar as chegadas previstas
 *    (plannedArrivalsService), mas a posição dos veículos é sempre em tempo real.
 *
 * DEDUPLICAÇÃO DE MARCADORES:
 *  - vehicleService.processBusData normaliza o id FIWARE ("urn:ngsi-ld:Vehicle:3261"
 *    → "3261") para que coincida com o id MQTT, evitando marcadores duplicados.
 *
 * DIRECÇÃO DO SHAPE (handleArrivalFilterChange):
 *  - Para cada linha filtrada, pede as paragens da direcção 0.
 *  - Se a paragem actual (currentStopId) não estiver nessa lista, usa direcção 1.
 *  - Desta forma o shape desenhado é sempre o que inclui a paragem em causa.
 *
 * BANNER DE SERVIÇO INDISPONÍVEL:
 *  - Se o broker MQTT ligar mas não entregar nenhum veículo em 15 s,
 *    é emitido mqtt:noDataTimeout → mostra AnnouncementBanner.
 *  - Quando o primeiro veículo chegar, mqtt:dataRestored → esconde o banner.
 */

import { geolocationService }    from '../core/geolocationService.js';
import { apiService }             from '../core/apiService.js';
import { stopService }            from '../services/stopService.js';
import { vehicleService }         from '../services/vehicleService.js';
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

    // Flag: indica se o MQTT foi iniciado e está activo
    this._mqttActive = false;

    // ID do banner de no-data para poder escondê-lo depois
    this._noDataBannerId = 'mqtt-no-data';
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

      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this.centerControl = createCenterControl(this.mapManager.map, () => this.mapManager.getUserPosition());
      this.centerControl.addTo(this.mapManager.map);

      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);

      this.linesControl = createLinesControl(this.mapManager.map);
      this.linesControl.addTo(this.mapManager.map);

      this.tutorialControl = createTutorialControl(this.mapManager.map, () => this.tutorialModal?.open());
      this.tutorialControl.addTo(this.mapManager.map);

      this.stopMarkerManager  = new StopMarkerManager(this.mapManager.map);
      this.busMarkerManager   = new BusMarkerManager(this.mapManager.map);
      this.lineOverlayManager = new LineOverlayManager(this.mapManager.map);

      // Tutorial
      this.tutorialModal = new TutorialModal({ page: 'stopsmap' });
      this.tutorialModal.mount();

      this.nextArrivals = new NextArrivals();
      this.nextArrivals.create();
      this.nextArrivals.onArrivalClick(data => this.handleArrivalClick(data));
      this.nextArrivals.onClose(() => this.handleCloseArrivals());
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
        .then(routes => this.routeFilterBar.setRoutes(routes))
        .catch(() => this.routeFilterBar.setLoading(false));

      await this.setupGeolocation();
      this.setupEventListeners();
      this.setupMapListeners();

      // ── Iniciar MQTT ────────────────────────────────────────────────────────
      if (REALTIME_BUSES_ENABLED) {
        this._startMqtt();
      }

      const deepLinkHandled = await this._handleDeepLink();
      if (!deepLinkHandled) await this.loadNearbyStops();

      this.loadingOverlay.remove();
      this.loadingOverlay = null;

      // Mostrar tutorial na primeira visita
      this.tutorialModal.showIfFirstVisit();

    } catch (error) {
      console.error('\u274C Erro na inicializa\u00e7\u00e3o:', error);
      if (this.loadingOverlay) this.loadingOverlay.remove();
      this.showError('Erro ao inicializar aplica\u00e7\u00e3o');
    }
  }

  // ── MQTT ───────────────────────────────────────────────────────────────────

  _startMqtt() {
    // Banner: broker ligado mas sem dados em 15s
    eventBus.on('mqtt:noDataTimeout', () => {
      AnnouncementBanner.show(
        '\u26A0\uFE0F Os dados de localização em tempo real não estão disponíveis de momento. ' +
        'Isto é uma falha no serviço externo — o teu dispositivo e rede estão OK.',
        { type: 'warning', id: this._noDataBannerId, dismissible: true }
      );
    });

    eventBus.on('mqtt:dataRestored', () => {
      AnnouncementBanner.hide(this._noDataBannerId);
    });

    mqttVehicleService.start({
      onVehicleUpdate: (vehicle) => this._handleMqttVehicleUpdate(vehicle),
      onVehicleExpired: (vehicleId) => this._handleMqttVehicleExpired(vehicleId),
      onConnected: () => {
        this._mqttActive = true;
      },
      onDisconnected: () => {
        this._mqttActive = false;
      },
    }).catch(err => {
      console.error('❌ Falha ao iniciar MQTT:', err);
      this._mqttActive = false;
    });
  }

  /**
   * Chamado pelo MQTT para cada actualização de posição de veículo.
   *
   * FIX: os veículos do MQTT chegam em formato bruto { lat, lng, routeId... }.
   * Antes de os passar ao BusMarkerManager (que espera { latitude, longitude... }),
   * é obrigatório chamá-los através de vehicleService.processBusData().
   *
   * Além disso, actualiza sempre o marcador (upsert) em vez de só actualizar
   * os que já existiam — o BusMarkerManager._upsertMarker() garante deduplicação.
   */
  _handleMqttVehicleUpdate(vehicle) {
    if (!this.currentStopId || !this.busMarkerManager) return;

    // Processar o veículo bruto para o formato interno { latitude, longitude... }
    const processed = vehicleService.processBusData(vehicle);
    if (!processed) return;

    // Upsert: criar ou mover o marcador (deduplicação interna no BusMarkerManager)
    this.busMarkerManager.updateSingleBusMarker(processed);

    // Manter lista de posições visíveis actualizada
    const ll = this.busMarkerManager.markers[processed.id]?.getLatLng();
    if (ll) {
      const idx = this.currentBusPositions.findIndex(
        p => p[0] === ll.lat && p[1] === ll.lng
      );
      if (idx === -1) this.currentBusPositions.push([ll.lat, ll.lng]);
    }
  }

  /**
   * Chamado pelo TTL do MQTT quando um veículo expira (sem update há 30 s).
   * Remove o marcador do mapa.
   */
  _handleMqttVehicleExpired(vehicleId) {
    if (!this.busMarkerManager) return;
    if (this.busMarkerManager.markers[vehicleId]) {
      this.busMarkerManager.removeBusMarker(vehicleId);
      // Remover também da lista de posições visíveis
      this.currentBusPositions = this.busMarkerManager
        .getAllPositions()
        .map(ll => [ll.lat, ll.lng]);
    }
  }

  // ── Geolocalização ─────────────────────────────────────────────────────────

  async setupGeolocation() {
    try {
      const position = await geolocationService.getCurrentPosition();
      this.mapManager.updateUserMarker(position);
      this.mapManager.centerOn(position, 15);
    } catch (error) {
      console.warn('\u26A0\uFE0F N\u00e3o foi poss\u00edvel obter localiza\u00e7\u00e3o:', error.message);
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
        if (!this._lineFilterMode) {
          await this.loadNearbyStops();
        }
        await this.handleStopClick(stop);
      } catch (e) {
        console.warn('Deep-link: paragem n\u00e3o encontrada', stopId, e);
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
    this.currentStopName     = stop.stop_name;
    this.currentStopPosition = [stop.latitude, stop.longitude];
    this.busMapCentered      = false;
    this.currentBusPositions = [];

    clearTimeout(this.loadStopsDebounce);
    this.loadStopsDebounce = null;

    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();
    this._setGlobalFilterBarDisabled(true);

    if (!this._lineFilterMode) {
      this.stopMarkerManager.showOnlyMarker(stop.stop_id);
    }
    this.stopMarkerManager.setSelectedStop(stop.stop_id);

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    await this.loadStopArrivals(stop.stop_id, true);
    this.startAutoRefresh();
    this._pushStopToURL(stop.stop_id);
  }

  _pushStopToURL(stopId) {
    const params = new URLSearchParams(window.location.search);
    params.set('stop', stopId);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  async loadStopArrivals(stopId, centerMap = false) {
    try {
      // getNextArrivals devolve sempre um Array simples
      const arrivals = await plannedArrivalsService.getNextArrivals(stopId, 60);

      if (!arrivals || arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.busMarkerManager.clearAllMarkers();
        this.nextArrivals.updateLastUpdate();
        return;
      }

      // Usar snapshot MQTT se disponível; caso contrário, fallback ao HTTP
      const vehicles = REALTIME_BUSES_ENABLED
        ? (this._mqttActive
            ? mqttVehicleService.getAllVehicles()
            : await apiService.fetchBusData())
        : [];

      this.nextArrivals.setArrivals(arrivals, vehicles);
      this.nextArrivals.updateLastUpdate();
      if (REALTIME_BUSES_ENABLED) {
        await this.updateBusMap(arrivals, vehicles, centerMap);
      }
    } catch (error) {
      console.error('\u274C Erro ao carregar chegadas:', error);
      this.nextArrivals.hideLoading();
      this.showError('Erro ao carregar informa\u00e7\u00f5es da paragem');
    }
  }

  async updateBusMap(arrivals, vehicles, centerMap = false) {
    if (!arrivals || arrivals.length === 0) {
      this.busMarkerManager.clearAllMarkers();
      this.currentBusPositions = [];
      return;
    }

    const busesToShow  = [];
    const busPositions = [];

    // Recolher tripIds de chegadas com is_realtime para lookup directo via MQTT
    const realtimeTripIds = arrivals
      .filter(a => a.is_realtime && a.trip_id)
      .map(a => a.trip_id);

    // Mapa tripId → veículo MQTT para lookup O(1)
    const mqttByTripId = new Map(
      mqttVehicleService.getVehiclesByTripIds(realtimeTripIds)
        .map(v => [v.tripId, v])
    );

    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;

      // Tentar primeiro lookup directo por tripId no MQTT (mais fiável)
      let rawVehicle = arrival.trip_id ? mqttByTripId.get(arrival.trip_id) : null;

      // Fallback: procura no array vehicles (HTTP ou MQTT getAllVehicles)
      if (!rawVehicle) {
        rawVehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      }

      if (!rawVehicle) continue;

      const processedBus = vehicleService.processBusData(rawVehicle);
      if (!processedBus) continue;

      busesToShow.push(processedBus);
      busPositions.push([processedBus.latitude, processedBus.longitude]);

      const routeNum = String(
        arrival.route_short_name || arrival.route_number ||
        arrival.route_id || processedBus.displayLine || processedBus.line || ''
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
      setTimeout(() => this._recenterOnPositions(positionsForCenter), 150);
    }
  }

  /**
   * Callback do filtro de linhas no painel de chegadas.
   *
   * FIX — direcção do shape:
   *  Para cada linha seleccionada, determina qual a direcção correcta a desenhar:
   *  1. Pede as paragens da direcção 0 para essa linha.
   *  2. Verifica se a paragem actual (currentStopId) está na lista.
   *  3. Se não estiver → usa direcção 1 (que é onde a paragem deve estar).
   *  Desta forma o shape desenhado inclui sempre a paragem em causa.
   */
  async handleArrivalFilterChange(selectedRoutes) {
    const effectiveFilter = selectedRoutes.size > 0
      ? selectedRoutes
      : routeFilterState.selectedRoutes;

    const visiblePositions = this.busMarkerManager.filterByRoutes(
      effectiveFilter, routeFilterState.dirMap
    );

    if (selectedRoutes.size === 0 && !routeFilterState.hasActive()) {
      this.lineOverlayManager.clearAll();
    } else {
      const sourceRoutes = selectedRoutes.size > 0 ? selectedRoutes : routeFilterState.selectedRoutes;
      const availableRoutes = this.nextArrivals?.availableRoutes || [];

      // Determinar a direcção correcta para cada linha verificando se a
      // paragem actual existe nas paragens da direcção 0.
      const routeObjsPromises = availableRoutes
        .filter(r => sourceRoutes.has(r.number))
        .map(async r => {
          const routeId = String(r.id || r.number);
          let direction = 0;

          if (this.currentStopId) {
            try {
              const stopsDir0 = await routeService.fetchRouteStops(routeId, 0);
              const stopIds0  = (stopsDir0?.stops || []).map(s => String(s.stop_id));
              if (!stopIds0.includes(String(this.currentStopId))) {
                direction = 1;
              }
            } catch {
              // em caso de erro mantém direcção 0
            }
          }

          return {
            routeId,
            direction,
            color:      r.color      || '#187EC2',
            text_color: r.text_color || '#FFFFFF'
          };
        });

      const routeObjs = await Promise.all(routeObjsPromises);

      if (routeObjs.length > 0) {
        const overlayData = await routeService.fetchMultipleRoutesOverlay(routeObjs);
        this.lineOverlayManager.setRoutes(overlayData);
      }
    }
    if (visiblePositions.length > 0) { this._recenterOnPositions(visiblePositions); }
    else if (this.lineOverlayManager.hasActiveLayers()) { this.lineOverlayManager.fitBounds({ panelHeightRatio: 0.5 }); }
  }

  recenterOnBuses() { this._recenterOnPositions(this.currentBusPositions); }

  _recenterOnPositions(positions) {
    if (!this.mapManager || positions.length === 0) return;
    const panelHeight = this.mapManager.map.getSize().y * 0.5;
    if (positions.length === 1) { this.mapManager.centerOnWithOffset(positions[0], 16, Math.round(panelHeight * 0.5)); return; }
    this.mapManager.fitBounds(positions, { paddingTopLeft: [60, 60], paddingBottomRight: [60, panelHeight + 60], maxZoom: 16, minZoom: 13 });
  }

  handleArrivalClick(data) {
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
    if (this.favouritesPanel)    this.favouritesPanel.destroy();
    if (this.tutorialModal)      this.tutorialModal.destroy();
    if (this.mapManager)         this.mapManager.cleanup();
    if (REALTIME_BUSES_ENABLED)  mqttVehicleService.stop();
    eventBus.off('mqtt:noDataTimeout');
    eventBus.off('mqtt:dataRestored');
    routeFilterState.clear();
  }
}

if (typeof window !== 'undefined') {
  const app = new StopsMapApp();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.initialize());
  else app.initialize();
  window.addEventListener('beforeunload', () => app.cleanup());
}
