import { stopService } from './stopService.js';
import { createBusIcon } from '../resources/busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../resources/busDesign/busColors.js';
import { initializeMapWithControls, createCenterControl } from '../realtime_bus_map/mapUtils.js';

class StopView {
  constructor() {
    this.stopId = null;
    this.map = null;
    this.busMarkers = {};
    this.stopMarker = null;
    this.refreshTimeout = null;
    this.iconCache = {};
    this.lastBusPositions = [];
  }

  getLineColors(line) {
    if (!line) return { busColor: '#0072C6', textColor: '#fff' };
    if (BUS_COLORS[line]) {
      return BUS_COLORS[line];
    }
    
    const prefix = line[0];
    if (BUS_COLORS[prefix]) {
      return BUS_COLORS[prefix];
    }
  
    return { busColor: '#0072C6', textColor: '#fff' };
  }

  async initialize() {
    try {
      this.stopId = this.getStopIdFromUrl();
      
      if (!this.stopId) {
        this.showError('Código de paragem não especificado.');
        return;
      }

      console.log(`Inicializando vista para paragem: ${this.stopId}`);
      
      const { map } = initializeMapWithControls('map', [41.1579, -8.6291], 15);
      this.map = map;
      
      const centerControl = createCenterControl(this.map, () => {
        if (this.lastBusPositions.length > 0) {
          const bounds = L.latLngBounds(this.lastBusPositions);
          return bounds.getCenter();
        }
        return null;
      });
      centerControl.addTo(this.map);
      
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

  async loadStopData() {
    try {
      const stopData = await stopService.fetchStopRealtime(this.stopId);
      
      if (!stopData) {
        this.showError('Não foi possível carregar dados da paragem.');
        return;
      }

      const titleElement = document.getElementById('stop-title');
      if (titleElement && stopData.stop_name) {
        titleElement.textContent = `Paragem: ${stopData.stop_name}`;
      }

      this.displayArrivals(stopData.arrivals || []);

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
      
      const lineColors = this.getLineColors(arrival.route_short_name);
      const lineColor = lineColors.busColor;
      const textColor = lineColors.textColor;
      
      return `
        <div class="arrival-item">
          <div class="arrival-line" style="background-color: ${lineColor}; color: ${textColor};">
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
      this.lastBusPositions = [];
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

    this.lastBusPositions = busPositions;

    Object.keys(this.busMarkers).forEach(id => {
      if (!validIDs.has(id)) {
        this.map.removeLayer(this.busMarkers[id]);
        delete this.busMarkers[id];
      }
    });

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
