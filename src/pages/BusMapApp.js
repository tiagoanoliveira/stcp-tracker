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
import { mqttVehicleService }     from '../services/mqttVehicleService.js';
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
    this._vehiclesSource        = 'mqtt';
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
      routeService.fetchRoutesList().then(routes => {
        this.routeFilterBar.setRoutes(routes);
      }).catch(() => this.routeFilterBar.setLoading(false));

      this.setupEventListeners();
      this.lastUpdateDisplay.initialize();

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
        // Só centra na posição GPS se não houver paragem seleccionada
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
        // Em modo MQTT, o botão força refresh das chegadas da paragem aberta
        // (posicões de veículos chegam via MQTT automaticamente)
        if (this._currentStopId) {
          this._loadStopArrivals(this._currentStopId, false);
        } else {
          autoRefreshManager.forceRefresh('bus-map');
        }
      });
    }
  }

  startAutoRefresh() {
    autoRefreshManager.startMqtt('bus-map', {
      // Chamado uma vez no arranque com todos os autocarros (snapshot FIWARE)
      onSnapshot: (vehicles) => {
        const processed = vehicleService.processBusDataBatch(vehicles);
        this._allProcessedBuses = processed;
        this.busMarkerManager.updateBusMarkers(processed);
        this.lastUpdateDisplay.update();
      },

      // Chamado individualmente por cada autocarro que atualiza posição via MQTT.
      //
      // NÃO usar updateBusMarkers([vehicle]) aqui — removeria todos os outros marcadores.
      // updateSingleBusMarker garante deduplicação sem afectar os restantes.
      onVehicleUpdate: (vehicle) => {
        // 1. Manter o array global sincronizado
        const idx = this._allProcessedBuses.findIndex(b => b.id === vehicle.id);
        if (idx >= 0) this._allProcessedBuses[idx] = vehicle;
        else          this._allProcessedBuses.push(vehicle);

        // 2. Registar a rota/direção neste veículo (necessário para filterByRoutes)
        this.busMarkerManager.setRouteForMarker(
          vehicle.id,
          vehicle.displayLine || vehicle.line || '',
          vehicle.direction
        );

        // 3. Se houver filtro activo e este veículo não pertencer à rota, não mostrar
        const activeRoutes = routeFilterState.selectedRoutes;
        if (activeRoutes.size > 0 && !activeRoutes.has(String(vehicle.displayLine || vehicle.line || ''))) {
          return;
        }

        // 4. Se há paragem aberta, não mostrar veículos globais — apenas os da paragem
        if (this._currentStopId) {
          // Verificar se este veículo tem trip match com alguma chegada em display
          const arrivals = this.nextArrivals?.allArrivals || [];
          const isRelevant = arrivals.some(a =>
            a.is_realtime && (
              (a.trip_id && vehicle.tripId && vehicleService.tripIdsMatch(vehicle.tripId, a.trip_id)) ||
              String(a.route_short_name || '') === String(vehicle.displayLine || vehicle.line || '')
            )
          );
          if (!isRelevant) return; // veículo não passa nesta paragem, ignorar

          // Veículo relevante para a paragem: actualizar o marcador
          this.busMarkerManager.updateSingleBusMarker(vehicle);
          this.lastUpdateDisplay.update();

          // Centrar o mapa uma única vez, na primeira vez que temos veículos reais
          if (!this._busMapCentered) {
            this._tryCenterOnStopBuses();
          }
          return;
        }

        // 5. Actualizar APENAS este marcador no modo global (sem paragem aberta)
        this.busMarkerManager.updateSingleBusMarker(vehicle);
        this.lastUpdateDisplay.update();
      },
    });
  }

  /**
   * Após o primeiro update MQTT com paragem aberta, calcula os bounds
   * usando os veículos visíveis no mapa para essa paragem.
   * Só actua uma vez por abertura de paragem (_busMapCentered = true).
   */
  async _tryCenterOnStopBuses() {
    if (this._busMapCentered || !this._currentStopId) return;

    try {
      const arrivals = this.nextArrivals?.allArrivals || [];
      const vehicles = this._getAllMqttVehiclesAsRaw();

      if (arrivals.length === 0 || vehicles.length === 0) return;

      // Tentar centrar via match trip_id/linha
      await this._updateArrivalsOnMap(arrivals, vehicles, /* centerMap */ true);

      // Se _updateArrivalsOnMap não conseguiu centrar (nenhum match de posição),
      // usar as posições já visíveis no mapa como fallback
      if (!this._busMapCentered) {
        const visiblePositions = this.busMarkerManager.getVisibleMarkerPositions?.() || [];
        if (visiblePositions.length > 0 && this._currentStopPosition) {
          this._fitToPositions([...visiblePositions, this._currentStopPosition]);
          this._busMapCentered = true;
        } else if (this._currentStopPosition) {
          // Último recurso: centrar na paragem (já foi feito ao abrir, mas garante consistência)
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

  /**
   * Chamado quando o utilizador activa/desactiva um chip de linha no painel de chegadas.
   */
  async _handleArrivalFilterChange(selectedInPanel) {
    const arrivalDirMap = new Map();

    for (const routeNum of selectedInPanel) {
      const arrival = this.nextArrivals.allArrivals.find(
        a => String(a.route_short_name) === String(routeNum)
      );

      if (arrival) {
        let dir = 0;
        if (typeof arrival.directionId === 'number') {
          dir = arrival.directionId;
        } else if (typeof arrival.direction_id === 'number') {
          dir = arrival.direction_id;
        }
        arrivalDirMap.set(routeNum, dir);
      }
    }

    const effectiveFilter = selectedInPanel.size > 0
      ? selectedInPanel : routeFilterState.selectedRoutes;
    const effectiveDirMap = arrivalDirMap.size > 0
      ? arrivalDirMap : routeFilterState.dirMap;

    this.busMarkerManager.filterByRoutes(effectiveFilter, effectiveDirMap);

    if (selectedInPanel.size > 0) {
      const routesToFetch = [];
      for (const routeNum of selectedInPanel) {
        const dir = arrivalDirMap.get(routeNum) ?? 0;
        const routeObj = (this.routeFilterBar?.routes || [])
          .find(r => String(r.number) === String(routeNum));
        routesToFetch.push({
          routeId:    String(routeObj?.id || routeNum),
          direction:  dir,
          color:      routeObj?.color      || '#187EC2',
          text_color: routeObj?.text_color || '#FFFFFF',
        });
      }
      const overlayData = await routeService.fetchMultipleRoutesOverlay(routesToFetch);
      this.lineOverlayManager.setRoutes(overlayData);
    } else {
      this.lineOverlayManager.clearAll();
    }
  }

  async _handleStopClick(stop) {
    this._stopArrivalsRefresh();

    // Ao abrir uma paragem: mostrar apenas os autocarros que chegam a essa paragem.
    // Esconder todos os marcadores do modo global antes de começar.
    this.busMarkerManager.hideAllMarkers();

    this._currentStopId       = stop.stop_id;
    this._currentStopName     = stop.stop_name;
    this._currentStopPosition = [stop.latitude, stop.longitude];
    this._busMapCentered      = false;
    this._currentBusPositions = [];

    // Centrar imediatamente na paragem enquanto os autocarros ainda não chegaram
    this.mapManager.centerOn([stop.latitude, stop.longitude], 16);

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

      // Usar snapshot MQTT (já processado) em vez de fazer nova chamada HTTP
      const vehicles = REALTIME_BUSES_ENABLED
        ? this._getAllMqttVehiclesAsRaw()
        : [];

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

  /**
   * Devolve os veículos já processados do snapshot MQTT.
   * _allProcessedBuses é sincronizado a cada update recebido pelo broker.
   */
  _getAllMqttVehiclesAsRaw() {
    if (!mqttVehicleService.hasData()) return [];
    return this._allProcessedBuses;
  }

  async _updateArrivalsOnMap(arrivals, vehicles, centerMap = false) {
    const busesToShow  = [];
    const busPositions = [];

    for (const arrival of arrivals) {
      if (!arrival.is_realtime) continue;

      let processedBus = null;

      // 1. Match exacto por trip_id
      if (arrival.trip_id && vehicles.length > 0) {
        processedBus = vehicles.find(v =>
          v.tripId && vehicleService.tripIdsMatch(v.tripId, arrival.trip_id)
        ) || null;
      }

      // 2. Fallback: linha (não usar direcção — pode estar undefined nos veículos processados)
      if (!processedBus && vehicles.length > 0) {
        const arrLine = String(arrival.route_short_name || '');
        const candidates = vehicles.filter(v =>
          String(v.displayLine || v.line || '') === arrLine
        );
        if (candidates.length > 0) processedBus = candidates[0];
      }

      if (!processedBus) continue;

      const location = vehicleService.extractVehicleLocation(processedBus);
      if (!location) continue;

      if (!busesToShow.find(b => b.id === processedBus.id)) {
        busesToShow.push(processedBus);
        busPositions.push(location);
      }
    }

    if (busesToShow.length > 0) {
      this.busMarkerManager.updateBusMarkers(busesToShow);
    } else if (vehicles.length > 0) {
      this.busMarkerManager.updateBusMarkers(vehicles.slice(0, 20));
    }

    if (centerMap && !this._busMapCentered && busPositions.length > 0 && this._currentStopPosition) {
      this._fitToPositions([...busPositions, this._currentStopPosition]);
      this._busMapCentered = true;
    }
    this._currentBusPositions = busPositions;
  }

  _fitToPositions(positions) {
    if (!positions || positions.length === 0) return;
    if (positions.length === 1) {
      this.mapManager.centerOn(positions[0], 15);
      return;
    }
    const lats = positions.map(p => Array.isArray(p) ? p[0] : p.lat);
    const lngs = positions.map(p => Array.isArray(p) ? p[1] : p.lng);
    const bounds = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    this.mapManager.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
  }

  // ─── Paragem — refresh periódico ─────────────────────────────────────────────

  _startArrivalsRefresh() {
    this._stopArrivalsRefresh();
    // Usar o mesmo intervalo do MQTT (5s por defeito) para manter os
    // tempos de chegada OTP sempre frescos. É um fetch leve (só esta paragem).
    this._arrivalsRefreshInterval = setInterval(() => {
      if (this._currentStopId) this._loadStopArrivals(this._currentStopId, false);
    }, this.refreshInterval);
  }

  _stopArrivalsRefresh() {
    if (this._arrivalsRefreshInterval) {
      clearInterval(this._arrivalsRefreshInterval);
      this._arrivalsRefreshInterval = null;
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  _handleArrivalClick({ vehicleId, location }) {
    if (location) this.mapManager.centerOn(location, 16);
  }

  _handleCloseArrivals() {
    this._stopArrivalsRefresh();
    this._currentStopId       = null;
    this._currentStopName     = null;
    this._currentStopPosition = null;
    this._currentBusPositions = [];
    this._busMapCentered      = false;
    this.lineOverlayManager.clearAll();
    // Restaurar todos os marcadores ao fechar a paragem
    this.busMarkerManager.updateBusMarkers(this._allProcessedBuses);
    const activeRoutes = routeFilterState.selectedRoutes;
    if (activeRoutes.size > 0) {
      this.busMarkerManager.filterByRoutes(activeRoutes, routeFilterState.dirMap);
    }
    this._removeStopFromURL();
  }

  _handleRefreshArrivals() {
    if (this._currentStopId) return this._loadStopArrivals(this._currentStopId, false);
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
        type: 'warning',
        id: 'fallback-prompt',
        dismissible: true,
        action: {
          label: 'Usar fonte alternativa',
          callback: () => {
            apiService.setVehiclesSource('fallback');
            this.fetchAndUpdateBuses();
          },
        },
      }
    );
  }

  showError(message) {
    console.error(message);
  }
}
