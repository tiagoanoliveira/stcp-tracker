/**
 * NextArrivals - Componente de UI para mostrar próximas chegadas numa paragem
 * Aparece na metade inferior do ecrã sobre o mapa
 */

import { vehicleService } from '../../services/vehicleService.js';

export class NextArrivals {
  constructor() {
    this.element = null;
    this.isVisible = false;
    this.onArrivalClickCallback = null;
    this.onCloseCallback = null;
    this.onRefreshCallback = null;
    this.currentStopId = null;
  }

  create() {
    if (this.element) return this.element;

    const sheet = document.createElement('div');
    sheet.id = 'next-arrivals';
    sheet.className = 'next-arrivals';
    sheet.innerHTML = `
      <div class="next-arrivals-header">
        <div class="next-arrivals-title">
          <img src="./resources/paragem.png" alt="Paragem" class="next-arrivals-icon">
          <div class="next-arrivals-title-text">
            <h2 id="arrivals-stop-name">Paragem</h2>
            <p id="arrivals-stop-code" class="arrivals-stop-code"></p>
          </div>
        </div>
        <button class="next-arrivals-close" title="Fechar">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="next-arrivals-content">
        <div id="arrivals-list-panel" class="arrivals-list-panel">
          <p class="loading-message">A carregar...</p>
        </div>
      </div>
      <div class="next-arrivals-footer">
        <p id="arrivals-last-update">Última atualização: <strong>--:--:--</strong></p>
        <button class="next-arrivals-refresh" id="arrivals-refresh-btn" title="Atualizar">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(sheet);
    this.element = sheet;

    // Event listeners
    const closeBtn = sheet.querySelector('.next-arrivals-close');
    closeBtn.addEventListener('click', () => this.hide());

    const refreshBtn = sheet.querySelector('#arrivals-refresh-btn');
    refreshBtn.addEventListener('click', () => {
      if (this.onRefreshCallback) {
        refreshBtn.classList.add('refreshing');
        this.onRefreshCallback();
        setTimeout(() => refreshBtn.classList.remove('refreshing'), 1000);
      }
    });

    // Fechar ao clicar fora (opcional)
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) {
        this.hide();
      }
    });

    return sheet;
  }

  show(stopName, stopId = null) {
    if (!this.element) {
      this.create();
    }

    this.currentStopId = stopId;

    const titleElement = this.element.querySelector('#arrivals-stop-name');
    const codeElement = this.element.querySelector('#arrivals-stop-code');
    
    if (titleElement && stopName) {
      titleElement.textContent = stopName;
    }
    
    if (codeElement && stopId) {
      codeElement.textContent = `Código: ${stopId}`;
    }

    this.element.classList.add('visible');
    this.isVisible = true;
    console.log('✅ NextArrivals aberto');
  }

  hide() {
    if (this.element) {
      this.element.classList.remove('visible');
      this.isVisible = false;
      this.currentStopId = null;
      console.log('🚫 NextArrivals fechado');
      
      if (this.onCloseCallback) {
        this.onCloseCallback();
      }
    }
  }

  setArrivals(arrivals, vehicles) {
    if (!this.element) return;

    const listContainer = this.element.querySelector('#arrivals-list-panel');
    
    if (!arrivals || arrivals.length === 0) {
      listContainer.innerHTML = `
        <p class="no-arrivals">
          ⚠️ Foram registadas anomalias na informação prestada sobre as próximas chegadas em tempo real pela STCP.<br><br>
          Consulte <a href="index.html">aqui a localização em tempo real dos autocarros</a> ou verifique o horário planeado na paragem.
        </p>
      `;
      return;
    }

    listContainer.innerHTML = '';

    arrivals.forEach(arrival => {
      const vehicle = vehicleService.matchVehicleToTrip(vehicles, arrival.trip_id);
      const arrivalElement = this.createArrivalElement(arrival, vehicle);
      listContainer.appendChild(arrivalElement);
    });

    console.log(`✓ ${arrivals.length} chegadas mostradas no painel`);
  }

  createArrivalElement(arrival, vehicle) {
    const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' : 'status-delayed';
    
    // Usar cores da API (route_color e route_text_color)
    const busColor = arrival.route_color || '#0072C6';
    const textColor = arrival.route_text_color || '#FFFFFF';
    
    const div = document.createElement('div');
    div.className = 'arrival-item';
    
    // Se há veículo, adicionar click handler
    if (vehicle) {
      const location = vehicleService.extractVehicleLocation(vehicle);
      if (location) {
        div.style.cursor = 'pointer';
        div.setAttribute('data-vehicle-id', vehicle.id);
        div.addEventListener('click', () => {
          if (this.onArrivalClickCallback) {
            this.onArrivalClickCallback({
              vehicleId: vehicle.id,
              location: location,
              arrival: arrival
            });
          }
        });
      }
    }
    
    div.innerHTML = `
      <div class="arrival-line" style="background-color: ${busColor}; color: ${textColor};">
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

  getStatusText(status) {
    const statusMap = {
      'ON_TIME': 'No horário',
      'DELAYED': 'Atrasado',
      'EARLY': 'Adiantado',
      'SCHEDULED': 'Programado'
    };
    return statusMap[status] || status;
  }

  formatArrivalTime(minutes) {
    if (minutes === undefined || minutes === null) return 'N/A';
    
    if (minutes < 1) return 'A chegar';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h${mins.toString().padStart(2, '0')}`;
  }

  updateLastUpdate(timestamp) {
    if (!this.element) return;
    
    const updateElement = this.element.querySelector('#arrivals-last-update');
    if (updateElement) {
      const time = timestamp || new Date();
      const hours = time.getHours().toString().padStart(2, '0');
      const minutes = time.getMinutes().toString().padStart(2, '0');
      const seconds = time.getSeconds().toString().padStart(2, '0');
      updateElement.innerHTML = `Última atualização: <strong>${hours}:${minutes}:${seconds}</strong>`;
    }
  }

  onArrivalClick(callback) {
    this.onArrivalClickCallback = callback;
  }

  onClose(callback) {
    this.onCloseCallback = callback;
  }

  onRefresh(callback) {
    this.onRefreshCallback = callback;
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
