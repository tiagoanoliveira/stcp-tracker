// stopView.js - Controlador para a página de visualização de paragem individual
import { stopService } from './stopService.js';
import { createBusIcon } from '../../busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../../busDesign/busColors.js';

class StopView {
  constructor() {
    this.stopId = null;
    this.map = null;
    this.busMarkers = {};
    this.stopMarker = null;
    this.refreshTimeout = null;
    this.iconCache = {};
  }

  async initialize() {
    try {
      this.stopId = this.getStopIdFromUrl();
      
      if (!this.stopId) {
        this.showError('Código de paragem não especificado.');
        return;
      }

      console.log(`Inicializando vista para paragem: ${this.stopId}`);
      
      this.initializeMap();
      await this.loadStopData();
      this.startAutoRefresh();
      
      console.log('Vista da paragem inicializada');
    } catch (error) {
      console.error('Erro na inicialização:', error);
      this.showError('Erro ao carregar dados da paragem.');
    }
  }

  getStopIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  initializeMap() {
    this.map = L.map('map').setView([41.1579, -8.6291], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);
  }

  async loadStopData() {
    try {
      const stopData = await stopService.fetchStopRealtime(this.stopId);
      
      if (!stopData) {
        this.showError('Não foi possível carregar dados da paragem.');
        return;
      }

      // Atualizar título da página
      const titleElement = document.getElementById('stop-title');
      if (titleElement && stopData.stop_name) {
        titleElement.textContent = `Paragem: ${stopData.stop_name}`;
      }

      // Exibir próximas chegadas
      this.displayArrivals(stopData.arrivals || []);

      // Obter dados dos veículos e atualizar mapa
      const vehicles = await stopService.fetchVehicleData();
      this.updateBusMap(stopData.arrivals || [], vehicles);

    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      this.showError('Erro ao atualizar informações.');
    }
  }

  displayArrivals(arrivals) {
    const container = document.getElementById('arrivals-list');
    
    if (!container) return;

    if (!arrivals || arrivals.length === 0) {
      container.innerHTML = '<p class="no-arrivals">Não há autocarros previstos de momento.</p>';
      return;
    }

    container.innerHTML = arrivals.map(arrival => {
      const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' : 'status-delayed';
      const lineColor = BUS_COLORS[arrival.route_short_name]?.busColor || '#0072C6';
      
      return `
        <div class="arrival-item">
          <div class="arrival-line" style="background-color: ${lineColor};">
            ${arrival.route_short_name}
          </div>
          <div class="arrival-info">
            <div class="arrival-destination">${arrival.trip_headsign}</div>
            <div class="arrival-status">
              ${stopService.getStatusText(arrival.status)}
              ${arrival.delay_minutes > 1 ? `<span class="status-badge ${statusClass}">+${Math.round(arrival.delay_minutes)} min</span>` : ''}
            </div>
          </div>
          <div class="arrival-time">
            ${stopService.formatArrivalTime(arrival.arrival_minutes)}
          </div>
        </div>
      `;
    }).join('');
  }

  updateBusMap(arrivals, vehicles) {
    if (!arrivals || arrivals.length === 0) {
      this.clearBusMarkers();
      return;
    }

    const validIDs = new Set();
    const busPositions = [];

    arrivals.forEach(arrival => {
      const vehicle = stopService.matchVehicleToTrip(vehicles, arrival.trip_id);
      
      if (vehicle) {
        const location = stopService.extractVehicleLocation(vehicle);
        
        if (location) {
          const busId = vehicle.id;
          validIDs.add(busId);
          busPositions.push([location.latitude, location.longitude]);

          const popupContent = `
            Linha: ${arrival.route_short_name}<br>
            Destino: ${arrival.trip_headsign}<br>
            Chega em: ${stopService.formatArrivalTime(arrival.arrival_minutes)}<br>
            Velocidade: ${location.speed} km/h
          `;

          if (this.busMarkers[busId]) {
            this.busMarkers[busId].setLatLng([location.latitude, location.longitude]);
            this.busMarkers[busId].setIcon(this.getBusIcon(arrival.route_short_name));
            this.busMarkers[busId].bindPopup(popupContent);
          } else {
            const marker = L.marker([location.latitude, location.longitude], {
              icon: this.getBusIcon(arrival.route_short_name)
            }).addTo(this.map);
            marker.bindPopup(popupContent);
            this.busMarkers[busId] = marker;
          }
        }
      }
    });

    // Remover marcadores antigos
    Object.keys(this.busMarkers).forEach(id => {
      if (!validIDs.has(id)) {
        this.map.removeLayer(this.busMarkers[id]);
        delete this.busMarkers[id];
      }
    });

    // Ajustar vista do mapa se houver autocarros
    if (busPositions.length > 0) {
      const bounds = L.latLngBounds(busPositions);
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }

  getBusIcon(line) {
    if (this.iconCache[line]) return this.iconCache[line];
    this.iconCache[line] = createBusIcon(line, BUS_COLORS, CUSTOM_LINE_TEXTS);
    return this.iconCache[line];
  }

  clearBusMarkers() {
    Object.values(this.busMarkers).forEach(marker => this.map.removeLayer(marker));
    this.busMarkers = {};
  }

  startAutoRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    const refresh = async () => {
      try {
        await this.loadStopData();
      } catch (error) {
        console.error('Erro na atualização automática:', error);
      } finally {
        this.refreshTimeout = setTimeout(refresh, stopService.refreshInterval);
      }
    };

    this.refreshTimeout = setTimeout(refresh, stopService.refreshInterval);
  }

  showError(message) {
    const container = document.getElementById('arrivals-list');
    if (container) {
      container.innerHTML = `<p class="no-arrivals">${message}</p>`;
    }
  }
}

const stopView = new StopView();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => stopView.initialize());
} else {
  stopView.initialize();
}
