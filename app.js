import { dataService } from './dataService.js';
import { mapService } from './mapService.js';
import { geoFilterService } from './GeoFilterService.js';

class BusTrackingApp {
  constructor() {
    this.refreshInterval = null;
  }

  async initialize() {
    mapService.initializeMap();
    await Promise.all([
      dataService.carregarTrips(),
      dataService.carregarCalendar(),
      geoFilterService.carregarPolygons()
    ]);
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

    // Se não for a password especial, filtrar ônibus perto das áreas interiores
    if (filterValue == '') {
      busData = busData.filter(bus => {
        return !geoFilterService.pontoProximoDePoligono(bus.latitude, bus.longitude);
      });
    }

    mapService.updateBusMarkers(busData);
  }
}

const app = new BusTrackingApp();
window.onload = () => app.initialize();
