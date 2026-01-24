// iconCache.js - cache centralizado de ícones de autocarros, paragens e utilizador

import { createBusIcon } from '../../resources/busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../../resources/busDesign/busColors.js';

class IconCache {
  constructor() {
    this.cache = {
      bus: {},
      stop: null,
      user: null
    };
  }

  /**
   * Obter ícone de autocarro para uma linha
   */
  getBusIcon(line) {
    if (this.cache.bus[line]) return this.cache.bus[line];
    this.cache.bus[line] = createBusIcon(line, BUS_COLORS, CUSTOM_LINE_TEXTS);
    return this.cache.bus[line];
  }

  /**
   * Obter ícone de paragem (placeholder por agora)
   */
  getStopIcon() {
    if (this.cache.stop) return this.cache.stop;
    this.cache.stop = L.divIcon({
      className: 'custom-stop-marker',
      html: '<div class="stop-dot"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    return this.cache.stop;
  }

  /**
   * Obter ícone de utilizador
   */
  getUserIcon() {
    if (this.cache.user) return this.cache.user;
    this.cache.user = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34]
    });
    return this.cache.user;
  }

  /**
   * API genérica
   */
  getIcon(line, type = 'bus') {
    if (type === 'bus') return this.getBusIcon(line);
    if (type === 'stop') return this.getStopIcon();
    if (type === 'user') return this.getUserIcon();
    return this.getBusIcon(line);
  }

  clearCache() {
    this.cache = { bus: {}, stop: null, user: null };
  }
}

export const iconCache = new IconCache();
