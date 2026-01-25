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
          ⚠️ Não há, de momento, localizações dos autocarros previstos para esta paragem - pode ter que aguardar que estes iniciem viagem.<br><br>
          Consulte <a href="index.html">aqui a localização em tempo real de todos os autocarros</a> ou verifique o horário planeado na paragem.
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
    
    // Verificar se há localização do autocarro
    const hasLocation = vehicle && vehicleService.extractVehicleLocation(vehicle) !== null;
    const locationIcon = hasLocation ? this.getActiveLocationIcon() : this.getInactiveLocationIcon();
    
    const div = document.createElement('div');
    div.className = 'arrival-item';
    
    // Se há veículo com localização, adicionar click handler
    if (hasLocation) {
      const location = vehicleService.extractVehicleLocation(vehicle);
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
      <div class="arrival-time-container">
        <div class="arrival-location-icon">
          ${locationIcon}
        </div>
        <div class="arrival-time">
          ${this.formatArrivalTime(arrival.arrival_minutes)}
        </div>
      </div>
    `;
    
    return div;
  }

  getActiveLocationIcon() {
    return `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <!-- Pin de localização -->
        <path d="M10 2 C7.5 2, 5.5 4, 5.5 6.5 C5.5 8, 6.5 9.5, 10 13 C13.5 9.5, 14.5 8, 14.5 6.5 C14.5 4, 12.5 2, 10 2 Z" 
              fill="#2C2C2C"/>
        
        <!-- Círculo branco interior -->
        <circle cx="10" cy="6.5" r="2" fill="#FFFFFF"/>
        
        <!-- Checkmark -->
        <path d="M9 6.5 L9.6 7.2 L11.2 5.5" 
              stroke="#22C55E" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        
        <!-- Círculo central -->
        <circle cx="10" cy="16" r="1.2" fill="#22C55E">
          <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        
        <!-- Ondas de sinal (arcos laterais) -->
        <!-- Onda 1 esquerda (interior) -->
        <path d="M 8.2 14.5 A 2.5 2.5 0 0 0 8.2 17.5" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>
        </path>
        
        <!-- Onda 1 direita (interior) -->
        <path d="M 11.8 14.5 A 2.5 2.5 0 0 1 11.8 17.5" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>
        </path>
        
        <!-- Onda 2 esquerda (meio) -->
        <path d="M 6.8 14 A 4 4 0 0 0 6.8 18" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.2s" repeatCount="indefinite"/>
        </path>
        
        <!-- Onda 2 direita (meio) -->
        <path d="M 13.2 14 A 4 4 0 0 1 13.2 18" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.2s" repeatCount="indefinite"/>
        </path>
        
        <!-- Onda 3 esquerda (exterior) -->
        <path d="M 5.4 13.5 A 5.5 5.5 0 0 0 5.4 18.5" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.4s" repeatCount="indefinite"/>
        </path>
        
        <!-- Onda 3 direita (exterior) -->
        <path d="M 14.6 13.5 A 5.5 5.5 0 0 1 14.6 18.5" 
              stroke="#22C55E" stroke-width="1" fill="none" stroke-linecap="round">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.4s" repeatCount="indefinite"/>
        </path>
      </svg>
    `;
  }

  getInactiveLocationIcon() {
    return `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <!-- 1. Pin de Localização -->
        <path d="M10 1.5 C7.5 1.5, 5.5 3.5, 5.5 6 C5.5 7.5, 6.5 9, 10 12.5 C13.5 9, 14.5 7.5, 14.5 6 C14.5 3.5, 12.5 1.5, 10 1.5 Z" 
              fill="#2C2C2C"/>
        
        <!-- Círculo branco interior -->
        <circle cx="10" cy="6" r="2.2" fill="#FFFFFF"/>
        
        <!-- X (Vermelho) -->
        <path d="M8.5 4.5 L11.5 7.5 M11.5 4.5 L8.5 7.5" 
              stroke="#EF4444" stroke-width="0.9" stroke-linecap="round"/>
        
        <!-- 2. Mapa em Perspetiva (Trapézio) -->
        <g transform="translate(0, 1)"> <!-- Ajuste fino de posição vertical -->
          <!-- Contorno do Mapa -->
          <!-- A forma é um trapézio: mais estreito em cima, mais largo em baixo -->
          <path d="M5 13.5 L15 13.5 L17 18 L3 18 Z" 
                fill="#EF4444" fill-opacity="0.15" stroke="#EF4444" stroke-width="0.8" stroke-linejoin="round"/>
          
          <!-- Linhas de dobra (dividem o mapa em 3 secções) -->
          <!-- Linha esquerda -->
          <line x1="8.3" y1="13.5" x2="7.6" y2="18" stroke="#EF4444" stroke-width="0.6"/>
          
          <!-- Linha direita -->
          <line x1="11.7" y1="13.5" x2="12.4" y2="18" stroke="#EF4444" stroke-width="0.6"/>
          
          <!-- Pequenos detalhes de rua (opcional, para reforçar a ideia) -->
          <path d="M5 13.5 L10 18" stroke="#EF4444" stroke-width="0.5" stroke-linecap="round"/>
          <path d="M8 16 L15.4 15" stroke="#EF4444" stroke-width="0.5" stroke-linecap="round"/>
        </g>
      </svg>
    `;
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
