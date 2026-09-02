/**
 * routeFilterState — singleton que centraliza o estado dos filtros de linha
 * activos em qualquer página (BusMapApp e StopsMapApp).
 *
 * Tanto a barra global (RouteFilterBar) como o painel de chegadas
 * (NextArrivals) devem consultar/actualizar este módulo em vez de
 * manterem estado privado duplicado.
 *
 * MODELO DE DADOS (suporta múltiplos percursos/variantes por linha):
 *
 *   selectedRoutes            Set<string>              números de linha
 *                                                       ("200", "ZC", "3M", …)
 *                                                       com pelo menos uma
 *                                                       variante activa.
 *
 *   selectedRouteObjs         Array<Object>             VARIANTES activas.
 *                                                       Cada objecto tem
 *                                                       routeId (identidade
 *                                                       única do percurso),
 *                                                       number (linha) e
 *                                                       direction (0|1).
 *
 *   routeDirMap               Map<routeId, direction>   direcção por
 *                                                       VARIANTE/percurso.
 *                                                       Usar quando se sabe
 *                                                       o routeId exacto
 *                                                       (ex: overlays de
 *                                                       mapa, cálculo de
 *                                                       direcção por rota).
 *
 *   allowedDirectionsByNumber Map<number, Set<direction>> direcções
 *                                                       permitidas por
 *                                                       NÚMERO de linha —
 *                                                       agrega as direcções
 *                                                       de todas as
 *                                                       variantes activas
 *                                                       dessa linha. Usar
 *                                                       para filtrar
 *                                                       marcadores de
 *                                                       veículos, que só
 *                                                       conhecem a linha
 *                                                       (displayLine) e a
 *                                                       direcção do GPS, não
 *                                                       o routeId exacto.
 *
 * Nota de compatibilidade: quando uma linha tem apenas UMA variante activa,
 * allowedDirectionsByNumber.get(number) comporta-se como antes (um único
 * valor de direcção), mas agora suporta várias direcções em simultâneo
 * quando há múltiplas variantes da mesma linha activas (ex: ida E volta de
 * dois percursos diferentes da mesma linha).
 */

class RouteFilterState {
  constructor() {
    /** @type {Set<string>} números de linha activos (ex: 'ZC', '200', '3M') */
    this.selectedRoutes = new Set();

    /** @type {Array<Object>} variantes/percursos activos (routeId + direction) */
    this.selectedRouteObjs = [];

    /** @type {Map<string, number>} routeId (variante) → direcção (0|1) */
    this.routeDirMap = new Map();

    /** @type {Map<string, Set<number>>} número de linha → direcções permitidas */
    this.allowedDirectionsByNumber = new Map();

    // ── Compatibilidade retroativa ──────────────────────────────────────
    // Código antigo pode ainda ler `dirMap` à espera de Map<number, direction>
    // (um único valor). Mantemos este alias apontando para a 1.ª direcção
    // conhecida de cada linha, para não rebentar chamadores não migrados.
    this.dirMap = new Map();
  }

  /**
   * Actualiza o estado a partir da barra global (RouteFilterBar) ou de
   * qualquer origem que produza uma lista de VARIANTES seleccionadas.
   *
   * @param {Set<string>}   selected  - números de linha (informativo; é
   *                                    recalculado a partir de routeObjs)
   * @param {Array<Object>} routeObjs - variantes activas, cada uma com
   *                                    routeId (ou id), number e direction
   */
  set(selected, routeObjs) {
    this.selectedRouteObjs = (routeObjs || []).map(r => ({
      ...r,
      routeId: String(r.routeId ?? r.id ?? r.number),
      number:  String(r.number ?? r.id ?? r.routeId),
      direction: r.direction ?? 0,
    }));

    this.selectedRoutes = new Set(
        this.selectedRouteObjs.map(r => String(r.number))
    );

    this._rebuildDerivedMaps();
  }

  /** Limpa todos os filtros activos. */
  clear() {
    this.selectedRoutes = new Set();
    this.selectedRouteObjs = [];
    this.routeDirMap = new Map();
    this.allowedDirectionsByNumber = new Map();
    this.dirMap = new Map();
  }

  /** @returns {boolean} */
  hasActive() {
    return this.selectedRouteObjs.length > 0;
  }

  /**
   * Devolve o subconjunto de um array de chegadas que corresponde aos
   * filtros activos (por NÚMERO de linha — uma chegada não tem routeId).
   * Se não houver filtros activos, devolve tudo.
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

  /**
   * Actualiza apenas as direcções das variantes já activas (sem alterar
   * quais linhas/percursos estão seleccionados). Necessário porque a
   * direcção correcta só pode, nalguns casos, ser determinada de forma
   * assíncrona (verificação contra as paragens reais da linha).
   *
   * @param {Map<string, number>} routeDirMap - routeId (variante) → direcção
   */
  updateDirections(routeDirMap) {
    this.routeDirMap = new Map(routeDirMap);

    this.selectedRouteObjs = this.selectedRouteObjs.map(r => {
      const key = String(r.routeId ?? r.id ?? r.number);
      return this.routeDirMap.has(key)
          ? { ...r, direction: this.routeDirMap.get(key) }
          : r;
    });

    this._rebuildDerivedMaps();
  }

  /**
   * Recalcula selectedRoutes, allowedDirectionsByNumber e dirMap (legado)
   * a partir de selectedRouteObjs. Chamado sempre que a lista de variantes
   * activas ou as suas direcções mudam.
   * @private
   */
  _rebuildDerivedMaps() {
    this.selectedRoutes = new Set(
        this.selectedRouteObjs.map(r => String(r.number))
    );

    const byNumber = new Map();
    const legacyDirMap = new Map();

    for (const r of this.selectedRouteObjs) {
      const number = String(r.number);
      const direction = r.direction ?? 0;

      if (!byNumber.has(number)) byNumber.set(number, new Set());
      byNumber.get(number).add(direction);

      // Legado: guarda a primeira direcção conhecida para esta linha
      if (!legacyDirMap.has(number)) legacyDirMap.set(number, direction);
    }

    this.allowedDirectionsByNumber = byNumber;
    this.dirMap = legacyDirMap;
  }
}

export const routeFilterState = new RouteFilterState();