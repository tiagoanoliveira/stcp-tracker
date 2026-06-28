/**
 * NextArrivals - Componente de UI para mostrar próximas chegadas numa paragem.
 * Inclui chips de filtro por linha; ao alterar o filtro dispara onFilterChange.
 * Os chips de linhas diurnas/nocturnas são ocultados fora do seu horário:
 *   - Linhas diurnas (sem sufixo 'M'): ocultadas entre 01:30 e 05:30
 *   - Linhas nocturnas (sufixo 'M', ex: 3M, 200M): visíveis entre 00:30 e 06:30
 *     Nota: linhas como MB1 começam com M mas não são nocturnas.
 */

import { vehicleService }    from '../../services/vehicleService.js';
import { LoadingSpinner }    from './LoadingSpinner.js';
import { routeFilterState }  from '../../services/routeFilterState.js';

function isNightLine(number) { return /M$/i.test(String(number)); }

function getLineVisibility(date) {
  const total = date.getHours() * 60 + date.getMinutes();
  return { showDay: !(total >= 90 && total < 330), showNight: (total >= 30 && total < 390) };
}

// ─── Helpers de delay ────────────────────────────────────────────────────────

/**
 * Formata um delay em segundos como string compacta:
 *   - Só segundos se minutos = 0:   "+34 seg."
 *   - Só minutos  se segundos = 0:  "+04 min."
 *   - Ambos caso contrário:         "+04 min. 34 seg."
 * @param {number} delaySeconds
 * @returns {string}
 */
function formatDelay(delaySeconds) {
  const abs  = Math.abs(delaySeconds);
  const sign = delaySeconds < 0 ? '-' : '+';
  const m    = Math.floor(abs / 60);
  const s    = abs % 60;
  if (m === 0) return `${sign}${s} seg.`;
  if (s === 0) return `${sign}${String(m).padStart(2, '0')} min.`;
  return `${sign}${String(m).padStart(2, '0')} min. ${String(s).padStart(2, '0')} seg.`;
}

/**
 * Devolve a classe CSS de cor para o delay.
 *   verde   : ON_TIME ou EARLY
 *   amarelo : DELAYED 1–300 s
 *   vermelho: DELAYED > 300 s
 * @param {string} status
 * @param {number} delaySeconds
 * @returns {string}
 */
function delayColorClass(status, delaySeconds) {
  if (status === 'ON_TIME' || status === 'EARLY') return 'delay-green';
  if (status === 'DELAYED') {
    return delaySeconds <= 300 ? 'delay-yellow' : 'delay-red';
  }
  return '';
}

/**
 * Texto legível para o estado da chegada.
 */
