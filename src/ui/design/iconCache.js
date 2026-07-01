// iconCache.js - cache centralizado de ícones de autocarros, paragens e utilizador

import { createBusIcon }                from '../../../resources/busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../../../resources/busDesign/busColors.js';

class IconCache {
  constructor() {
    this.cache = {
      bus:  {},
      stop: null,
      user: null,
    };
    // Mapa linha -> { busColor, textColor } populado por registerRouteColors()
    this._routeColors = new Map();
  }

  // ── Registo de cores vindas da API ─────────────────────────────────────────

  /**
   * Recebe a lista de rotas do routeService.fetchRoutesList() e guarda as
   * cores de cada linha para uso nos popups e outros elementos dinâmicos.
   * Deve ser chamado assim que a lista de rotas estiver disponível.
   *
   * @param {Array<{id:string, number:string, color:string, text_color:string}>} routes
   */
  registerRouteColors(routes) {
    if (!Array.isArray(routes)) return;
    for (const r of routes) {
      const key = String(r.number ?? r.id ?? '').trim();
      if (!key) continue;
      const bg   = r.color      ? (r.color.startsWith('#')      ? r.color      : '#' + r.color)      : null;
      const text = r.text_color ? (r.text_color.startsWith('#') ? r.text_color : '#' + r.text_color) : null;
      if (bg) this._routeColors.set(key, { busColor: bg, textColor: text || '#fff' });
    }
  }

  /**
   * Devolve { busColor, textColor } para uma linha, com fallback em cascata:
   *   1. Cores registadas via registerRouteColors() (vêm da API)
   *   2. BUS_COLORS hardcoded
   *   3. null (sem cor conhecida → o chamador usa o fallback STCP)
   *
   * @param {string} line  - número da linha (ex: '200', '204', '5')
   * @returns {{ busColor: string, textColor: string } | null}
   */
  getRouteColor(line) {
    const key = String(line ?? '').trim();
    if (this._routeColors.has(key)) return this._routeColors.get(key);
    if (BUS_COLORS[key])            return BUS_COLORS[key];
    return null;
  }

  // ── Ícones ──────────────────────────────────────────────────────────────────

  getBusIcon(line) {
    if (this.cache.bus[line]) return this.cache.bus[line];
    this.cache.bus[line] = createBusIcon(line, BUS_COLORS, CUSTOM_LINE_TEXTS);
    return this.cache.bus[line];
  }

  getStopIcon() {
    if (this.cache.stop) return this.cache.stop;
    this.cache.stop = L.divIcon({
      className: 'custom-stop-marker',
      html: '<div class="stop-dot"></div>',
      iconSize:   [16, 16],
      iconAnchor: [8, 8],
    });
    return this.cache.stop;
  }

  getUserIcon() {
    if (this.cache.user) return this.cache.user;
    this.cache.user = L.icon({
      iconUrl:    'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      iconSize:   [25, 41],
      iconAnchor: [12, 41],
      popupAnchor:[1, -34],
    });
    return this.cache.user;
  }

  getIcon(line, type = 'bus') {
    if (type === 'bus')  return this.getBusIcon(line);
    if (type === 'stop') return this.getStopIcon();
    if (type === 'user') return this.getUserIcon();
    return this.getBusIcon(line);
  }

  clearCache() {
    this.cache = { bus: {}, stop: null, user: null };
    // Não limpar _routeColors — essas cores são permanentes durante a sessão
  }
}

export const iconCache = new IconCache();
