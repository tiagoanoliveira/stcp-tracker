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

// Linhas circulares: só existão na direção 0
const CIRCULAR_LINES = new Set(['300', '301', '302', '303']);

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
        <button class="rfb-clear-btn" id="rfb-clear-${this.containerId}" title="Limpar filtros" aria-label="Limpar todos os filtros" style="display:none">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 5H7l-5 7 5 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
            <line x1="18" y1="9" x2="12" y2="15"/>
            <line x1="12" y1="9" x2="18" y2="15"/>
          </svg>
        </button>
      </div>`;

    const clearBtn = this.container.querySelector(`#rfb-clear-${this.containerId}`);
    if (clearBtn) clearBtn.addEventListener('click', () => this._clearAll());
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
    const chipsEl  = this._chipsEl();
    const clearBtn = this.container?.querySelector(`#rfb-clear-${this.containerId}`);
    if (!chipsEl) return;
    chipsEl.innerHTML = '';

    if (this.routes.length === 0) {
      chipsEl.innerHTML = '<span class="rfb-empty">Sem linhas disponíveis</span>';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    this.routes.forEach(route => {
      const entry      = this.selected.get(route.number);
      const isActive   = Boolean(entry);
      const direction  = entry?.direction ?? 0;
      const isCircular = CIRCULAR_LINES.has(String(route.number));

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
        dirBtn.style.backgroundColor = this._darken(route.color || '#187EC2');
        dirBtn.style.color           = route.text_color || '#FFFFFF';

        if (isCircular) {
          // Linha circular: botão decorativo, sem ação
          dirBtn.className   = 'rfb-chip-dir rfb-chip-circular';
          dirBtn.textContent = '\u25CB';   // ○ (círculo vazio)
          dirBtn.title       = 'Linha circular — sentido único';
          dirBtn.setAttribute('aria-disabled', 'true');
          dirBtn.tabIndex = -1;
        } else {
          dirBtn.className   = 'rfb-chip-dir';
          dirBtn.title       = direction === 0 ? 'Mostrar volta (direção 1)' : 'Mostrar ida (direção 0)';
          dirBtn.textContent = direction === 0 ? '\u2192' : '\u2190';
          dirBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleDirection(route); });
        }
        chip.appendChild(dirBtn);
      }

      chipsEl.appendChild(chip);
    });

    // Mostrar/esconder botão de limpar
    if (clearBtn) clearBtn.style.display = this.selected.size > 0 ? 'flex' : 'none';
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

  _clearAll() {
    this.selected.clear();
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
