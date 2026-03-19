/**
 * NextArrivals - Componente de UI para mostrar pr\u00f3ximas chegadas numa paragem
 * Inclui chips de filtro por linha de autocarro.
 */

import { vehicleService } from '../../services/vehicleService.js';
import { LoadingSpinner } from './LoadingSpinner.js';

export class NextArrivals {
  constructor() {
    this.element = null;
    this.isVisible = false;
    this.onArrivalClickCallback = null;
    this.onCloseCallback = null;
    this.onRefreshCallback = null;
    this.currentStopId = null;
    this.loadingSpinner = null;

    // Estado dos filtros
    this.availableRoutes = [];   // [{id, number, name, color, text_color}]
    this.selectedRoutes = new Set(); // n\u00fameros das linhas seleccionadas
    this.allArrivals = [];        // todas as chegadas (sem filtro)
    this.allVehicles = [];        // todos os ve\u00edculos
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

      <!-- ⭐ Linha de filtros por rota -->
      <div id="arrivals-filter-bar" class="arrivals-filter-bar" style="display:none;">
        <span class="filter-label">Filtrar por:</span>
        <div id="arrivals-filter-chips" class="arrivals-filter-chips"></div>
      </div>

      <div class="next-arrivals-content">
        <div id="arrivals-list-panel" class="arrivals-list-panel panel-loading">
          <!-- Loading spinner aparece aqui -->
        </div>
      </div>

      <div class="next-arrivals-footer">
        <p id="arrivals-last-update">\u00daltima atualiza\u00e7\u00e3o: <strong>--:--:--</strong></p>
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

    sheet.querySelector('.next-arrivals-close').addEventListener('click', () => this.hide());
    sheet.querySelector('#arrivals-refresh-btn').addEventListener('click', () => {
      const btn = sheet.querySelector('#arrivals-refresh-btn');
      if (this.onRefreshCallback) {
        btn.classList.add('refreshing');
        this.showLoading('A atualizar...');
        this.onRefreshCallback();
        setTimeout(() => btn.classList.remove('refreshing'), 1000);
      }
    });

    return sheet;
  }

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------

  /**
   * Define as rotas dispon\u00edveis e renderiza os chips de filtro.
   * Chamado antes de setArrivals (em paralelo com o fetch de chegadas).
   * @param {Array} routes - [{id, number, name, color, text_color}]
   */
  setRoutes(routes = []) {
    this.availableRoutes = routes;
    this.selectedRoutes = new Set(); // limpar sele\u00e7\u00e3o ao mudar de paragem
    this._renderFilterBar();
  }

  /**
   * Toggle de uma linha no filtro.
   * Sem sele\u00e7\u00e3o = mostrar tudo.
   */
  _toggleRoute(routeNumber) {
    if (this.selectedRoutes.has(routeNumber)) {
      this.selectedRoutes.delete(routeNumber);
    } else {
      this.selectedRoutes.add(routeNumber);
    }
    this._renderFilterBar(); // re-renderiza chips para atualizar estado ativo/inativo
    this._renderArrivals();  // re-filtra a lista
  }

