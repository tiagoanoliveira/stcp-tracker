/**
 * BusMapApp - Mapa de autocarros em tempo real
 */

import { apiService }             from '../core/apiService.js';
import { geolocationService }     from '../core/geolocationService.js';
import { autoRefreshManager }     from '../core/autoRefreshManager.js';
import { eventBus }               from '../core/eventBus.js';
import { vehicleService }         from '../services/vehicleService.js';
import { routeService }           from '../services/routeService.js';
import { scheduleService }        from '../services/scheduleService.js';
import { plannedArrivalsService } from '../services/plannedArrivalsService.js';
import { routeFilterState }       from '../services/routeFilterState.js';
import { mqttVehicleService }     from '../services/mqttVehicleService.js';
import { iconCache }              from '../ui/design/iconCache.js';
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

    this._routeDirMap       = new Map();
    this._allProcessedBuses = [];

    this._arrivalsRefreshInterval = null;
    this._currentStopId           = null;
    this._currentStopPosition     = null;
    this._busMapCentered          = false;

    // ID do veículo actualmente seguido (selecionado via clique numa chegada)
    this._trackedVehicleId = null;

    // Controlo de fonte de veículos e fallback
    this._primaryEmptySince     = null;
    this._fallbackPromptVisible = false;
  }

  async initialize() {
    try {
      const mapEl = document.getElementById(this.mapElementId);
      this.loadingOverlay = LoadingSpinner.createOverlay(
        'A carregar mapa de autocarros...',
        mapEl
      );

      if (!REALTIME_BUSES_ENABLED) {
        AnnouncementBanner.show(
          'Localização dos autocarros temporariamente indisponível. Motivo: Ausência de dados por parte da STCP.',
          { type: 'warning', id: 'rt-unavailable', dismissible: false }
        );
      }
      
      // Aviso temporário — STCP
      AnnouncementBanner.show(
        'Estamos a fazer alterações com o objetivo de te trazer mais informação e mais exata. Por essa razão poderás detetar falhas no acesso à informação. Pedimos desculpa pelo incomodo, seremos breves. Hora estimada de conclusão dos trabalhos: 20:00',
        { type: 'info', id: 'stcp-warning', dismissible: false }
      );
      
      await scheduleService.loadScheduleData();

      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();

      this._initUserLocation();

      this.centerControl = createCenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition(),
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
      // FIX: registar as cores das rotas no iconCache logo que a lista chegar,
      // para que _lineColors() as encontre em cascata nos popups dos marcadores.
      routeService.fetchRoutesList().then(routes => {
        this.routeFilterBar.setRoutes(routes);
        iconCache.registerRouteColors(routes);
      }).catch(() => this.routeFilterBar.setLoading(false));

      this.setupEventListeners();
      this.lastUpdateDisplay.initialize();

      if (REALTIME_BUSES_ENABLED) {
        this.loadingOverlay.update('Agora tens uma app mais rápida com localizações mais precisas. Esperemos que gostes!');
        await this.fetchAndUpdateBuses();
        this.startAutoRefresh();
      }

      if (!mqttVehicleService.hasData()) {
        this.loadingOverlay.update('A aguardar primeiros dados em tempo real...');

        // Escutar evento de primeiro dado recebido
        const handleFirstData = () => {
          if (this.loadingOverlay) {
            this.loadingOverlay.remove();
            this.loadingOverlay = null;
          }
          eventBus.off('mqtt:dataRestored', handleFirstData);
        };
        eventBus.on('mqtt:dataRestored', handleFirstData);

        // Timeout de segurança: remover overlay após 30s mesmo sem dados
        setTimeout(() => {
          if (this.loadingOverlay) {
            this.loadingOverlay.remove();
            this.loadingOverlay = null;
          }
          eventBus.off('mqtt:dataRestored', handleFirstData);
        }, 30000);
      } else {
        this.loadingOverlay.remove();
        this.loadingOverlay = null;
      }

      await this._handleDeepLink();

      this.tutorialModal.showIfFirstVisit();

    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      if (this.loadingOverlay) {
        this.loadingOverlay.remove();
        this.loadingOverlay = null;
      }
      this.showError('Erro ao inicializar aplicação');
    }
  }

  _initUserLocation() {
    geolocationService.getCurrentPosition()
      .then(position => {
        this.mapManager.updateUserMarker(position);
        if (!this._currentStopId) {
          this.mapManager.centerOn(position, 16);
        }
      })
      .catch(err => console.warn('⚠️ Localização indisponível:', err.message));
  }

  setupEventListeners() {
    const btn = document.getElementById('refresh-now');
    if (btn) {
      btn.addEventListener('click', () => {
        if (this._currentStopId) {
          // Forçar fetch real ignorando cache
          this._loadStopArrivals(this._currentStopId, false, /* forceRefresh */ true);
        } else {
          autoRefreshManager.forceRefresh('bus-map');
        }
      });
    }
  }

  startAutoRefresh() {
    autoRefreshManager.startMqtt('bus-map', {
      onSnapshot: (vehicles) => {
        const processed = vehicleService.processBusDataBatch(vehicles);
        this._allProcessedBuses = processed;
        this.busMarkerManager.updateBusMarkers(processed);
        this.lastUpdateDisplay.update();
      },

      onVehicleUpdate: (vehicle) => {
        // 1. Manter o array global sincronizado
        const idx = this._allProcessedBuses.findIndex(b => b.id === vehicle.id);
        if (idx >= 0) this._allProcessedBuses[idx] = vehicle;
        else          this._allProcessedBuses.push(vehicle);

        // 2. Registar a rota/direção neste veículo
        this.busMarkerManager.setRouteForMarker(
          vehicle.id,
          vehicle.displayLine || vehicle.line || '',
          vehicle.direction
        );

        // 3. Filtro de rota global
        const activeRoutes = routeFilterState.selectedRoutes;
        if (activeRoutes.size > 0 && !activeRoutes.has(String(vehicle.displayLine || vehicle.line || ''))) {
          return;
        }

        // 4. Com paragem aberta: só mostrar veículos relevantes para essa paragem
        if (this._currentStopId) {
          const arrivals = this.nextArrivals?.allArrivals || [];

          // routeFilterState é sempre a fonte de verdade (painel e barra global
          // escrevem sempre nele), incluindo a direcção já corrigida em
          // _handleArrivalFilterChange().
          const activeFilter = routeFilterState.selectedRoutes;
          const activeDirMap = routeFilterState.dirMap;

          const vehicleLine = String(vehicle.displayLine || vehicle.line || '');

          // 1. Se há filtro activo, o veículo tem de pertencer a uma das linhas filtradas
          if (activeFilter.size > 0 && !activeFilter.has(vehicleLine)) {
            return;
          }

          // 2. Verificar direcção
          if (activeDirMap.has(vehicleLine) && vehicle.direction !== activeDirMap.get(vehicleLine)) {
            return;
          }

          // 3. SEM filtro de linha activo: restringir aos veículos com chegada
          //    prevista para esta paragem (evita mostrar toda a rede).
          //    COM filtro activo: mostrar sempre todos os veículos da linha/direcção.
          if (activeFilter.size === 0) {
            const isRelevant = arrivals.some(a => {
              const arrivalLine = String(a.route_short_name || '');
              if (arrivalLine !== vehicleLine) return false;
              if (typeof a.directionId === 'number' && typeof vehicle.direction === 'number') {
                if (a.directionId !== vehicle.direction) return false;
              } else if (typeof a.direction_id === 'number' && typeof vehicle.direction === 'number') {
                if (a.direction_id !== vehicle.direction) return false;
              }
              return true;
            });
            if (!isRelevant) return;
          }

          this.busMarkerManager.updateSingleBusMarker(vehicle);
          this.busMarkerManager.filterByRoutes(routeFilterState.selectedRoutes, routeFilterState.dirMap);
          this.lastUpdateDisplay.update();

          if (this._trackedVehicleId && this._trackedVehicleId === vehicle.id) {
            const location = vehicleService.extractVehicleLocation(vehicle);
            if (location) {
              this.mapManager.map.setView(location, this.mapManager.map.getZoom(), {
                animate: true,
                paddingTopLeft: [0, 120],
              });
            }
            return;
          }

          if (!this._busMapCentered) {
            this._tryCenterOnStopBuses();
          }
          return;
        }

        // 5. Modo global: actualizar marcador individual
        this.busMarkerManager.updateSingleBusMarker(vehicle);
        this.lastUpdateDisplay.update();
      },
    });
  }

  async _tryCenterOnStopBuses() {
    if (this._busMapCentered || !this._currentStopId) return;
    try {
      const arrivals = this.nextArrivals?.allArrivals || [];
      const vehicles = this._getAllMqttVehiclesAsRaw();
      if (arrivals.length === 0 || vehicles.length === 0) return;

      await this._updateArrivalsOnMap(arrivals, vehicles, /* centerMap */ true);

      if (!this._busMapCentered) {
        const visiblePositions = this.busMarkerManager.getVisibleMarkerPositions?.() || [];
        if (visiblePositions.length > 0 && this._currentStopPosition) {
          this._fitToPositions([...visiblePositions, this._currentStopPosition]);
          this._busMapCentered = true;
        } else if (this._currentStopPosition) {
          this.mapManager.centerOn(this._currentStopPosition, 16);
          this._busMapCentered = true;
        }
      }
    } catch (err) {
      console.warn('[BusMapApp] _tryCenterOnStopBuses falhou:', err);
    }
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

  async _handleArrivalFilterChange(selectedInPanel) {
    const effectiveFilter = selectedInPanel.size > 0 ? selectedInPanel : routeFilterState.selectedRoutes;

    const resolvedDirMap = new Map();
    await Promise.all(Array.from(effectiveFilter).map(async routeNum => {
      const routeObj = (this.routeFilterBar?.routes || []).find(r => String(r.number) === String(routeNum));
      const routeId  = String(routeObj?.id || routeNum);
      const dir      = await this._resolveDirectionForStop(routeId);
      resolvedDirMap.set(String(routeNum), dir);
    }));

    // Guardar no estado global para que outros consumidores (onVehicleUpdate)
    // usem sempre a direção correta.
    routeFilterState.updateDirections(resolvedDirMap);

    this.busMarkerManager.filterByRoutes(effectiveFilter, resolvedDirMap);

    if (selectedInPanel.size > 0) {
      const routesToFetch = Array.from(selectedInPanel).map(routeNum => {
        const routeObj = (this.routeFilterBar?.routes || []).find(r => String(r.number) === String(routeNum));
        return {
          routeId:    String(routeObj?.id || routeNum),
          direction:  resolvedDirMap.get(String(routeNum)) ?? 0,
          color:      routeObj?.color      || '#187EC2',
          text_color: routeObj?.text_color || '#FFFFFF',
        };
      });
      const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
      this.lineOverlayManager.setRoutes(overlayData);
    } else {
      this.lineOverlayManager.clearAll();
    }
  }

  async _handleStopClick(stop) {
    this._stopArrivalsRefresh();

    this._currentStopId       = stop.stop_id;
    this._currentStopPosition = [stop.latitude, stop.longitude];
    this._busMapCentered      = false;
    // Limpar qualquer seguimento de veículo anterior ao mudar de paragem
    this._trackedVehicleId    = null;

    // Limpar cache da paragem anterior para garantir fetch fresco
    plannedArrivalsService.clearCache(stop.stop_id);

    this.mapManager.centerOn([stop.latitude, stop.longitude], 16);
    this.nextArrivals.show(stop.stop_name, stop.stop_id);
    this.mapManager.map.closePopup();

    const [stopInfo] = await Promise.allSettled([apiService.fetchStopInfo(stop.stop_id)]);
    const routes = stopInfo.status === 'fulfilled' && stopInfo.value?.routes
      ? stopInfo.value.routes : (stop.routes || []);
    this.nextArrivals.setRoutes(routes);

    // Sincronizar filtros da barra global com a paragem
    if (routeFilterState.hasActive()) {
      // Pré-selecionar no painel as linhas que estão no filtro global
      const relevantRoutes = routes.filter(r =>
          routeFilterState.selectedRoutes.has(String(r.number))
      );

      if (relevantRoutes.length > 0) {
        this.nextArrivals.selectedRoutes = new Set(
            relevantRoutes.map(r => String(r.number))
        );
        this.nextArrivals._renderFilterBar();
      }
    }

    await this._loadStopArrivals(stop.stop_id, true);
    this._startArrivalsRefresh();
    this._pushStopToURL(stop.stop_id);
  }

  /**
   * Resolve a direcção correta de uma linha para a paragem actualmente aberta,
   * verificando se essa paragem pertence à lista de paragens da direcção 0.
   * Mais fiável do que assumir 0 quando não há chegada prevista correspondente.
   */
  async _resolveDirectionForStop(routeId) {
    if (!this._currentStopId) return 0;
    try {
      const stopsDir0 = await routeService.fetchRouteStops(routeId, 0);
      const stopIds0  = (stopsDir0?.stops || []).map(s => String(s.stop_id));
      return stopIds0.includes(String(this._currentStopId)) ? 0 : 1;
    } catch (e) {
      console.warn(`⚠️ Erro ao verificar direção da linha ${routeId} para a paragem ${this._currentStopId}:`, e);
      return 0;
    }
  }

  /**
   * Carrega chegadas para a paragem actual.
   *
   * @param {string}  stopId       - ID da paragem
   * @param {boolean} centerMap    - centrar o mapa nos autocarros encontrados
   * @param {boolean} forceRefresh - ignorar cache e forçar fetch à rede
   */
  async _loadStopArrivals(stopId, centerMap = false, forceRefresh = false) {
    try {
      const arrivals = await plannedArrivalsService.getNextArrivals(
        stopId,
        60,
        forceRefresh
      );

      if (arrivals.length === 0) {
        this.nextArrivals.setArrivals([], []);
        this.nextArrivals.updateLastUpdate();
        return;
      }

      const vehicles = REALTIME_BUSES_ENABLED ? this._getAllMqttVehiclesAsRaw() : [];

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

  _getAllMqttVehiclesAsRaw() {
    if (!mqttVehicleService.hasData()) return [];
    return this._allProcessedBuses;
  }

  async _updateArrivalsOnMap(arrivals, vehicles, centerMap = false) {
    const busesToShow  = [];
    const busPositions = [];
    const shownIds      = new Set();

    const addBus = (bus, delaySec) => {
      if (!bus || shownIds.has(bus.id)) return;
      const location = vehicleService.extractVehicleLocation(bus);
      if (!location) return;
      if (delaySec !== undefined) bus._delaySec = delaySec;
      shownIds.add(bus.id);
      busesToShow.push(bus);
      busPositions.push(location);
    };

    // 1. Associar chegadas previstas a veículos (para obter o delay correcto)
    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;
      let processedBus = null;
      if (arrival.trip_id && vehicles.length > 0) {
        processedBus = vehicles.find(v =>
            v.tripId && vehicleService.tripIdsMatch(v.tripId, arrival.trip_id)
        ) || null;
      }
      if (!processedBus && vehicles.length > 0) {
        const arrLine  = String(arrival.route_short_name || '');
        const candidates = vehicles.filter(v =>
            String(v.displayLine || v.line || '') === arrLine
        );
        if (candidates.length > 0) processedBus = candidates[0];
      }
      addBus(processedBus, arrival.delay ?? null);
    }

    // 2. Com filtro de linha activo: adicionar TODOS os veículos dessa
    //    linha/direcção, mesmo sem chegada prevista correspondente (autocarros
    //    ainda longe da paragem, ou fora da janela/limite da OTP).
    const activeFilter = routeFilterState.selectedRoutes;
    if (activeFilter.size > 0) {
      const activeDirMap = routeFilterState.dirMap;
      vehicles.forEach(v => {
        const line = String(v.displayLine || v.line || '');
        if (!activeFilter.has(line)) return;
        if (activeDirMap.has(line) && v.direction !== activeDirMap.get(line)) return;
        addBus(v);
      });
    }

    if (busesToShow.length > 0) {
      this.busMarkerManager.updateBusMarkers(busesToShow);
    } else if (vehicles.length > 0 && activeFilter.size === 0) {
      this.busMarkerManager.updateBusMarkers(vehicles.slice(0, 20));
    } else {
      this.busMarkerManager.clearAllMarkers();
    }

    if (centerMap && !this._busMapCentered && busPositions.length > 0 && this._currentStopPosition) {
      this._fitToPositions([...busPositions, this._currentStopPosition]);
      this._busMapCentered = true;
    }
  }

  _fitToPositions(positions) {
    if (!positions || positions.length === 0) return;
    const normalized = positions
        .map(p => {
          if (Array.isArray(p)) {
            return [Number(p[0]), Number(p[1])];
          }
          const lat = Number(p?.lat ?? p?.latitude);
          const lng = Number(p?.lng ?? p?.lon ?? p?.longitude);
          return [lat, lng];
        })
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (normalized.length === 0) return;
    if (normalized.length === 1) {
      this.mapManager.centerOn(normalized[0], 15);
      return;
    }
    const lats = normalized.map(([lat]) => lat);
    const lngs = normalized.map(([, lng]) => lng);
    this.mapManager.map.fitBounds([
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    ], {
      padding: [60, 60],
      maxZoom: 15
    });
  }

  // ─── Paragem — refresh periódico ─────────────────────────────────────────────

  _startArrivalsRefresh() {
    this._stopArrivalsRefresh();
    this._arrivalsRefreshInterval = setInterval(() => {
      if (this._currentStopId) {
        // Cada tick do intervalo passa forceRefresh=true para ignorar o cache
        // de 4s e garantir que é feito um fetch real à rede em cada ciclo
        this._loadStopArrivals(this._currentStopId, false, /* forceRefresh */ true);
      }
    }, this.refreshInterval);
  }

  _stopArrivalsRefresh() {
    if (this._arrivalsRefreshInterval) {
      clearInterval(this._arrivalsRefreshInterval);
      this._arrivalsRefreshInterval = null;
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  /**
   * Clique numa chegada específica: centrar no autocarro e ativar seguimento
   * contínuo — em cada update MQTT o mapa recentrará automaticamente nele.
   * paddingTopLeft=[0,120] garante que o marcador aparece abaixo dos overlays
   * superiores (barra de filtros + campo de pesquisa).
   */
  _handleArrivalClick({ vehicleId, location }) {
    if (!location) return;

    // Guardar o ID para seguimento contínuo via onVehicleUpdate
    this._trackedVehicleId = vehicleId || null;

    this.mapManager.map.setView(location, 16, {
      animate: true,
      paddingTopLeft: [0, 120],
    });
  }

  async _handleCloseArrivals() {
    this._stopArrivalsRefresh();
    this._currentStopId       = null;
    this._currentStopPosition = null;
    this._busMapCentered      = false;
    this._trackedVehicleId    = null;

    // Restaurar markers de todos os autocarros
    this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);

    const activeRoutes = routeFilterState.selectedRoutes;

    if (activeRoutes.size > 0) {
      // Re-aplicar filtros e overlays ativos
      this.busMarkerManager.filterByRoutes(activeRoutes, routeFilterState.dirMap);

      // Restaurar shapes e stops das linhas filtradas
      const routeObjs = routeFilterState.selectedRouteObjs;
      const routesToFetch = routeObjs.map(r => ({
        routeId:    String(r.id || r.number),
        direction:  r.direction ?? 0,
        color:      r.color      || '#187EC2',
        text_color: r.text_color || '#FFFFFF'
      }));

      try {
        const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
        this.lineOverlayManager.setRoutes(overlayData);
      } catch (err) {
        console.warn('Erro ao restaurar overlays:', err);
      }
    } else {
      // Sem filtros ativos - limpar overlays
      this.lineOverlayManager.clearAll();
    }

    this._removeStopFromURL();
  }

  _handleRefreshArrivals() {
    if (this._currentStopId) {
      return this._loadStopArrivals(this._currentStopId, false, /* forceRefresh */ true);
    }
  }

  async _toggleFavourite(stopId) {
    if (!stopId) return;
    const wasFav = favouritesManager.isFavourite(stopId);
    if (wasFav) favouritesManager.removeFavourite(stopId);
    else        await favouritesManager.addFavourite(stopId);
    this.nextArrivals.refreshFavouriteBtn();
    this.favouritesPanel?.refresh();
  }

  // ─── URL ──────────────────────────────────────────────────────────────────────

  _pushStopToURL(stopId) {
    const url = new URL(window.location.href);
    url.searchParams.set('stop', stopId);
    window.history.pushState({}, '', url.toString());
  }

  _removeStopFromURL() {
    const url = new URL(window.location.href);
    url.searchParams.delete('stop');
    window.history.replaceState({}, '', url.toString());
  }

  // ─── Fallback para fonte alternativa ─────────────────────────────────────────

  _showFallbackPrompt() {
    this._fallbackPromptVisible = true;
    AnnouncementBanner.show(
      'Sem autocarros na fonte principal. Pretende tentar a fonte alternativa?',
      {
        type: 'info',
        id:   'fallback-prompt',
        dismissible: true,
        action: {
          label: 'Tentar alternativa',
          callback: () => {
            apiService.setVehiclesSource('fallback');
            this._fallbackPromptVisible = false;
            this.fetchAndUpdateBuses();
          },
        },
      }
    );
  }

  showError(message) {
    AnnouncementBanner.show(message, { type: 'error', dismissible: true });
  }
}
