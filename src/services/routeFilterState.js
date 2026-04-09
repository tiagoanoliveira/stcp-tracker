/**
 * routeFilterState — singleton que centraliza o estado dos filtros de linha
 * activos em qualquer página (BusMapApp e StopsMapApp).
 *
 * Tanto a barra global (RouteFilterBar) como o painel de chegadas
 * (NextArrivals) devem consultar/actualizar este módulo em vez de
 * manterem estado privado duplicado.
 */

class RouteFilterState {
  constructor() {
    /** @type {Set<string>} números de linha activos (ex: 'ZC', '200', '3M') */
    this.selectedRoutes = new Set();

    /** @type {Array<Object>} objectos de rota com campo direction */
    this.selectedRouteObjs = [];

    /** @type {Map<string, number>} número → direcção (0|1) */
    this.dirMap = new Map();
  }

  /**
   * Actualiza o estado a partir da barra global.
   * @param {Set<string>} selected
   * @param {Array<Object>} routeObjs
   */
  set(selected, routeObjs) {
    this.selectedRoutes    = new Set(selected);
    this.selectedRouteObjs = routeObjs || [];
    this.dirMap            = new Map(this.selectedRouteObjs.map(r => [String(r.number), r.direction ?? 0]));
  }

  /** Limpa todos os filtros activos. */
  clear() {
    this.selectedRoutes    = new Set();
    this.selectedRouteObjs = [];
    this.dirMap            = new Map();
  }

  /** @returns {boolean} */
  hasActive() {
    return this.selectedRoutes.size > 0;
  }

  /**
   * Devolve o subconjunto de um array de chegadas que corresponde aos
   * filtros activos.  Se não houver filtros activos, devolve tudo.
   * @param {Array<Object>} arrivals
   * @returns {Array<Object>}
   */
  filterArrivals(arrivals) {
    if (!this.hasActive()) return arrivals;
    return arrivals.filter(a => {
      const num = String(a.route_short_name || a.route_number || a.route_id || '');
      return this.selectedRoutes.has(num);
    });
  }
}

export const routeFilterState = new RouteFilterState();