  _renderFilterBar() {
    if (!this.element) return;
    const bar = this.element.querySelector('#arrivals-filter-bar');
    const chipsContainer = this.element.querySelector('#arrivals-filter-chips');
    if (!bar || !chipsContainer) return;

    if (this.availableRoutes.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    chipsContainer.innerHTML = '';

    this.availableRoutes.forEach(route => {
      const isActive = this.selectedRoutes.has(route.number);
      const chip = document.createElement('button');
      chip.className = `filter-chip${isActive ? ' active' : ''}`;
      chip.style.backgroundColor = route.color || '#0072C6';
      chip.style.color = route.text_color || '#FFFFFF';
      chip.title = route.name || route.number;
      chip.textContent = route.number;
      chip.addEventListener('click', () => this._toggleRoute(route.number));
      chipsContainer.appendChild(chip);
    });
  }

  /**
   * Devolve as chegadas filtradas pelas linhas seleccionadas.
   * Se nenhuma linha seleccionada, devolve todas.
   */
  _getFilteredArrivals() {
    if (this.selectedRoutes.size === 0) return this.allArrivals;
    return this.allArrivals.filter(arrival => {
      const num = String(
        arrival.route_short_name ||
        arrival.route_number ||
        arrival.route_id ||
        ''
      );
      return this.selectedRoutes.has(num);
    });
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  showLoading(message = 'A carregar pr\u00f3ximas chegadas...') {
    if (!this.element) return;
    const listContainer = this.element.querySelector('#arrivals-list-panel');
    listContainer.classList.add('panel-loading');
    if (!this.loadingSpinner) {
      this.loadingSpinner = new LoadingSpinner({ size: 'medium', message });
    } else {
      this.loadingSpinner.setMessage(message);
    }
    this.loadingSpinner.show(listContainer);
  }

  hideLoading() {
    if (!this.element) return;
    this.element.querySelector('#arrivals-list-panel').classList.remove('panel-loading');
    if (this.loadingSpinner) this.loadingSpinner.remove();
  }

  // ---------------------------------------------------------------------------
  // Mostrar / Esconder painel
  // ---------------------------------------------------------------------------

  show(stopName, stopId = null) {
    if (!this.element) this.create();
    this.currentStopId = stopId;

    const titleEl = this.element.querySelector('#arrivals-stop-name');
    const codeEl = this.element.querySelector('#arrivals-stop-code');
    if (titleEl && stopName) titleEl.textContent = stopName;
    if (codeEl && stopId) codeEl.textContent = `C\u00f3digo: ${stopId}`;

    this.showLoading();
    this.element.classList.add('visible');
    this.isVisible = true;
  }

  hide() {
    if (this.element) {
      this.element.classList.remove('visible');
      this.isVisible = false;
      this.currentStopId = null;
      this.hideLoading();
      // Limpar estado de filtros ao fechar
      this.availableRoutes = [];
      this.selectedRoutes = new Set();
      this.allArrivals = [];
      this.allVehicles = [];
      this._renderFilterBar();
      if (this.onCloseCallback) this.onCloseCallback();
    }
  }

  // ---------------------------------------------------------------------------
  // Chegadas
  // ---------------------------------------------------------------------------

  setArrivals(arrivals, vehicles) {
    if (!this.element) return;
    this.hideLoading();
    this.allArrivals = arrivals || [];
    this.allVehicles = vehicles || [];
    this._renderArrivals();
  }

  _renderArrivals() {
    if (!this.element) return;
    const listContainer = this.element.querySelector('#arrivals-list-panel');
    const filtered = this._getFilteredArrivals();

    if (!filtered || filtered.length === 0) {
      if (this.allArrivals.length === 0) {
        // De facto n\u00e3o h\u00e1 chegadas
        listContainer.innerHTML = `
          <p class="no-arrivals">
            \u26a0\ufe0f N\u00e3o h\u00e1, de momento, localiza\u00e7\u00f5es dos autocarros previstos para esta paragem - pode ter que aguardar que estes iniciem viagem.<br><br>
            Consulte <a href="index.html">aqui a localiza\u00e7\u00e3o em tempo real de todos os autocarros</a> ou verifique o hor\u00e1rio planeado na paragem.
          </p>`;
      } else {
        // H\u00e1 chegadas mas o filtro n\u00e3o retorna nada
        listContainer.innerHTML = `
          <p class="no-arrivals">\u26a0\ufe0f Nenhuma chegada encontrada para as linhas seleccionadas.</p>`;
      }
      return;
    }

    listContainer.innerHTML = '';
    filtered.forEach(arrival => {
      const vehicle = arrival.is_realtime
        ? vehicleService.matchVehicleToTrip(this.allVehicles, arrival.trip_id)
        : null;
      listContainer.appendChild(this.createArrivalElement(arrival, vehicle));
    });
  }

  createArrivalElement(arrival, vehicle) {
    const statusClass = arrival.status === 'ON_TIME' ? 'status-ontime' :
      (arrival.status === 'SCHEDULED' ? 'status-scheduled' : 'status-delayed');
    const busColor = arrival.route_color || '#0072C6';
    const textColor = arrival.route_text_color || '#FFFFFF';
    const isRealtime = arrival.is_realtime === true;
    const hasLocation = isRealtime && vehicle &&
      vehicleService.extractVehicleLocation(vehicle) !== null;
    const locationIcon = hasLocation ? this.getActiveLocationIcon() : this.getInactiveLocationIcon();

    const div = document.createElement('div');
    div.className = 'arrival-item';

    if (hasLocation) {
      const location = vehicleService.extractVehicleLocation(vehicle);
      div.style.cursor = 'pointer';
      div.setAttribute('data-vehicle-id', vehicle.id);
      div.addEventListener('click', () => {
        if (this.onArrivalClickCallback) {
          this.onArrivalClickCallback({ vehicleId: vehicle.id, location, arrival });
        }
      });
    }

    let statusText = '';
    if (!isRealtime) {
      statusText = 'Planeado - localiza\u00e7\u00e3o desconhecida';
    } else {
      statusText = this.getStatusText(arrival.status);
      if (arrival.delay_minutes > 1)
        statusText += ` <span class="status-badge ${statusClass}">+${Math.round(arrival.delay_minutes)} min</span>`;
    }

    const timeClass = isRealtime ? 'arrival-time-realtime' : 'arrival-time-scheduled';

    div.innerHTML = `
      <div class="arrival-line" style="background-color: ${busColor}; color: ${textColor};">
        ${arrival.route_short_name}
      </div>
      <div class="arrival-info">
        <div class="arrival-destination">${arrival.trip_headsign}</div>
        <div class="arrival-status">${statusText}</div>
      </div>
      <div class="arrival-time-container">
        <div class="arrival-location-icon">${locationIcon}</div>
        <div class="arrival-time ${timeClass}">${this.formatArrivalTime(arrival.arrival_minutes)}</div>
      </div>
    `;
    return div;
  }

  // ---------------------------------------------------------------------------
  // Ic\u00f3nes, helpers
  // ---------------------------------------------------------------------------

  getActiveLocationIcon() {
    return `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 4 C15 4, 11 8, 11 13 C11 16, 13 19, 20 26 C27 19, 29 16, 29 13 C29 8, 25 4, 20 4 Z" fill="#2C2C2C"/>
        <circle cx="20" cy="13" r="4" fill="#FFFFFF"/>
        <path d="M18 13 L19.2 14.4 L22.4 11" stroke="#22C55E" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <circle cx="20" cy="32" r="2.4" fill="#22C55E"><animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite"/></circle>
        <path d="M 16.4 29 A 5 5 0 0 0 16.4 35" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></path>
        <path d="M 23.6 29 A 5 5 0 0 1 23.6 35" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></path>
        <path d="M 13.6 28 A 8 8 0 0 0 13.6 36" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.2s" repeatCount="indefinite"/></path>
        <path d="M 26.4 28 A 8 8 0 0 1 26.4 36" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.2s" repeatCount="indefinite"/></path>
        <path d="M 10.8 27 A 11 11 0 0 0 10.8 37" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.4s" repeatCount="indefinite"/></path>
        <path d="M 29.2 27 A 11 11 0 0 1 29.2 37" stroke="#22C55E" stroke-width="2" fill="none" stroke-linecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" begin="0.4s" repeatCount="indefinite"/></path>
      </svg>`;
  }

  getInactiveLocationIcon() {
    return `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 3 C15 3, 11 7, 11 12 C11 15, 13 18, 20 25 C27 18, 29 15, 29 12 C29 7, 25 3, 20 3 Z" fill="#2C2C2C"/>
        <circle cx="20" cy="12" r="4.4" fill="#FFFFFF"/>
        <path d="M17 9 L23 15 M23 9 L17 15" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round"/>
        <g transform="translate(0, 2)">
          <path d="M10 27 L30 27 L34 36 L6 36 Z" fill="#EF4444" fill-opacity="0.15" stroke="#EF4444" stroke-width="1.6" stroke-linejoin="round"/>
          <line x1="16.6" y1="27" x2="15.2" y2="36" stroke="#EF4444" stroke-width="1.2"/>
          <line x1="23.4" y1="27" x2="24.8" y2="36" stroke="#EF4444" stroke-width="1.2"/>
          <path d="M10 27 L20 36" stroke="#EF4444" stroke-width="1" stroke-linecap="round"/>
          <path d="M16 32 L30.8 30" stroke="#EF4444" stroke-width="1" stroke-linecap="round"/>
        </g>
      </svg>`;
  }

  getStatusText(status) {
    return { ON_TIME: 'No hor\u00e1rio', DELAYED: 'Atrasado', EARLY: 'Adiantado', SCHEDULED: 'Programado', ARRIVING: 'A chegar' }[status] || status;
  }

  formatArrivalTime(minutes) {
    if (minutes === undefined || minutes === null) return 'N/A';
    if (minutes < 1) return 'A chegar';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    return `${h}h${Math.round(minutes % 60).toString().padStart(2, '0')}`;
  }

  updateLastUpdate(timestamp) {
    if (!this.element) return;
    const el = this.element.querySelector('#arrivals-last-update');
    if (el) {
      const t = timestamp || new Date();
      el.innerHTML = `\u00daltima atualiza\u00e7\u00e3o: <strong>${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}</strong>`;
    }
  }

  onArrivalClick(callback) { this.onArrivalClickCallback = callback; }
  onClose(callback) { this.onCloseCallback = callback; }
  onRefresh(callback) { this.onRefreshCallback = callback; }

  destroy() {
    if (this.element) { this.element.remove(); this.element = null; }
    if (this.loadingSpinner) { this.loadingSpinner.remove(); this.loadingSpinner = null; }
  }
}
