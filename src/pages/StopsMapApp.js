/**
 * StopsMapApp - Aplicação de mapa de paragens
 * Usa: MapManager, StopMarkerManager, stopService, geolocationService
 */

import { geolocationService } from '../core/geolocationService.js';
import { stopService } from '../services/stopService.js';
import { MapManager } from '../map/MapManager.js';
import { StopMarkerManager } from '../map/markers/StopMarkerManager.js';

export class StopsMapApp {
  constructor(options = {}) {
    this.mapElementId = options.mapElementId || 'map';
    this.mapManager = null;
    this.stopMarkerManager = null;
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

      // 3. Inicializar stop marker manager
      this.stopMarkerManager = new StopMarkerManager(this.mapManager.map);

      // 4. Configurar geolocalização
      this.setupGeolocation();

      // 5. Configurar event listeners
      this.setupEventListeners();

      // 6. Mostrar paragens
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
    // Botão de pesquisa
    const searchBtn = document.getElementById('search-stop');
    const searchInput = document.getElementById('stop-search');

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => this.handleSearch());
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleSearch();
        }
      });
    }

    // Botão centrar no utilizador
    const centerBtn = document.getElementById('center-user-stops');
    if (centerBtn) {
      centerBtn.addEventListener('click', () => this.centerOnUser());
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
      alert('Nenhuma paragem encontrada.');
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

  centerOnUser() {
    const userPos = this.mapManager.getUserPosition();
    if (userPos) {
      this.mapManager.centerOn(userPos, 16);
      this.displayNearbyStops();
    } else {
      alert('Localização do utilizador não disponível.');
    }
  }

  showError(message) {
    console.error('❌', message);
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      setTimeout(() => {
        errorElement.style.display = 'none';
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
