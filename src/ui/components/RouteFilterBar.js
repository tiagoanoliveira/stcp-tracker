/**
 * RouteFilterBar - Barra horizontal de chips de linha.
 *
 * Interface pública:
 *  mount()                  injeta HTML no container
 *  setRoutes(routes[])      define lista de percursos (podem existir vários
 *                            percursos/variantes com o mesmo `number`)
 *  setLoading(bool)         spinner enquanto carrega
 *  getSelected()            Set<string> de NÚMEROS de linha activos
 *  onFilterChange(cb)       cb(Set<string> numeros, routeObjects[]) —
 *                            routeObjects são as VARIANTES (routeId + direction)
 *                            realmente seleccionadas, não apenas os números
 *
 * Modelo de dados:
 *  this.routes    -> lista PLANA de percursos/variantes (cada um com id/routeId
 *                     próprio; o mesmo `number` pode aparecer várias vezes)
 *  this.selected  -> Map<routeId, { route, direction }>  (chave = variante,
 *                     nunca o número de linha, para não colapsar percursos
 *                     diferentes da mesma linha)
 *
 * Percursos múltiplos por linha:
 *  Quando uma linha (número) tem mais do que uma variante/percurso, é
 *  mostrado um único chip principal (activa a 1.ª variante ao clicar) e,
 *  quando existe uma variante activa, um botão "Ver outros percursos" que
 *  expande a lista de variantes dessa linha. Cada variante pode ser activada
 *  independentemente (múltiplas variantes da mesma linha podem estar activas
 *  em simultâneo) e cada uma tem a sua própria direcção (ida/volta).
 *
 * Visibilidade temporal:
 *  Linhas diurnas  (sem 'M' no sufixo): visíveis 05:30–01:30
 *  Linhas nocturnas (sufixo 'M'):        visíveis 00:30–06:30
 */
import { getSetting, setSetting, SETTINGS_KEYS } from '../../config/filterSettings.js';

const CIRCULAR_LINES = new Set(['300', '301', '302', '303']);

const STCP_GROUP_PREFIXES = ['2', '3', '4', '5', '6', '7', '8', '9'];

/** Devolve true se a linha é nocturna (número TERMINA em 'M', case-insensitive).
 *  Ex: "3M" → true, "MB1" → false, "200M" → true
 */
function isNightLine(number) {
  return /M$/i.test(String(number));
}

/**
 * Dado um Date, devolve:
 *  'day'   — entre 05:30 e 01:30 do dia seguinte (linhas diurnas visíveis)
 *  'night' — entre 00:30 e 06:30 (linhas nocturnas visíveis)
 * As janelas são sobrepostas: 00:30-01:30 e 05:30-06:30 ambas são visíveis.
 *
 * Representamos tudo em minutos desde meia-noite.
 */
function getLineVisibility(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m; // minutos desde 00:00

  // Linhas diurnas: visíveis fora do intervalo [01:30, 05:30[
  const dayHidden = total >= 90 && total < 330; // 90 = 01:30, 330 = 05:30

  // Linhas nocturnas: visíveis dentro de [00:30, 06:30[
  const nightVisible = total >= 30 && total < 390; // 30 = 00:30, 390 = 06:30

  return { showDay: !dayHidden, showNight: nightVisible };
}

export class RouteFilterBar {
  constructor(containerId) {
    this.containerId = containerId;
    this.container   = null;

    /** @type {Array<Object>} lista PLANA de percursos/variantes */
    this.routes      = [];

    /** @type {Map<string, {route: Object, direction: number}>} routeId -> selecção */
    this.selected    = new Map();

    this._onFilterChange = null;
    this._timeCheckInterval = null;
    this._stcpExpanded = new Set();      // grupos STCP expandidos ex: '2', '3', ...
    this._unirExpanded = new Set();      // lotes UNIR expandidos ex: '1', '2', ...
    this._unirSubExpanded = new Set();   // não necessário por ora

    /** @type {Set<string>} números de linha com "Ver outros percursos" aberto */
    this._expandedLineFamilies = new Set();
  }

