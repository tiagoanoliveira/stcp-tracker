import { loadStopsData, getAllStops, getNearbyStops, searchStops } from './stopsData.js';
import { initializeMapWithControls, createUserMarker, createCenterControl } from '../realtime_bus_map/mapUtils.js';

class StopsMapApp {
  constructor() {
    this.map = null;
    this.userPosition = null;
    this.stopMarkers = [];
    this.userMarker = null;
    this.centerControl = null;
  }

  async initialize() {
    try {
      console.log('Inicializando mapa de paragens...');
      await loadStopsData();
      
      const { map } = initializeMapWithControls('map', [41.1579, -8.6291], 13);
      this.map = map;
      
      this.setupGeolocation();
      this.setupEventListeners();
      this.displayAllStops();
      console.log('Mapa de paragens inicializado');
    } catch (error) {
      console.error('Erro na inicialização do mapa de paragens:', error);
    }
  }

  setupGeolocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          this.userPosition = [position.coords.latitude, position.coords.longitude];
          console.log('Posição obtida:', this.userPosition); // Debug
          
          this.userMarker = createUserMarker(this.map, this.userPosition);
          
          // Adicionar controle de centrar
          this.centerControl = createCenterControl(this.map, () => {
            console.log('getUserPosition chamado, retornando:', this.userPosition); // Debug
            return this.userPosition;
          });
          this.centerControl.addTo(this.map);
          console.log('Controle de centrar adicionado'); // Debug
          
          this.displayNearbyStops();
        },
        error => {
          console.warn('Não foi possível obter a localização:', error);
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
      );
    } else {
      console.warn('Geolocalização não suportada pelo navegador');
    }
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
    const stopIcon = L.divIcon({
      className: 'custom-stop-marker',
      html: `
        <div style="position: relative;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0072C6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="3" x2="12" y2="21" />
            <rect x="4" y="3" width="16" height="11" rx="1" fill="#5EDDC1" stroke="#0072C6"/>
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
