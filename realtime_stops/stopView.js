import { stopService } from './stopService.js';
import { createBusIcon } from '../resources/busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../resources/busDesign/busColors.js';
import { initializeMapWithControls, createCenterControl } from '../realtime_bus_map/mapUtils.js';
import { eventBus } from './eventBus.js';

class StopView {
  constructor() {
    this.stopId = null;
    this.map = null;
    this.busMarkers = {};
    this.stopMarker = null;
    this.refreshTimeout = null;
    this.iconCache = {};
    this.lastBusPositions = [];
    this.vehicleIdToArrival = new Map();
    this.lastUpdateTime = null;
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
      
      eventBus.on('arrivalClicked', (data) => this.handleArrivalClick(data));
      
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
      console.log('🔄 Iniciando carregamento de dados para paragem:', this.stopId);

      const stopData = await stopService.fetchStopRealtime(this.stopId);

      console.log('📍 Dados da paragem recebidos:', {
        stop_name: stopData?.stop_name,
        arrivals_count: stopData?.arrivals?.length || 0,
        has_data: !!stopData
      });

      if (!stopData) {
        this.showError('Não foi possível carregar dados da paragem.');
        return;
      }

      const titleElement = document.getElementById('stop-title');
      if (titleElement && stopData.stop_name) {
        titleElement.textContent = `Paragem: ${stopData.stop_name}`;
      }

      if (!stopData.arrivals || stopData.arrivals.length === 0) {
        console.log('⚠ Nenhuma chegada prevista nesta paragem');
        this.displayArrivals([], []);
        this.clearBusMarkers();
        this.updateLastUpdateTime();
        return;
      }

      console.log('🚌 A carregar dados de veículos em tempo real...');

      const vehicles = await stopService.fetchVehicleData();

      console.log('🔍 Verificação de dados:', {
        stopDataReceived: !!stopData,
        arrivalsCount: stopData?.arrivals?.length || 0,
        vehiclesCount: vehicles?.length || 0,
        hasMap: !!this.map,
        mapReady: this.map?._loaded || false
      });

      console.log('🎨 A atualizar interface...');

      this.updateBusMap(stopData.arrivals, vehicles);
      this.displayArrivals(stopData.arrivals, vehicles);
      this.updateLastUpdateTime();

      console.log('✅ Dados carregados com sucesso:', {
        arrivals: stopData.arrivals.length,
        vehicles: vehicles.length,
        markers: Object.keys(this.busMarkers).length
      });

    } catch (error) {
      console.error('❌ Erro crítico ao carregar dados:', {
        error: error.message,
        stack: error.stack,
        stopId: this.stopId
      });
      this.showError('Erro ao atualizar informações.');
    }
  }

  displayArrivals(arrivals, vehicles) {
    const container = document.getElementById('arrivals-list');

    if (!container) {
      console.error('❌ Container arrivals-list não encontrado no DOM');
      return;
    }

    console.log('📋 A mostrar chegadas:', {
      arrivals: arrivals?.length || 0,
      vehicles: vehicles?.length || 0
    });

    if (!arrivals || arrivals.length === 0) {
      container.innerHTML = '<p class="no-arrivals">Não há chegadas previstas de momento. Consulte <a href="busmap.html"> aqui a localização em tempo real dos autocarros</a> ou verifique o horário planeado na paragem.</p>';
      return;
    }

    container.innerHTML = '';

    arrivals.forEach(arrival => {
      const vehicle = stopService.matchVehicleToTrip(vehicles, arrival.trip_id);
      const arrivalElement = this.createArrivalElement(arrival, vehicle);
      container.appendChild(arrivalElement);
    });
    console.log(`✓ ${arrivals.length} chegadas mostradas na interface`);
  }


  createArrivalElement(arrival, vehicle) {
    const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' : 'status-delayed';
    const lineColors = this.getLineColors(arrival.route_short_name);
    
    const div = document.createElement('div');
    div.className = 'arrival-item';
    
    if (vehicle) {
      const location = stopService.extractVehicleLocation(vehicle);
      if (location) {
        div.style.cursor = 'pointer';
        div.setAttribute('data-vehicle-id', vehicle.id);
        div.addEventListener('click', () => {
          eventBus.emit('arrivalClicked', {
            vehicleId: vehicle.id,
            location: location,
            arrival: arrival
          });
        });
      }
    }
    
    div.innerHTML = `
      <div class="arrival-line" style="background-color: ${lineColors.busColor}; color: ${lineColors.textColor};">
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
    `;
    
    return div;
  }

  handleArrivalClick(data) {
    const { vehicleId, location } = data;
    
    if (!location || !this.map) return;
    
    const coords = [location.latitude, location.longitude];
    this.map.setView(coords, 17, { animate: true, duration: 0.5 });
    
    if (this.busMarkers[vehicleId]) {
      this.busMarkers[vehicleId].openPopup();
    }
  }

  updateBusMap(arrivals, vehicles) {
    console.log('🗺️ A atualizar mapa:', {
      arrivals: arrivals?.length || 0,
      vehicles: vehicles?.length || 0,
      currentMarkers: Object.keys(this.busMarkers).length
    });

    if (!arrivals || arrivals.length === 0) {
      console.log('⚠ Sem chegadas, a limpar marcadores');
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
        } else {
          console.warn(`⚠ Localização não encontrada para veículo ${vehicle.id}`);
        }
      } else {
        console.warn(`⚠ Veículo não encontrado para trip_id: ${arrival.trip_id}`);
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
  updateLastUpdateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const timeString = `${hours}:${minutes}:${seconds}`;

    this.lastUpdateTime = timeString;

    const updateElement = document.getElementById('last-update-time');
    if (updateElement) {
      updateElement.innerHTML = `Última atualização: <strong>${timeString}</strong>`;
    }

    console.log(`⏰ Atualização registada às ${timeString}`);
  }
}

const stopView = new StopView();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => stopView.initialize());
} else {
  stopView.initialize();
}
