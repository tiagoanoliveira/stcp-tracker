// stopsMapApp.js - Controlador para a vista de mapa de paragens
import { loadStopsData, getAllStops, getNearbyStops, searchStops } from './stopsData.js';

class StopsMapApp {
  constructor() {
    this.map = null;
    this.userPosition = null;
    this.stopMarkers = [];
    this.userMarker = null;
  }

  async initialize() {
    try {
      console.log('Inicializando mapa de paragens...');
      
      // Carregar dados das paragens
      await loadStopsData();
      
      this.initializeMap();
      this.setupGeolocation();
      this.setupEventListeners();
      this.displayAllStops();
      console.log('Mapa de paragens inicializado');
    } catch (error) {
      console.error('Erro na inicialização do mapa de paragens:', error);
    }
  }

  initializeMap() {
    this.map = L.map('map').setView([41.1579, -8.6291], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);
  }

  setupGeolocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          this.userPosition = [position.coords.latitude, position.coords.longitude];
          this.addUserMarker();
          this.displayNearbyStops();
        },
        error => {
          console.warn('Não foi possível obter a localização:', error);
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
      );
    }
  }

  addUserMarker() {
    if (!this.userPosition) return;

    const userIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34]
    });

    if (this.userMarker) {
      this.map.removeLayer(this.userMarker);
    }

    this.userMarker = L.marker(this.userPosition, {
      icon: userIcon,
      title: "Você está aqui"
    }).addTo(this.map).bindPopup("Localização Atual");
  }

  displayAllStops() {
    this.clearStopMarkers();
    const stops = getAllStops();
    stops.forEach(stop => this.addStopMarker(stop));
  }

  displayNearbyStops() {
    if (!this.userPosition) {
      this.displayAllStops();
      return;
    }

    this.clearStopMarkers();
    const nearbyStops = getNearbyStops(this.userPosition[0], this.userPosition[1], 2000);
    
    if (nearbyStops.length > 0) {
      nearbyStops.forEach(stop => this.addStopMarker(stop, true));
      this.map.setView(this.userPosition, 15);
    } else {
      this.displayAllStops();
    }
  }

  addStopMarker(stop, showDistance = false) {
  // Opção 2: SVG inline - ícone de paragem de autocarro moderno
  const stopIcon = L.divIcon({
    className: 'custom-stop-marker',
    html: `
      <div style="position: relative;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0072C6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <!-- Poste da paragem -->
          <line x1="12" y1="3" x2="12" y2="21" />
          <!-- Placa da paragem -->
          <rect x="4" y="3" width="16" height="11" rx="1" fill="#5EDDC1" stroke="#0072C6"/>
          <!-- Símbolo de autocarro na placa -->
          <rect x="7" y="6" width="10" height="4" rx="0.5" fill="#0072C6"/>
          <circle cx="9" cy="11.2" r="0.5" fill="white"/>
          <circle cx="15" cy="11.2" r="0.5" fill="white"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });

  let popupContent = `<b>${stop.stop_name}</b><br>Código: ${stop.stop_id}`;
  if (showDistance && stop.distance) {
    popupContent += `<br>Distância: ${Math.round(stop.distance)}m`;
  }
  popupContent += `<br><a href="stop.html?id=${stop.stop_id}" style="color: #0072C6; font-weight: bold;">Ver horários →</a>`;

  const marker = L.marker([stop.latitude, stop.longitude], {
    icon: stopIcon,
    title: stop.stop_name
  }).addTo(this.map);

  marker.bindPopup(popupContent);
  
  marker.on('click', () => {
    this.map.setView([stop.latitude, stop.longitude], 16);
  });

  this.stopMarkers.push(marker);
}


  clearStopMarkers() {
    this.stopMarkers.forEach(marker => this.map.removeLayer(marker));
    this.stopMarkers = [];
  }

  setupEventListeners() {
    const searchBtn = document.getElementById('search-stop');
    const searchInput = document.getElementById('stop-search');
    const centerBtn = document.getElementById('center-user-stops');

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => this.handleSearch());
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleSearch();
        }
      });
    }

    if (centerBtn) {
      centerBtn.addEventListener('click', () => this.centerOnUser());
    }
  }

  handleSearch() {
    const searchInput = document.getElementById('stop-search');
    const query = searchInput.value.trim();

    if (!query) {
      this.displayNearbyStops();
      return;
    }

    const results = searchStops(query);
    this.clearStopMarkers();

    if (results.length === 0) {
      alert('Nenhuma paragem encontrada.');
      return;
    }

    results.forEach(stop => this.addStopMarker(stop));

    if (results.length === 1) {
      this.map.setView([results[0].latitude, results[0].longitude], 16);
    } else {
      const bounds = L.latLngBounds(results.map(s => [s.latitude, s.longitude]));
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  centerOnUser() {
    if (this.userPosition) {
      this.map.setView(this.userPosition, 16);
      this.displayNearbyStops();
    } else {
      alert('Localização do utilizador não disponível.');
    }
  }
}

const app = new StopsMapApp();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.initialize());
} else {
  app.initialize();
}
