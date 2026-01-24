/**
 * BusMapApp - Aplicação principal do mapa de autocarros em tempo real
 * Usa toda a nova arquitetura: core services, map managers, ui components
 */

import { apiService } from '../core/apiService.js';
import { geolocationService } from '../core/geolocationService.js';
import { autoRefreshManager } from '../core/autoRefreshManager.js';
import { vehicleService } from '../services/vehicleService.js';
import { scheduleService } from '../services/scheduleService.js';
import { MapManager } from '../map/MapManager.js';
import { BusMarkerManager } from '../map/markers/BusMarkerManager.js';
import { LastUpdateDisplay } from '../ui/components/LastUpdateDisplay.js';
import { CenterControl } from '../map/controls/CenterControl.js';

export class BusMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.refreshInterval = options.refreshInterval || 5000;
    this.mapManager = null;
    this.busMarkerManager = null;
    this.lastUpdateDisplay = new LastUpdateDisplay();
    this.centerControl = null;
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando BusMapApp...');

      // 1. Inicializar mapa
      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();
      console.log('✓ Mapa inicializado');

      // 2. Adicionar controlo customizado de centrar
      this.centerControl = new CenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition()
      );
      this.mapManager.map.addControl(this.centerControl);
      console.log('✓ Controlo de centrar adicionado');

      // 3. Inicializar bus marker manager
      this.busMarkerManager = new BusMarkerManager(this.mapManager.map);

      // 4. Carregar dados de schedule (trips + calendar)
      await scheduleService.loadScheduleData();
      console.log('✓ Dados de horários carregados');

      // 5. Configurar geolocalização
      this.setupGeolocation();

      // 6. Configurar event listeners
      this.setupEventListeners();

      // 7. Inicializar display de última atualização
      this.lastUpdateDisplay.initialize();

      // 8. Primeira busca de dados
      await this.fetchAndUpdateBuses();

      // 9. Iniciar auto-refresh
      this.startAutoRefresh();

      console.log('✅ BusMapApp inicializado com sucesso');
    } catch (error) {
      console.error('❌ Erro na inicialização:', error);
      this.showError('Erro ao inicializar aplicação');
    }
  }

  setupGeolocation() {
    geolocationService.getCurrentPosition()
      .then(position => {
        console.log('✓ Localização obtida:', position);
        this.mapManager.updateUserMarker(position);
      })
      .catch(error => {
        console.warn('⚠ Não foi possível obter localização:', error.message);
      });
  }

  setupEventListeners() {
    // Botão refresh manual
    const refreshNowBtn = document.getElementById('refresh-now');
    if (refreshNowBtn) {
      refreshNowBtn.addEventListener('click', () => {
        autoRefreshManager.forceRefresh('bus-map');
      });
    }
  }

  startAutoRefresh() {
    autoRefreshManager.start(
      'bus-map',
      () => this.fetchAndUpdateBuses(),
      this.refreshInterval
    );
    console.log(`🔄 Auto-refresh iniciado (${this.refreshInterval}ms)`);
  }

  async fetchAndUpdateBuses(filterValue = '') {
    try {
      console.log('⏳ Buscando dados de autocarros...');

      // 1. Fetch dados da API FIWARE
      const rawBusData = await apiService.fetchBusData();
      if (!Array.isArray(rawBusData) || rawBusData.length === 0) {
        console.warn('⚠ Nenhum autocarro encontrado');
        this.busMarkerManager.clearAllMarkers();
        this.lastUpdateDisplay.update();
        return;
      }

      // 2. Processar dados de cada autocarro
      const processedBuses = rawBusData
        .map(bus => this.processBus(bus))
        .filter(bus => bus && vehicleService.shouldIncludeBus(bus, filterValue));

      console.log(`✓ ${processedBuses.length} autocarros processados`);

      // 3. Atualizar marcadores no mapa
      this.busMarkerManager.updateBusMarkers(processedBuses);

      // 4. Atualizar timestamp
      this.lastUpdateDisplay.update();

      console.log('✅ Mapa atualizado com sucesso');
    } catch (error) {
      console.error('❌ Erro ao atualizar autocarros:', error);
      this.showError('Erro ao obter dados dos autocarros');
    }
  }

  processBus(bus) {
    try {
      // Extrair informações básicas
      const line = vehicleService.extractLineNumber(bus);
      const direction = vehicleService.extractDirection(bus);
      const tripId = vehicleService.extractTripId(bus);

      // Obter destino usando scheduleService
      const destination = scheduleService.getDestination(line, direction);

      // Processar dados completos
      return vehicleService.processBusData(bus, destination);
    } catch (error) {
      console.warn(`⚠ Erro ao processar autocarro ${bus.id}:`, error);
      return null;
    }
  }

  showError(message) {
    console.error('❌', message);
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('show');
      setTimeout(() => {
        errorElement.classList.remove('show');
      }, 5000);
    }
  }

  cleanup() {
    autoRefreshManager.stop('bus-map');
    geolocationService.stopWatching();
    if (this.busMarkerManager) {
      this.busMarkerManager.clearAllMarkers();
    }
    if (this.mapManager) {
      this.mapManager.cleanup();
    }
    console.log('🗑 BusMapApp cleanup concluído');
  }
}

// Auto-inicializar quando DOM estiver pronto
if (typeof window !== 'undefined') {
  const app = new BusMapApp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }

  // Cleanup ao sair da página
  window.addEventListener('beforeunload', () => app.cleanup());
}
