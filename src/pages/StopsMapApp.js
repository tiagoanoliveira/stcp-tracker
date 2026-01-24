/**
 * StopsMapApp - Aplicação de mapa de paragens
 * Usa: MapManager, StopMarkerManager, stopService, geolocationService
 */

import { geolocationService } from '../core/geolocationService.js';
import { stopService } from '../services/stopService.js';
import { MapManager } from '../map/MapManager.js';
import { StopMarkerManager } from '../map/markers/StopMarkerManager.js';
import { createCenterControl } from '../map/controls/CenterControl.js';
import { createBusMapControl } from '../map/controls/BusMapControl.js';

export class StopsMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.mapManager = null;
    this.stopMarkerManager = null;
    this.centerControl = null;
    this.busMapControl = null;
  }

  async initialize() {
    try {
      console.log('🚀 Inicializando StopsMapApp...');

      // 1. Carregar dados de paragens
      await stopService.loadStopsData();
      console.log('✓ Dados de paragens carregados');

      // 2. Inicializar mapa
      this.mapManager = new MapManager(this.mapElementId);
      this.mapManager.initialize();
      await this.mapManager.waitForReady();
      console.log('✓ Mapa inicializado');

      // 3. Adicionar controlo de centrar
      this.centerControl = createCenterControl(
        this.mapManager.map,
        () => this.mapManager.getUserPosition()
      );
      this.centerControl.addTo(this.mapManager.map);
      console.log('✓ Controlo de centrar adicionado');

      // 4. Adicionar controlo de voltar ao busmap
      this.busMapControl = createBusMapControl(this.mapManager.map);
      this.busMapControl.addTo(this.mapManager.map);
      console.log('✓ Controlo de busmap adicionado');

      // 5. Inicializar stop marker manager
      this.stopMarkerManager = new StopMarkerManager(this.mapManager.map);

      // 6. Configurar geolocalização
      this.setupGeolocation();

      // 7. Configurar event listeners
      this.setupEventListeners();

      // 8. Mostrar paragens
      this.displayAllStops();

      console.log('✅ StopsMapApp inicializado com sucesso');
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
        this.displayNearbyStops();
      })
      .catch(error => {
        console.warn('⚠ Não foi possível obter localização:', error.message);
        this.displayAllStops();
      });
  }

  setupEventListeners() {
    // Pesquisa ao escrever (debounced)
    const searchInput = document.getElementById('stop-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.handleSearch();
        }, 300);
      });

      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(searchTimeout);
          this.handleSearch();
        }
      });
    }
  }

  displayAllStops() {
    const stops = stopService.getAllStops();
    this.stopMarkerManager.updateStopMarkers(stops, false);
    console.log(`📍 ${stops.length} paragens mostradas`);
  }

  displayNearbyStops() {
    const userPos = this.mapManager.getUserPosition();
    if (!userPos) {
      this.displayAllStops();
      return;
    }

    const nearbyStops = stopService.getNearbyStops(userPos[0], userPos[1], 2000);
    
    if (nearbyStops.length > 0) {
      this.stopMarkerManager.updateStopMarkers(nearbyStops, true);
      this.mapManager.centerOn(userPos, 15);
      console.log(`📍 ${nearbyStops.length} paragens próximas mostradas`);
    } else {
      this.displayAllStops();
    }
  }

  handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();

    if (!query) {
      this.displayNearbyStops();
      return;
    }

    const results = stopService.searchStops(query);
    
    if (results.length === 0) {
      this.stopMarkerManager.clearAllMarkers();
      console.log('🔍 Nenhuma paragem encontrada');
      return;
    }

    this.stopMarkerManager.updateStopMarkers(results, false);
    console.log(`🔍 ${results.length} paragens encontradas`);

    if (results.length === 1) {
      this.mapManager.centerOn([results[0].latitude, results[0].longitude], 16);
    } else {
      const positions = results.map(s => [s.latitude, s.longitude]);
      this.mapManager.fitBounds(positions);
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
    geolocationService.stopWatching();
    if (this.stopMarkerManager) {
      this.stopMarkerManager.clearAllMarkers();
    }
    if (this.mapManager) {
      this.mapManager.cleanup();
    }
    console.log('🗑 StopsMapApp cleanup concluído');
  }
}

// Auto-inicializar quando DOM estiver pronto
if (typeof window !== 'undefined') {
  const app = new StopsMapApp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
  } else {
    app.initialize();
  }

  // Cleanup ao sair da página
  window.addEventListener('beforeunload', () => app.cleanup());
}