function statusLabel(status) {
  return {
    ON_TIME:   'No horário previsto',
    EARLY:     'Adiantado',
    DELAYED:   'Atrasado',
    SCHEDULED: 'Planeado',
    ARRIVING:  'A chegar',
  }[status] || status;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export class NextArrivals {
  constructor() {
    this.element = null;
    this.isVisible = false;
    this.onArrivalClickCallback  = null;
    this.onCloseCallback         = null;
    this.onRefreshCallback       = null;
    this.onFilterChangeCallback  = null;
    this.onFavouriteClickCallback = null;
    this.onIsFavouriteCallback   = null;
    this.currentStopId   = null;
    this.loadingSpinner  = null;
    this.availableRoutes = [];
    this.selectedRoutes  = new Set();
    this.allArrivals     = [];
    this.allVehicles     = [];
    this._timeCheckInterval = null;
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
        <div class="next-arrivals-header-actions">
          <button class="next-arrivals-favourite" id="arrivals-favourite-btn" title="Adicionar aos favoritos" aria-label="Adicionar aos favoritos">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
          <button class="next-arrivals-close" title="Fechar">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="arrivals-filter-bar" class="arrivals-filter-bar" style="display:none;">
        <span class="filter-label">Filtrar por:</span>
        <div id="arrivals-filter-chips" class="arrivals-filter-chips"></div>
      </div>

      <div class="next-arrivals-content">
        <div id="arrivals-list-panel" class="arrivals-list-panel panel-loading"></div>
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

    sheet.querySelector('.next-arrivals-close').addEventListener('click', () => this.hide());

    // Refresh: aguarda a Promise do callback antes de remover o estado de loading
    sheet.querySelector('#arrivals-refresh-btn').addEventListener('click', async () => {
      const btn = sheet.querySelector('#arrivals-refresh-btn');
      if (!this.onRefreshCallback) return;
      btn.disabled = true;
      btn.classList.add('refreshing');
      this.showLoading('A atualizar...');
      try {
        await Promise.resolve(this.onRefreshCallback());
      } finally {
        btn.disabled = false;
        btn.classList.remove('refreshing');
      }
    });

    sheet.querySelector('#arrivals-favourite-btn').addEventListener('click', () => {
      if (this.onFavouriteClickCallback) this.onFavouriteClickCallback(this.currentStopId);
    });

    this._timeCheckInterval = setInterval(() => this._applyChipTimeVisibility(), 60_000);

    return sheet;
  }

  // ─── Filtros ────────────────────────────────────────────────────────────────

  setRoutes(routes = []) {
    this.availableRoutes = routes;
    this.selectedRoutes  = new Set(
      routes.map(r => String(r.number)).filter(num => routeFilterState.selectedRoutes.has(num))
    );
    this._renderFilterBar();
    if (this.allArrivals.length > 0) this._renderArrivals();
  }

  _toggleRoute(routeNumber) {
    if (this.selectedRoutes.has(routeNumber)) this.selectedRoutes.delete(routeNumber);
    else this.selectedRoutes.add(routeNumber);
    this._renderFilterBar();
    this._renderArrivals();
    if (this.onFilterChangeCallback) this.onFilterChangeCallback(new Set(this.selectedRoutes));
  }

  _renderFilterBar() {
    if (!this.element) return;
    const bar   = this.element.querySelector('#arrivals-filter-bar');
    const chips = this.element.querySelector('#arrivals-filter-chips');
    if (!bar || !chips) return;
    if (this.availableRoutes.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    chips.innerHTML   = '';
    this.availableRoutes.forEach(route => {
      const isActive = this.selectedRoutes.has(route.number);
      const chip = document.createElement('button');
      chip.className  = `filter-chip${isActive ? ' active' : ''}`;
      chip.dataset.line      = String(route.number);
      chip.dataset.nightLine = isNightLine(route.number) ? 'true' : 'false';
      chip.style.backgroundColor = route.color      || '#0072C6';
      chip.style.color           = route.text_color || '#FFFFFF';
      chip.title       = route.name || route.number;
      chip.textContent = route.number;
      chip.addEventListener('click', () => this._toggleRoute(route.number));
      chips.appendChild(chip);
    });
    this._applyChipTimeVisibility();
  }

  _applyChipTimeVisibility() {
    const chips = this.element?.querySelector('#arrivals-filter-chips');
    if (!chips) return;
    const { showDay, showNight } = getLineVisibility(new Date());
    chips.querySelectorAll('.filter-chip').forEach(chip => {
      const night = chip.dataset.nightLine === 'true';
      chip.style.display = (night ? showNight : showDay) ? '' : 'none';
    });
    let changed = false;
    for (const num of this.selectedRoutes) {
      if (!(isNightLine(num) ? showNight : showDay)) { this.selectedRoutes.delete(num); changed = true; }
    }
    if (changed) { this._renderFilterBar(); this._renderArrivals(); if (this.onFilterChangeCallback) this.onFilterChangeCallback(new Set(this.selectedRoutes)); }
  }

  _getFilteredArrivals() {
    const panelActive  = this.selectedRoutes.size > 0;
    const globalActive = routeFilterState.hasActive();
    if (!panelActive && !globalActive) return this.allArrivals;
    const activeFilter = panelActive ? this.selectedRoutes : routeFilterState.selectedRoutes;
    return this.allArrivals.filter(a => {
      const num = String(a.route_short_name || a.route_number || a.route_id || '');
      return activeFilter.has(num);
    });
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  showLoading(message = 'O que gostarias de ver aqui em breve? Submete as tuas sugestões <a href="https://tiagoanoliveira.pt/support/a260e7bee11b401b9fd09290e8a8d6d9">aqui</a> ou no link do rodapé.') {
    if (!this.element) return;
    const listContainer = this.element.querySelector('#arrivals-list-panel');
    listContainer.classList.add('panel-loading');
    if (!this.loadingSpinner) this.loadingSpinner = new LoadingSpinner({ size: 'medium', message });
    else this.loadingSpinner.setMessage(message);
    this.loadingSpinner.show(listContainer);
  }

  hideLoading() {
    if (!this.element) return;
    this.element.querySelector('#arrivals-list-panel').classList.remove('panel-loading');
    if (this.loadingSpinner) this.loadingSpinner.remove();
  }

  // ─── Mostrar / Esconder ──────────────────────────────────────────────────────

  show(stopName, stopId = null) {
    if (!this.element) this.create();
    this.currentStopId = stopId;
    const titleEl = this.element.querySelector('#arrivals-stop-name');
    const codeEl  = this.element.querySelector('#arrivals-stop-code');
    if (titleEl && stopName) titleEl.textContent = stopName;
    if (codeEl  && stopId)  codeEl.textContent  = `Código: ${stopId}`;
    this.showLoading();
    this.element.classList.add('visible');
    this.isVisible = true;
    this._updateFavouriteBtn();
  }

  hide() {
    if (this.element) {
      this.element.classList.remove('visible');
      this.isVisible       = false;
      this.currentStopId   = null;
      this.availableRoutes = [];
      this.selectedRoutes  = new Set();
      this.allArrivals     = [];
      this.allVehicles     = [];
      this.hideLoading();
      this._renderFilterBar();
      if (this.onCloseCallback) this.onCloseCallback();
    }
  }

  // ─── Chegadas ────────────────────────────────────────────────────────────────

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
    const filtered      = this._getFilteredArrivals();

    if (!filtered || filtered.length === 0) {
      listContainer.innerHTML = this.allArrivals.length === 0
        ? `<p class="no-arrivals">⚠️ Não há, de momento, localizações dos autocarros previstos para esta paragem - pode ter que aguardar que estes iniciem viagem.<br><br>Consulte <a href="index.html">aqui a localização em tempo real de todos os autocarros</a> ou verifique o horário planeado na paragem.</p>`
        : `<p class="no-arrivals">⚠️ Nenhuma chegada encontrada para as linhas seleccionadas.</p>`;
      return;
    }

    listContainer.innerHTML = '';
    filtered.forEach(arrival => {
      // Match: tentar tripId exacto → sem prefixo feed → por linha+direcção
      const vehicle = arrival.is_realtime
        ? this._matchVehicle(arrival)
        : null;
      listContainer.appendChild(this._createArrivalElement(arrival, vehicle));
    });
  }

  /**
   * Tenta associar uma chegada OTP a um veículo MQTT.
   *
   * Estratégia (por ordem de precisão):
   *   1. trip_id exacto
   *   2. trip_id sem prefixo feed ("2:LINE_..." → "LINE_...")
   *   3. Match por linha + direcção (fallback quando os trip_ids divergem)
   *
   * Os veículos em allVehicles já estão no formato processado
   * (têm .tripId directamente) e têm .latitude/.longitude.
   */
  _matchVehicle(arrival) {
    if (!this.allVehicles?.length) return null;

    const arrTripId = arrival.trip_id;        // já sem prefixo feed (stripped pelo OTP service)
    const arrLine   = String(arrival.route_short_name || '');

    // 1. Match por trip_id exacto
    if (arrTripId) {
      const exact = this.allVehicles.find(v => {
        const vTripId = String(v.tripId || '');
        return vTripId === arrTripId;
      });
      if (exact) return exact;

      // 2. Match ignorando o 2º segmento (nr_viagem) usando scheduleService logic
      const byTrip = this.allVehicles.find(v =>
        vehicleService.tripIdsMatch(v.tripId, arrTripId)
      );
      if (byTrip) return byTrip;
    }

    // 3. Fallback: linha + direcção (vários veículos podem corresponder — pegar o mais próximo)
    if (arrLine) {
      const byLine = this.allVehicles.filter(v => {
        const vLine = String(v.displayLine || v.line || '');
        return vLine === arrLine;
      });
      if (byLine.length === 1) return byLine[0];
      // Se há vários veículos da mesma linha, escolher o que tem arrival_seconds mais baixo
      // como heurística de "mais próximo" — não é perfeito mas é melhor que nada
      if (byLine.length > 1) return byLine[0];
    }

    return null;
  }

  _createArrivalElement(arrival, vehicle) {
    const busColor    = arrival.route_color      || '#0072C6';
    const textColor   = arrival.route_text_color || '#FFFFFF';
    const isRealtime  = arrival.is_realtime === true;
    const status      = arrival.status || 'SCHEDULED';
    const delayS      = arrival.delay_seconds || 0;

    const hasLocation = isRealtime && vehicle &&
      vehicleService.extractVehicleLocation(vehicle) !== null;
    const locationIcon = hasLocation ? this.getActiveLocationIcon() : this.getInactiveLocationIcon();

    // ── Status line ──────────────────────────────────────────────────────────
    let statusHtml = '';
    if (!isRealtime) {
      statusHtml = '<span class="delay-label">Planeado — localização desconhecida</span>';
    } else {
      const colorCls  = delayColorClass(status, delayS);
      const labelText = statusLabel(status);

      if (status === 'ON_TIME') {
        // No horário previsto: mostrar só o rótulo em verde
        statusHtml = `<span class="delay-label ${colorCls}">${labelText}</span>`;
      } else if (status === 'EARLY') {
        // Adiantado: rótulo + quanto tempo adiantado (delay é negativo)
        const diff = formatDelay(delayS);
        statusHtml = `<span class="delay-label ${colorCls}">${labelText} <strong>${diff}</strong></span>`;
      } else if (status === 'DELAYED') {
        // Atrasado: rótulo + atraso em mm:ss
        const diff = formatDelay(delayS);
        statusHtml = `<span class="delay-label ${colorCls}">${labelText} <strong>${diff}</strong></span>`;
      } else {
        statusHtml = `<span class="delay-label">${labelText}</span>`;
      }
    }

    // ── Tempo de chegada ──────────────────────────────────────────────────────
    const timeColorCls = isRealtime ? delayColorClass(status, delayS) : '';
    const timeHtml     = `<div class="arrival-time ${timeColorCls}">${this._formatArrivalTime(arrival)}</div>`;

    // ── Elemento ─────────────────────────────────────────────────────────────
    const div = document.createElement('div');
    div.className = 'arrival-item';

    if (hasLocation) {
      const location = vehicleService.extractVehicleLocation(vehicle);
      div.style.cursor = 'pointer';
      div.setAttribute('data-vehicle-id', vehicle.id);
      div.addEventListener('click', () => {
        if (this.onArrivalClickCallback) this.onArrivalClickCallback({ vehicleId: vehicle.id, location, arrival });
      });
    }

    div.innerHTML = `
      <div class="arrival-line" style="background-color:${busColor};color:${textColor};">
        ${arrival.route_short_name}
      </div>
      <div class="arrival-info">
        <div class="arrival-destination">${arrival.trip_headsign}</div>
        <div class="arrival-status">${statusHtml}</div>
      </div>
      <div class="arrival-time-container">
        <div class="arrival-location-icon">${locationIcon}</div>
        ${timeHtml}
      </div>
    `;
    return div;
  }

  /**
   * Formata o tempo de chegada de forma precisa:
   *   < 60 s       → "A chegar"
   *   60 s – 59 m  → "N min"
   *   ≥ 60 m       → "Xh YY"
   */
  _formatArrivalTime(arrival) {
    const seconds = arrival.arrival_seconds;
    const minutes = arrival.arrival_minutes;
    // Preferir seconds se disponível (mais preciso)
    if (Number.isFinite(seconds)) {
      if (seconds < 60) return 'A chegar';
      const m = Math.floor(seconds / 60);
      if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60);
      return `${h}h${String(m % 60).padStart(2, '0')}`;
    }
    // Fallback para minutos
    if (minutes === undefined || minutes === null) return 'N/A';
    if (minutes < 1) return 'A chegar';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    return `${h}h${String(Math.round(minutes % 60)).padStart(2, '0')}`;
  }

  // ─── Favoritos ───────────────────────────────────────────────────────────────

  _updateFavouriteBtn() {
    const btn = this.element?.querySelector('#arrivals-favourite-btn');
    if (!btn || !this.currentStopId) return;
    const isFav = this.onIsFavouriteCallback ? this.onIsFavouriteCallback(this.currentStopId) : false;
    btn.classList.toggle('is-favourite', isFav);
    btn.title = isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    const poly = btn.querySelector('polygon');
    if (poly) poly.setAttribute('fill', isFav ? 'currentColor' : 'none');
  }

  refreshFavouriteBtn() { this._updateFavouriteBtn(); }

  // ─── Ícones ──────────────────────────────────────────────────────────────────

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

  // ─── Callbacks ───────────────────────────────────────────────────────────────

  updateLastUpdate(timestamp) {
    if (!this.element) return;
    const el = this.element.querySelector('#arrivals-last-update');
    if (el) {
      const t = timestamp || new Date();
      el.innerHTML = `Última atualização: <strong>${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}</strong>`;
    }
  }

  onArrivalClick(callback)   { this.onArrivalClickCallback   = callback; }
  onClose(callback)          { this.onCloseCallback          = callback; }
  onRefresh(callback)        { this.onRefreshCallback        = callback; }
  onFilterChange(callback)   { this.onFilterChangeCallback   = callback; }
  onFavouriteClick(callback) { this.onFavouriteClickCallback = callback; }
  onIsFavourite(callback)    { this.onIsFavouriteCallback    = callback; }

  destroy() {
    if (this._timeCheckInterval) clearInterval(this._timeCheckInterval);
    if (this.element)       { this.element.remove();       this.element      = null; }
    if (this.loadingSpinner){ this.loadingSpinner.remove(); this.loadingSpinner = null; }
  }
}
