import { dataService } from '../javascript/dataService.js';
import { mapService } from '../javascript/mapService.js';
import { geoFilterService } from '../spam_filter/GeoFilterService.js';
import { ghostBusService } from '../spam_filter/GhostBusService.js';

class BusTrackingApp {
  constructor() {
    this.refreshInterval = null;
    this.cleanupInterval = null;
  }

  async initialize() {
    mapService.initializeMap();
    await Promise.all([
      dataService.carregarTrips(),
      dataService.carregarCalendar(),
      geoFilterService.carregarPolygons(),
      ghostBusService.loadGhostBuses()
    ]);
    this.setupGeolocation();
    this.setupEventListeners();
    this.forceRefresh();
    
    // Limpeza periódica de histórico antigo a cada 15 minutos
    this.cleanupInterval = setInterval(() => {
      ghostBusService.cleanupOldVehicles();
    }, 15 * 60 * 1000);
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
    document.getElementById('apply-filter').addEventListener('click', () => this.applyFilter());
    document.getElementById('center-user').addEventListener('click', () => mapService.centerMapOnUser());
    document.getElementById('refresh-now').addEventListener('click', () => this.forceRefresh());
  }

  async applyFilter() {
    this.forceRefresh();
  }

  async forceRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    await this.fetchAndUpdateBuses();
    this.refreshInterval = setInterval(() => this.fetchAndUpdateBuses(), 10000);
  }

  async fetchAndUpdateBuses() {
    const filterValue = document.getElementById('line-filter').value.trim().toLowerCase();
    let busData = await dataService.fetchBusData(filterValue);

    // Filtrar ônibus perto das áreas interiores (geofencing)
    if (filterValue == '') {
      busData = busData.filter(bus => {
        return !geoFilterService.pontoProximoDePoligono(bus.latitude, bus.longitude);
      });
    }

    // Filtrar ghost buses - remover veículos estacionários há mais de 30 minutos
    busData = busData.filter(bus => {
      const isGhost = ghostBusService.checkVehicleStatus(bus);
      return !isGhost; // Excluir veículos fantasma do mapa
    });

    mapService.updateBusMarkers(busData);
  }
}

const app = new BusTrackingApp();
window.onload = () => app.initialize();
