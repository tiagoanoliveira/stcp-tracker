import { dataService } from './dataService.js';
import { mapService } from './mapService.js';

class BusTrackingApp {
  constructor() {
    this.refreshTimeout = null;
    this.refreshDelay = 5000; // intervalo de atualização em ms
    this.isRefreshing = false; // flag para evitar chamadas simultâneas
  }

  async initialize() {
    try {
      // Inicializar mapa
      mapService.initializeMap();
      
      // Aguardar o mapa estar completamente pronto
      await this.waitForMapReady();
      
      // Carregar dados necessários
      await Promise.all([
        dataService.carregarTrips(),
        dataService.carregarCalendar(),
      ]);
      
      this.setupGeolocation();
      this.setupEventListeners();

      // Primeira atualização e início do ciclo automático
      await this.forceRefresh();
      this.startAutoRefresh();
      
      console.log('Aplicação inicializada com sucesso');
    } catch (error) {
      console.error('Erro na inicialização:', error);
    }
  }

  // Aguarda o mapa estar pronto para receber marcadores
  waitForMapReady() {
    return new Promise(resolve => {
      if (mapService.map && mapService.map._loaded) {
        resolve();
      } else {
        // Aguarda evento 'load' do mapa
        const checkMap = setInterval(() => {
          if (mapService.map && mapService.map._loaded) {
            clearInterval(checkMap);
            resolve();
          }
        }, 50);
      }
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
    const applyFilterBtn = document.getElementById('apply-filter');
    const centerUserBtn = document.getElementById('center-user');
    const refreshNowBtn = document.getElementById('refresh-now');

    if (applyFilterBtn) {
      applyFilterBtn.addEventListener('click', this.forceRefresh.bind(this));
    } else {
      console.warn('Botão aplicar filtro não encontrado');
    }

    if (centerUserBtn) {
      centerUserBtn.addEventListener('click', () => {
        if (mapService.userPosition) {
          mapService.centerMapOnUser();
        } else {
          alert('Localização do utilizador não disponível para centrar o mapa.');
        }
      });
    } else {
      console.warn('Botão centrar mapa não encontrado');
    }

    if (refreshNowBtn) {
      refreshNowBtn.addEventListener('click', this.forceRefresh.bind(this));
    } else {
      console.warn('Botão atualizar autocarros não encontrado');
    }
  }

  startAutoRefresh() {
    // Limpa timeout anterior se existir
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // Função recursiva com setTimeout para evitar overlapping
    const scheduleNext = async () => {
      try {
        await this.fetchAndUpdateBuses();
        console.log('Atualização automática feita');
      } catch (error) {
        console.error('Erro na atualização automática:', error);
      } finally {
        // Agenda próxima atualização após a atual terminar
        this.refreshTimeout = setTimeout(scheduleNext, this.refreshDelay);
      }
    };

    // Inicia o ciclo
    this.refreshTimeout = setTimeout(scheduleNext, this.refreshDelay);
  }

  async forceRefresh() {
    // Evita múltiplas chamadas simultâneas
    if (this.isRefreshing) {
      console.log('Atualização já em progresso, aguardando...');
      return;
    }

    try {
      this.isRefreshing = true;
      await this.fetchAndUpdateBuses();
      console.log('Atualização manual feita');
    } catch (error) {
      console.error('Erro na atualização forçada:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  async fetchAndUpdateBuses() {
    try {
      const filterValue = document.getElementById('line-filter').value.trim().toLowerCase();
      const busData = await dataService.fetchBusData(filterValue);
      
      if (!busData || busData.length === 0) {
        console.warn('Nenhum autocarro encontrado');
        return;
      }
      
      mapService.updateBusMarkers(busData);
      console.log(`${busData.length} autocarros atualizados no mapa`);
    } catch (error) {
      console.error('Erro ao obter ou atualizar dados dos autocarros:', error);
      throw error; // re-lança o erro para ser tratado pelo caller
    }
  }
}

const app = new BusTrackingApp();

// Garante que a aplicação só inicia após o DOM estar completamente carregado
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.initialize());
} else {
  app.initialize();
}
