import { dataService } from './dataService.js';
import { mapService } from './mapService.js';
import { geoFilterService } from '../spam_filter/GeoFilterService.js';
import { ghostBusService } from '../spam_filter/GhostBusService.js';

class BusTrackingApp {
  constructor() {
    this.refreshInterval = null;
  }

  async initialize() {
    mapService.initializeMap();
    await Promise.all([
      dataService.carregarTrips(),
      dataService.carregarCalendar(),
      geoFilterService.carregarPolygons(),
      ghostBusService.loadGhostBuses()
    ]);
    
    // Recarregar ghost buses automaticamente a cada 10 minutos
    ghostBusService.startAutoReload(10);
    
    this.setupGeolocation();
    this.setupEventListeners();
    this.forceRefresh();
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

    // Filtrar geofencing
    if (filterValue == '') {
      busData = busData.filter(bus => {
        return !geoFilterService.pontoProximoDePoligono(bus.latitude, bus.longitude);
      });
    }

    // Filtrar ghost buses usando lista atualizada pelo GitHub Actions
    busData = busData.filter(bus => {
      return !ghostBusService.isGhostVehicle(bus.id);
    });

    mapService.updateBusMarkers(busData);
  }
}

const app = new BusTrackingApp();
window.onload = () => app.initialize();
