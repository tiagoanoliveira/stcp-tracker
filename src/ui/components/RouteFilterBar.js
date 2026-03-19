/**
 * RouteFilterBar - Barra horizontal de chips de linha.
 *
 * Interface pública:
 *  mount()                  injeta HTML no container
 *  setRoutes(routes[])      define lista de linhas
 *  setLoading(bool)         spinner enquanto carrega
 *  getSelected()            Set<string> de números seleccionados
 *  onFilterChange(cb)       cb(Set<string>, routeObjects[]) — routeObjects inclui direction (0|1)
 */

export class RouteFilterBar {
  constructor(containerId) {
    this.containerId = containerId;
    this.container   = null;
    this.routes      = [];
    // selected: Map<routeNumber, { route, direction: 0|1 }>
    this.selected    = new Map();
    this._onFilterChange = null;
  }

  mount() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn(`RouteFilterBar: container #${this.containerId} não encontrado`);
      return;
    }
    this.container.innerHTML = `
      <div class="rfb-inner">
        <span class="rfb-label">Filtrar por:</span>
        <div class="rfb-chips" id="rfb-chips-${this.containerId}"></div>
      </div>`;
  }

  setRoutes(routes = []) {
    this.routes   = routes;
    this.selected = new Map();
    this._render();
  }

  setLoading(isLoading) {
    const chipsEl = this._chipsEl();
    if (!chipsEl) return;
    if (isLoading) {
      chipsEl.innerHTML = '<span class="rfb-loading">A carregar linhas...</span>';
    } else {
      this._render();
    }
  }

  getSelected() {
    return new Set(this.selected.keys());
  }

  onFilterChange(callback) {
    this._onFilterChange = callback;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    const chipsEl = this._chipsEl();
    if (!chipsEl) return;
    chipsEl.innerHTML = '';

    if (this.routes.length === 0) {
      chipsEl.innerHTML = '<span class="rfb-empty">Sem linhas disponíveis</span>';
      return;
    }

    this.routes.forEach(route => {
      const entry     = this.selected.get(route.number);
      const isActive  = Boolean(entry);
      const direction = entry?.direction ?? 0;

      const chip = document.createElement('div');
      chip.className = `rfb-chip${isActive ? ' active' : ''}`;

      const mainBtn = document.createElement('button');
      mainBtn.className             = 'rfb-chip-main';
      mainBtn.style.backgroundColor = route.color      || '#187EC2';
      mainBtn.style.color           = route.text_color || '#FFFFFF';
      mainBtn.title       = route.name || route.number;
      mainBtn.textContent = route.number;
      mainBtn.addEventListener('click', () => this._toggleRoute(route));
      chip.appendChild(mainBtn);

      if (isActive) {
        const dirBtn = document.createElement('button');
        dirBtn.className              = 'rfb-chip-dir';
        dirBtn.style.backgroundColor  = this._darken(route.color || '#187EC2');
        dirBtn.style.color            = route.text_color || '#FFFFFF';
        dirBtn.title      = direction === 0 ? 'Mostrar volta (direção 1)' : 'Mostrar ida (direção 0)';
        dirBtn.textContent = direction === 0 ? '\u2192' : '\u2190';
        dirBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleDirection(route); });
        chip.appendChild(dirBtn);
      }

      chipsEl.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // Interacções
  // ---------------------------------------------------------------------------

  _toggleRoute(route) {
    if (this.selected.has(route.number)) {
      this.selected.delete(route.number);
    } else {
      this.selected.set(route.number, { route, direction: 0 });
    }
    this._render();
    this._emit();
  }

  _toggleDirection(route) {
    const entry = this.selected.get(route.number);
    if (!entry) return;
    entry.direction = entry.direction === 0 ? 1 : 0;
    this.selected.set(route.number, entry);
    this._render();
    this._emit();
  }

  _emit() {
    if (!this._onFilterChange) return;
    const selectedSet = new Set(this.selected.keys());
    const routeObjs   = Array.from(this.selected.values()).map(e => ({
      ...e.route,
      direction: e.direction
    }));
    this._onFilterChange(selectedSet, routeObjs);
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  _chipsEl() {
    return this.container?.querySelector(`#rfb-chips-${this.containerId}`);
  }

  _darken(hex) {
    try {
      const n = parseInt(hex.replace('#', ''), 16);
      const r = Math.max(0, (n >> 16 & 0xff) - 40);
      const g = Math.max(0, (n >>  8 & 0xff) - 40);
      const b = Math.max(0, (n       & 0xff) - 40);
      return `rgb(${r},${g},${b})`;
    } catch { return hex; }
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}
