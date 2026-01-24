/**
 * ArrivalsList - Componente para mostrar lista de chegadas previstas numa paragem
 */

import { eventBus } from '../../core/eventBus.js';
import { BUS_COLORS } from '../../../resources/busDesign/busColors.js';

export class ArrivalsList {
  constructor(elementId = 'arrivals-list') {
    this.elementId = elementId;
    this.element = null;
  }

  /**
   * Inicializar componente
   */
  initialize() {
    this.element = document.getElementById(this.elementId);
    if (!this.element) {
      console.warn(`⚠ Elemento #${this.elementId} não encontrado`);
    }
  }

  /**
   * Renderizar lista de chegadas
   */
  render(arrivals, vehicles = []) {
    if (!this.element) {
      this.initialize();
      if (!this.element) return;
    }

    console.log(`📋 A mostrar ${arrivals.length} chegadas`);

    if (!arrivals || arrivals.length === 0) {
      this.element.innerHTML = `
        <p class="no-arrivals">
          ⚠️ Foram registadas anomalias na informação prestada sobre as próximas chegadas em tempo real pela STCP.<br><br>
          Consulte <a href="busmap.html">aqui a localização em tempo real dos autocarros</a> ou verifique o horário planeado na paragem.
        </p>
      `;
      return;
    }

    this.element.innerHTML = '';

    arrivals.forEach(arrival => {
      const arrivalElement = this.createArrivalElement(arrival, vehicles);
      this.element.appendChild(arrivalElement);
    });

    console.log(`✓ ${arrivals.length} chegadas mostradas`);
  }

  /**
   * Criar elemento de chegada
   */
  createArrivalElement(arrival, vehicles) {
    const vehicle = this.matchVehicleToTrip(vehicles, arrival.trip_id);
    const lineColors = this.getLineColors(arrival.route_short_name);
    const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' : 'status-delayed';

    const div = document.createElement('div');
    div.className = 'arrival-item';

    // Se houver veículo associado, tornar clicável
    if (vehicle) {
      const location = this.extractVehicleLocation(vehicle);
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
          ${this.getStatusText(arrival.status)}
          ${arrival.delay_minutes > 1 ? `<span class="status-badge ${statusClass}">+${Math.round(arrival.delay_minutes)} min</span>` : ''}
        </div>
      </div>
      <div class="arrival-time">
        ${this.formatArrivalTime(arrival.arrival_minutes)}
      </div>
    `;

    return div;
  }

  /**
   * Obter cores da linha
   */
  getLineColors(line) {
    if (!line) return { busColor: '#0072C6', textColor: '#fff' };
    if (BUS_COLORS[line]) return BUS_COLORS[line];
    
    const prefix = line[0];
    if (BUS_COLORS[prefix]) return BUS_COLORS[prefix];
    
    return { busColor: '#0072C6', textColor: '#fff' };
  }

  /**
   * Fazer match entre veículo e trip
   */
  matchVehicleToTrip(vehicles, tripId) {
    if (!vehicles || !tripId) return null;
    
    return vehicles.find(v => {
      if (!v.annotations || !v.annotations.value) return false;
      
      for (const annotation of v.annotations.value) {
        const decoded = decodeURIComponent(annotation);
        if (decoded.startsWith('stcp:trip:') && decoded.slice(10) === tripId) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Extrair localização do veículo
   */
  extractVehicleLocation(vehicle) {
    if (!vehicle || !vehicle.location || !vehicle.location.value) return null;
    
    const coords = vehicle.location.value.coordinates;
    if (!coords || coords.length < 2) return null;
    
    return {
      latitude: coords[1],
      longitude: coords[0],
      speed: vehicle.speed ? vehicle.speed.value : 'N/A'
    };
  }

  /**
   * Formatar tempo de chegada
   */
  formatArrivalTime(minutes) {
    if (minutes === null || minutes === undefined) return 'N/A';
    if (minutes < 1) return 'A chegar';
    if (minutes === 1) return '1 min';
    return `${Math.round(minutes)} min`;
  }

  /**
   * Obter texto de status
   */
  getStatusText(status) {
    const statusMap = {
      'ON_TIME': 'No horário',
      'DELAYED': 'Atrasado',
      'EARLY': 'Adiantado',
      'CANCELED': 'Cancelado'
    };
    return statusMap[status] || status;
  }

  /**
   * Mostrar mensagem de erro
   */
  showError(message) {
    if (!this.element) {
      this.initialize();
      if (!this.element) return;
    }

    this.element.innerHTML = `<p class="no-arrivals">${message}</p>`;
  }

  /**
   * Limpar lista
   */
  clear() {
    if (this.element) {
      this.element.innerHTML = '';
    }
  }
}
