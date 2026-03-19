/**
 * RouteFilterBar - Barra horizontal de chips de linha para filtrar o mapa.
 *
 * Usada em:
 *  - index.html   (BusMapApp)   - filtra autocarros e desenha linhas
 *  - stopsmap.html (StopsMapApp) - filtra paragens e desenha linhas
 *
 * Interface:
 *  - setRoutes(routes)         define a lista completa de linhas
 *  - getSelected()             devolve Set<string> com números seleccionados
 *  - onFilterChange(callback)  callback(Set<string>) chamado em cada toggle
 *  - setLoading(bool)          mostra spinner enquanto carrega a lista
 */

export class RouteFilterBar {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.routes = [];
    this.selected = new Set();
    this._onFilterChange = null;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  mount() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn(`RouteFilterBar: container #${this.containerId} não encontrado`);
      return;
    }
    this.container.innerHTML = `
      <div class="rfb-inner">
        <span class="rfb-label">Linhas:</span>
        <div class="rfb-chips" id="rfb-chips-${this.containerId}"></div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Dados
  // ---------------------------------------------------------------------------

  setRoutes(routes = []) {
    this.routes = routes;
    this.selected = new Set(); // limpar seleção ao carregar nova lista
    this._render();
  }

  setLoading(isLoading) {
    if (!this.container) return;
    const chipsEl = this.container.querySelector(`#rfb-chips-${this.containerId}`);
    if (!chipsEl) return;
    if (isLoading) {
      chipsEl.innerHTML = '<span class="rfb-loading">A carregar linhas...</span>';
    } else {
      this._render();
    }
  }

  getSelected() {
    return new Set(this.selected);
  }

  // ---------------------------------------------------------------------------
  // Callback
  // ---------------------------------------------------------------------------

  onFilterChange(callback) {
    this._onFilterChange = callback;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    if (!this.container) return;
    const chipsEl = this.container.querySelector(`#rfb-chips-${this.containerId}`);
    if (!chipsEl) return;

    chipsEl.innerHTML = '';

    if (this.routes.length === 0) {
      chipsEl.innerHTML = '<span class="rfb-empty">Sem linhas disponíveis</span>';
      return;
    }

    this.routes.forEach(route => {
      const isActive = this.selected.has(route.number);
      const chip = document.createElement('button');
      chip.className = `rfb-chip${isActive ? ' active' : ''}`;
      chip.style.backgroundColor = route.color      || '#187EC2';
      chip.style.color            = route.text_color || '#FFFFFF';
      chip.title   = route.name   || route.number;
      chip.textContent = route.number;
      chip.addEventListener('click', () => this._toggle(route));
      chipsEl.appendChild(chip);
    });
  }

  _toggle(route) {
    if (this.selected.has(route.number)) {
      this.selected.delete(route.number);
    } else {
      this.selected.add(route.number);
    }
    this._render();
    if (this._onFilterChange) {
      this._onFilterChange(new Set(this.selected), this._getSelectedRouteObjects());
    }
  }

  /**
   * Devolve os objectos route completos (com color, etc.) para as linhas seleccionadas.
   */
  _getSelectedRouteObjects() {
    return this.routes.filter(r => this.selected.has(r.number));
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}