  mount() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.warn(`RouteFilterBar: container #${this.containerId} não encontrado`);
      return;
    }

    this.container.innerHTML = `
    <div class="rfb-inner" id="rfb-inner-${this.containerId}">
      <span class="rfb-label">Filtrar por:</span>
      <div class="rfb-chips" id="rfb-chips-${this.containerId}"></div>
      <button class="rfb-clear-btn" id="rfb-clear-${this.containerId}" 
              title="Limpar filtros" aria-label="Limpar todos os filtros" style="display:none">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" 
             stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 5H7l-5 7 5 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>
          <line x1="18" y1="9" x2="12" y2="15"/>
          <line x1="12" y1="9" x2="18" y2="15"/>
        </svg>
      </button>
    </div>`;

    const clearBtn = this.container.querySelector(`#rfb-clear-${this.containerId}`);
    if (clearBtn) clearBtn.addEventListener('click', () => this._clearAll());

    // Verificar visibilidade a cada minuto (muda às :30 de certas horas)
    this._timeCheckInterval = setInterval(() => this._applyTimeVisibility(), 60_000);
  }

  setRoutes(routes = []) {
    this.routes   = routes;
    this.selected = new Map();
    this._expandedLineFamilies = new Set();
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

  /** @returns {Set<string>} números de linha com pelo menos uma variante activa */
  getSelected() {
    const numbers = new Set();
    for (const { route } of this.selected.values()) {
      numbers.add(String(route.number ?? route.id));
    }
    return numbers;
  }

  onFilterChange(callback) {
    this._onFilterChange = callback;
  }

  // ---------------------------------------------------------------------------
  // Helpers de identidade
  // ---------------------------------------------------------------------------

  /** Identificador único de uma variante/percurso (nunca o número de linha). */
  _routeId(route) {
    return String(route.routeId ?? route.id ?? route.number ?? '');
  }

  /** Agrupa uma lista plana de percursos pelo número de linha visível. */
  _groupRoutesByNumber(routes = []) {
    const map = new Map(); // number -> variants[]
    for (const route of routes) {
      const number = String(route.number ?? route.id ?? '');
      if (!map.has(number)) map.set(number, []);
      map.get(number).push(route);
    }
    return map;
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

    // Separar rotas STCP e UNIR
    const unirRoutes = this.routes.filter(r => this.isUnirRoute(r));
    const metrobusRoutes = this.routes.filter(r => this.isMetrobusRoute(r));
    const stcpRoutes = this.routes.filter(r => !this.isUnirRoute(r) && !this.isMetrobusRoute(r));

    // --- Bloco STCP ---
    this._renderStcpGroups(chipsEl, stcpRoutes);

    // --- Separador + bloco UNIR ---
    const showUnir = getSetting(SETTINGS_KEYS.SHOW_UNIR, true);
    if (unirRoutes.length > 0 && showUnir) {
      this._renderUnirGroups(chipsEl, unirRoutes);
    }

    if (clearBtn) clearBtn.style.display = this.selected.size > 0 ? 'flex' : 'none';
    this._applyTimeVisibility();
  }

  /** Identifica linhas UNIR: número >= 1000 */
  isUnirRoute(route) {
    const operator = String(route.operator ?? route.source ?? '').toLowerCase();
    if (operator === 'unir') return true;

    const id = String(route.id ?? '');
    const number = String(route.number ?? '');

    return /^\d{4,}$/.test(number) || /^\d{4,}$/.test(id);
  }

  isMetrobusRoute(route) {
    const operator = String(route.operator ?? route.source ?? '').toLowerCase();
    if (operator === 'metrobus') return true;

    const id = String(route.id ?? '');
    const number = String(route.number ?? '');
    return id === 'MB1' || number === 'MB1' || number.startsWith('MB');
  }

  /** Render STCP em grupos (2XX, 3XX, etc.), já agrupado por linha (família). */
  _renderStcpGroups(chipsEl, stcpRoutes) {
    // families: number -> variants[]
    const families = this._groupRoutesByNumber(stcpRoutes);

    // Agrupa as FAMÍLIAS (não as variantes individuais) por prefixo numérico
    const groups = {}; // prefix -> [number, number, ...]
    families.forEach((variants, number) => {
      let prefix;
      if (/M$/i.test(number)) {
        prefix = 'XM';
      } else {
        prefix = number.charAt(0);
      }
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(number);
    });

    const orderedPrefixes = [...STCP_GROUP_PREFIXES, 'XM']
        .filter(p => groups[p]);

    orderedPrefixes.forEach(prefix => {
      const groupNumbers = groups[prefix];
      const label = prefix === 'XM' ? 'XM' : `${prefix}XX`;

      const firstFamilyVariants = families.get(groupNumbers[0]) || [];
      const groupColor = firstFamilyVariants[0]?.color || '#0072c6';
      const groupTextColor = firstFamilyVariants[0]?.text_color || '#FFFFFF';

      // Se o grupo só tem 1 linha (família), mostrar directamente sem agrupamento
      if (groupNumbers.length === 1) {
        const number = groupNumbers[0];
        this._appendLineFamilyChip(chipsEl, number, families.get(number));
        return;
      }

      const defaultExpanded = getSetting(SETTINGS_KEYS.STCP_GROUPS_EXPANDED, true);
      const expanded = this._stcpExpanded.has(prefix)
          ? !this._stcpExpanded.has(`__collapsed__${prefix}`)
          : defaultExpanded;

      if (!expanded) {
        // Mostrar chip de grupo colapsado
        const groupChip = document.createElement('button');
        groupChip.className = 'rfb-group-btn';
        groupChip.textContent = label;
        groupChip.title = `Expandir linhas ${label}`;
        groupChip.style.backgroundColor = this._tint(groupColor, 0.82); // fundo suave
        groupChip.style.color = groupColor;
        groupChip.style.borderColor = groupColor;
        groupChip.addEventListener('click', () => {
          this._stcpExpanded.add(prefix);
          this._stcpExpanded.delete(`__collapsed__${prefix}`);
          this._render();
        });
        chipsEl.appendChild(groupChip);
      } else {
        // Mostrar botão de colapso + chips individuais (uma família por chip)
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'rfb-group-btn rfb-group-btn--expanded';
        collapseBtn.textContent = label;
        collapseBtn.title = `Colapsar ${label}`;
        collapseBtn.style.backgroundColor = groupColor;
        collapseBtn.style.color = groupTextColor;
        collapseBtn.style.borderColor = groupColor;
        collapseBtn.addEventListener('click', () => {
          this._stcpExpanded.delete(prefix);
          this._stcpExpanded.add(`__collapsed__${prefix}`);
          this._render();
        });
        chipsEl.appendChild(collapseBtn);

        groupNumbers.forEach(number => {
          this._appendLineFamilyChip(chipsEl, number, families.get(number));
        });
      }
    });
  }

  /** Render UNIR em lotes (1XXX, 2XXX, ...) com sub-expansão, agrupado por linha. */
  _renderUnirGroups(chipsEl, unirRoutes) {
    const defaultExpanded = getSetting(SETTINGS_KEYS.UNIR_GROUPS_EXPANDED, false);

    // families: number -> variants[]
    const families = this._groupRoutesByNumber(unirRoutes);

    // Chip "UNIR" raiz
    const unirExpanded = this._unirExpanded.has('__root__');

    const unirRootBtn = document.createElement('button');
    unirRootBtn.className = `rfb-group-btn rfb-group-btn--unir${unirExpanded ? ' rfb-group-btn--expanded' : ''}`;
    unirRootBtn.textContent = 'UNIR';
    unirRootBtn.title = unirExpanded ? 'Colapsar linhas UNIR' : 'Expandir linhas UNIR';
    unirRootBtn.addEventListener('click', () => {
      if (unirExpanded) this._unirExpanded.delete('__root__');
      else this._unirExpanded.add('__root__');
      this._render();
    });
    chipsEl.appendChild(unirRootBtn);

    if (!unirExpanded) return;

    // Agrupar FAMÍLIAS por milhar (1XXX, 2XXX, ...)
    const lots = {}; // lot -> [number, number, ...]
    families.forEach((variants, number) => {
      const lot = String(Math.floor(parseInt(number, 10) / 1000));
      if (!lots[lot]) lots[lot] = [];
      lots[lot].push(number);
    });

    Object.keys(lots).sort().forEach(lot => {
      const lotNumbers = lots[lot];
      const lotLabel = `${lot}XXX`;
      const lotExpanded = this._unirExpanded.has(`lot_${lot}`);

      const lotBtn = document.createElement('button');
      lotBtn.className = `rfb-group-btn rfb-group-btn--unir-lot${lotExpanded ? ' rfb-group-btn--expanded' : ''}`;
      lotBtn.textContent = lotLabel;
      lotBtn.title = lotExpanded ? `Colapsar lote ${lotLabel}` : `Expandir lote ${lotLabel}`;
      lotBtn.addEventListener('click', () => {
        if (lotExpanded) this._unirExpanded.delete(`lot_${lot}`);
        else this._unirExpanded.add(`lot_${lot}`);
        this._render();
      });
      chipsEl.appendChild(lotBtn);

      if (lotExpanded) {
        lotNumbers.forEach(number => {
          this._appendLineFamilyChip(chipsEl, number, families.get(number));
        });
      }
    });
  }

  /**
   * Cria e adiciona o chip de uma LINHA (número), que pode ter uma ou mais
   * variantes/percursos por baixo.
   *
   * Comportamento:
   *  - Clicar no chip principal quando NENHUMA variante está activa activa
   *    a 1.ª variante da lista.
   *  - Clicar no chip principal quando já existe pelo menos uma variante
   *    activa mantém/desliga essa variante (a primeira activa).
   *  - Se existir mais do que uma variante, mostra "Ver outros percursos"
   *    (apenas quando a linha está activa) para escolher/activar outras
   *    variantes em simultâneo.
   *  - Cada variante activa tem o seu próprio botão de direcção (ida/volta).
   */
  _appendLineFamilyChip(chipsEl, number, variants = []) {
    const night = isNightLine(number);
    const activeVariants = variants.filter(v => this.selected.has(this._routeId(v)));
    const isActive = activeVariants.length > 0;
    const primary = activeVariants[0] || variants[0];
    const isCircular = CIRCULAR_LINES.has(String(number));

    const wrap = document.createElement('div');
    wrap.className = 'rfb-family';
    wrap.dataset.line = String(number);
    wrap.dataset.nightLine = night ? 'true' : 'false';

    const chip = document.createElement('div');
    chip.className    = `rfb-chip${isActive ? ' active' : ''}`;
    chip.dataset.line = String(number);
    chip.dataset.nightLine = night ? 'true' : 'false';

    const mainBtn = document.createElement('button');
    mainBtn.className             = 'rfb-chip-main';
    mainBtn.style.backgroundColor = primary?.color      || '#187EC2';
    mainBtn.style.color           = primary?.text_color || '#FFFFFF';
    mainBtn.title       = primary?.name || number;
    mainBtn.textContent = number;
    mainBtn.addEventListener('click', () => this._toggleRouteVariant(primary, variants));
    chip.appendChild(mainBtn);

    if (isActive && primary) {
      const primaryDirection = this.selected.get(this._routeId(primary))?.direction ?? 0;

      const dirBtn = document.createElement('button');
      dirBtn.style.backgroundColor = this._darken(primary.color || '#187EC2');
      dirBtn.style.color           = primary.text_color || '#FFFFFF';

      if (isCircular) {
        dirBtn.className   = 'rfb-chip-dir rfb-chip-circular';
        dirBtn.textContent = '\u25CB';
        dirBtn.title       = 'Linha circular — sentido único';
        dirBtn.setAttribute('aria-disabled', 'true');
        dirBtn.tabIndex = -1;
      } else {
        dirBtn.className   = 'rfb-chip-dir';
        dirBtn.title       = primaryDirection === 0 ? 'Mostrar volta (direção 1)' : 'Mostrar ida (direção 0)';
        dirBtn.textContent = primaryDirection === 0 ? '\u2192' : '\u2190';
        dirBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleDirectionVariant(primary); });
      }
      chip.appendChild(dirBtn);
    }

    wrap.appendChild(chip);

    // "Ver outros percursos" — só quando há mais de uma variante e a linha está activa
    if (variants.length > 1 && isActive) {
      const isExpanded = this._expandedLineFamilies.has(String(number));

      const moreBtn = document.createElement('button');
      moreBtn.className   = 'rfb-family-more';
      moreBtn.textContent = isExpanded ? 'Ocultar outros percursos' : 'Ver outros percursos';
      moreBtn.title       = `${variants.length} percursos disponíveis para a linha ${number}`;
      moreBtn.addEventListener('click', () => {
        if (isExpanded) this._expandedLineFamilies.delete(String(number));
        else this._expandedLineFamilies.add(String(number));
        this._render();
      });
      wrap.appendChild(moreBtn);

      if (isExpanded) {
        const variantsEl = document.createElement('div');
        variantsEl.className = 'rfb-family-variants';

        variants.forEach(variant => {
          const routeId    = this._routeId(variant);
          const entry      = this.selected.get(routeId);
          const isVarActive = Boolean(entry);

          const row = document.createElement('div');
          row.className = 'rfb-variant-row';

          const btn = document.createElement('button');
          btn.className   = `rfb-variant-btn${isVarActive ? ' active' : ''}`;
          btn.textContent = variant.name || variant.route_long_name || `${number}`;
          btn.title       = variant.name || variant.route_long_name || `${number}`;
          btn.addEventListener('click', () => this._toggleRouteVariant(variant, variants));
          row.appendChild(btn);

          if (isVarActive) {
            const varDirBtn = document.createElement('button');
            varDirBtn.className = 'rfb-variant-dir-btn';

            if (isCircular) {
              varDirBtn.textContent = '\u25CB';
              varDirBtn.title       = 'Linha circular — sentido único';
              varDirBtn.setAttribute('aria-disabled', 'true');
              varDirBtn.tabIndex = -1;
            } else {
              const dir = entry.direction ?? 0;
              varDirBtn.textContent = dir === 0 ? '\u2192' : '\u2190';
              varDirBtn.title       = dir === 0 ? 'Mostrar volta (direção 1)' : 'Mostrar ida (direção 0)';
              varDirBtn.addEventListener('click', e => { e.stopPropagation(); this._toggleDirectionVariant(variant); });
            }
            row.appendChild(varDirBtn);
          }

          variantsEl.appendChild(row);
        });

        wrap.appendChild(variantsEl);
      }
    }

    chipsEl.appendChild(wrap);
  }

  /**
   * Oculta/mostra chips com base no horário actual.
   * Chamado após _render() e a cada minuto.
   */
  _applyTimeVisibility() {
    const chipsEl = this._chipsEl();
    if (!chipsEl) return;
    const { showDay, showNight } = getLineVisibility(new Date());

    chipsEl.querySelectorAll('.rfb-family').forEach(family => {
      const night = family.dataset.nightLine === 'true';
      const show  = night ? showNight : showDay;
      family.style.display = show ? '' : 'none';
    });

    // Se uma variante seleccionada pertence a uma linha que ficou oculta,
    // desse-lecciona-a silenciosamente.
    let changed = false;
    for (const [routeId, entry] of Array.from(this.selected.entries())) {
      const number = String(entry.route.number ?? entry.route.id ?? '');
      const night  = isNightLine(number);
      const show   = night ? showNight : showDay;
      if (!show) { this.selected.delete(routeId); changed = true; }
    }
    if (changed) { this._render(); this._emit(); }
  }

  // ---------------------------------------------------------------------------
  // Interacções
  // ---------------------------------------------------------------------------

  /**
   * Alterna a activação de UMA variante/percurso específica.
   * Se a variante já está activa, desactiva-a. Caso contrário, activa-a
   * (sem desactivar outras variantes da mesma linha — permite múltiplas
   * variantes activas em simultâneo, cada uma com a sua direcção).
   *
   * @param {Object} route     - variante a activar/desactivar
   * @param {Array}  [variants] - todas as variantes da mesma linha (não usado
   *                               para desactivar as outras; mantido para
   *                               eventual lógica futura)
   */
  _toggleRouteVariant(route, variants = null) {
    if (!route) return;
    const routeId = this._routeId(route);
    if (this.selected.has(routeId)) {
      this.selected.delete(routeId);
    } else {
      this.selected.set(routeId, { route, direction: 0 });
    }
    this._render();
    this._emit();
  }

  _toggleDirectionVariant(route) {
    if (!route) return;
    const routeId = this._routeId(route);
    const entry = this.selected.get(routeId);
    if (!entry) return;
    entry.direction = entry.direction === 0 ? 1 : 0;
    this.selected.set(routeId, entry);
    this._render();
    this._emit();
  }

  _clearAll() {
    this.selected.clear();
    this._expandedLineFamilies.clear();
    this._render();
    this._emit();
  }

  /**
   * Emite o estado actual do filtro.
   *  - selectedLineNumbers: Set<string> de NÚMEROS de linha com pelo menos
   *    uma variante activa (usado para filtrar chegadas/veículos por linha).
   *  - selectedRouteObjs: Array de VARIANTES activas, cada uma com routeId,
   *    number e direction — usado para overlays de mapa e direcção por
   *    percurso.
   */
  _emit() {
    if (!this._onFilterChange) return;

    const selectedRouteObjs = Array.from(this.selected.values()).map(e => ({
      ...e.route,
      routeId: this._routeId(e.route),
      id: this._routeId(e.route),
      number: String(e.route.number ?? e.route.id),
      direction: e.direction,
    }));

    const selectedLineNumbers = new Set(
        selectedRouteObjs.map(r => String(r.number))
    );

    this._onFilterChange(selectedLineNumbers, selectedRouteObjs);
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  _tint(hex, amount) {
    try {
      const n = parseInt(hex.replace('#', ''), 16);
      const r = Math.round(((n >> 16) & 0xff) * (1 - amount) + 255 * amount);
      const g = Math.round(((n >> 8) & 0xff) * (1 - amount) + 255 * amount);
      const b = Math.round((n & 0xff) * (1 - amount) + 255 * amount);
      return `rgb(${r},${g},${b})`;
    } catch { return hex; }
  }

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
    if (this._timeCheckInterval) clearInterval(this._timeCheckInterval);
    if (this.container) this.container.innerHTML = '';
  }
}