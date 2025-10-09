import { dataService } from './dataService.js';
import { mapService } from './mapService.js';

class BusTrackingApp {
  constructor() {
    this.refreshTimeout = null;
    this.refreshDelay = 5000;
    this.isRefreshing = false;
  }

  async initialize() {
    try {
      console.log('Inicializando aplicação...');
      
      mapService.initializeMap();
      await this.waitForMapReady();
      console.log('Mapa pronto');
      await Promise.all([
        dataService.carregarTrips(),
        dataService.carregarCalendar(),
      ]);
      console.log('Dados carregados');
      this.setupGeolocation();
      this.setupEventListeners();
      this.startAutoRefresh();
      console.log('Aplicação inicializada com sucesso');
    } catch (error) {
      console.error('Erro na inicialização:', error);
    }
  }

  async waitForMapReady() {
    return new Promise((resolve) => {
      if (mapService.map && mapService.map._loaded) {
        resolve();
        return;
      }
      const checkInterval = setInterval(() => {
        if (mapService.map && mapService.map._loaded) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkInterval);
        console.warn('Timeout ao aguardar mapa estar pronto, prosseguindo...');
        resolve();
      }, 3000);
    });
  }

  setupGeolocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          mapService.setUserPosition(position.coords.latitude, position.coords.longitude);
          mapService.centerMapOnUser();
        },
        () => {
          console.warn('Não foi possível obter a localização.');
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
      );
    }
  }

  setupEventListeners() {
    const centerUserBtn = document.getElementById('center-user');
    const refreshNowBtn = document.getElementById('refresh-now');

    if (centerUserBtn) {
      centerUserBtn.addEventListener('click', () => {
        if (mapService.userPosition) {
          mapService.centerMapOnUser();
        } else {
          alert('Localização do utilizador não disponível.');
        }
      });
    }

    if (refreshNowBtn) {
      refreshNowBtn.addEventListener('click', () => this.forceRefresh());
    }
  }

  startAutoRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    const scheduleNext = async () => {
      const startTime = Date.now();
      try {
        await this.fetchAndUpdateBuses();
        const duration = Date.now() - startTime;
        console.log(`Atualização automática concluída em ${duration}ms`);
      } catch (error) {
        console.error('Erro na atualização automática:', error);
      } finally {
        this.refreshTimeout = setTimeout(scheduleNext, this.refreshDelay);
      }
    };
    scheduleNext();
  }

  async forceRefresh() {
    if (this.isRefreshing) {
      console.log('Atualização já em progresso, aguardando...');
      return;
    }
    const startTime = Date.now();
    try {
      this.isRefreshing = true;
      await this.fetchAndUpdateBuses();
      const duration = Date.now() - startTime;
      console.log(`Atualização manual concluída em ${duration}ms`);
    } catch (error) {
      console.error('Erro na atualização forçada:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  async fetchAndUpdateBuses() {
    try {
      const filterValue = '';
      
      console.log('Buscando dados de todos os autocarros...');
      const busData = await dataService.fetchBusData(filterValue);
      
      if (!busData || busData.length === 0) {
        console.warn('Nenhum autocarro encontrado');
        mapService.updateBusMarkers([]);
        return;
      }
      
      console.log(`${busData.length} autocarros recebidos, atualizando mapa...`);
      mapService.updateBusMarkers(busData);
      console.log('Marcadores atualizados no mapa');
    } catch (error) {
      console.error('Erro ao obter ou atualizar dados dos autocarros:', error);
      throw error;
    }
  }
}

const app = new BusTrackingApp();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.initialize());
} else {
  app.initialize();
}
