/**
 * BusMarkerManager - Gestão de marcadores de autocarros
 *
 * Popup lazy: o destino (headsign) é resolvido apenas no primeiro clique,
 * a menos que bus.destination já esteja preenchido (ex: vindo do protobuf MQTT).
 *
 * DEDUPLICAÇÃO:
 *   Antes de criar qualquer marcador, o método _upsertMarker() verifica se já
 *   existe um marcador com o mesmo id (independentemente da origem — FIWARE
 *   bootstrap ou MQTT). Se existir, o marcador é movido e actualizado em vez
 *   de se criar um duplicado. Isto garante que cada veículo tem exactamente
 *   um marcador no mapa em qualquer momento.
 *
 *   updateBusMarkers()     — actualiza o conjunto completo de marcadores;
 *                            remove os que já não constam na lista.
 *   updateSingleBusMarker()— actualiza (ou cria) um único marcador;
 *                            usado pelo callback onVehicleUpdate do MQTT.
 *
 * COR DO POPUP:
 *   _createPopupContent() e _createLoadingPopup() recebem a cor da linha
 *   via iconCache.getRouteColor(). Isso garante que o cabeçalho do popup
 *   usa a cor real da linha em vez do azul STCP fixo.
 */

import { iconCache }      from '../../ui/design/iconCache.js';
import { vehicleService } from '../../services/vehicleService.js';

// SVGs inline para os ícones do popup (evita dependências externas)
const _ICON_SPEED = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M16.95 7.05a7 7 0 1 0 0 9.9"/><path d="m12 12 3-4"/></svg>`;

/** Devolve a cor de fundo e a cor de texto de uma linha, com fallback seguro. */
function _lineColors(line) {
  const color = iconCache.getRouteColor?.(line);
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    // Calcular luminância para decidir se o texto é branco ou escuro
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return { bg: color, text: lum > 0.55 ? '#1a1a1a' : '#ffffff' };
  }
  return { bg: '#0072c6', text: '#ffffff' };
}

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers       = {};   // busId -> L.Marker
    this._busData      = {};   // busId -> objecto processado
    this._markerRoutes = {};   // busId -> displayLine string
    this._markerDirs   = {};   // busId -> direction number (0|1)
  }

  setRouteForMarker(busId, routeNumber, direction) {
    this._markerRoutes[busId] = String(routeNumber || '');
    this._markerDirs[busId]   = direction != null ? Number(direction) : null;
  }

  /**
   * Filtra marcadores por linha e, opcionalmente, por direção.
   */
  filterByRoutes(selectedRoutes, routeDirMap) {
    const showAll = !selectedRoutes || selectedRoutes.size === 0;
    const visiblePositions = [];

    Object.entries(this.markers).forEach(([id, marker]) => {
      const bus         = this._busData[id];
      const displayLine = (bus?.displayLine) || this._markerRoutes[id] || '';
      const markerDir   = this._markerDirs[id];

      let visible = showAll || selectedRoutes.has(displayLine);

      if (visible && routeDirMap && routeDirMap.has(displayLine) && markerDir !== null) {
        visible = markerDir === routeDirMap.get(displayLine);
      }

      if (visible) {
        if (!this.map.hasLayer(marker)) marker.addTo(this.map);
        const ll = marker.getLatLng();
        visiblePositions.push([ll.lat, ll.lng]);
      } else {
        if (this.map.hasLayer(marker)) this.map.removeLayer(marker);
      }
    });
    return visiblePositions;
  }

  // ─── Método central de upsert ──────────────────────────────────────────────

  _upsertMarker(bus) {
    this._busData[bus.id] = bus;
    const icon = iconCache.getBusIcon(bus.line);

    if (this.markers[bus.id]) {
      const marker = this.markers[bus.id];
      marker.setLatLng([bus.latitude, bus.longitude]);
      marker.setIcon(icon);
      if (bus.destination !== null && bus.destination !== undefined) {
        marker.setPopupContent(this._createPopupContent(bus));
      }
      return marker;
    }

    return this._createBusMarker(bus);
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  updateBusMarkers(busData) {
    const validIDs = new Set();
    busData.forEach(bus => {
      validIDs.add(bus.id);
      this._upsertMarker(bus);
    });
    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) this.removeBusMarker(id);
    });
  }

  updateSingleBusMarker(bus) {
    this._upsertMarker(bus);
  }

  // ─── Criação de marcador ───────────────────────────────────────────────────

  _createBusMarker(bus) {
    const icon         = iconCache.getBusIcon(bus.line);
    const popupContent = (bus.destination !== null && bus.destination !== undefined)
      ? this._createPopupContent(bus)
      : this._createLoadingPopup(bus);
    const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(this.map);
    marker.bindPopup(popupContent, { maxWidth: 200, className: 'bus-popup-wrapper' });
    marker.on('popupopen', () => this._resolvePopupHeadsign(bus.id, marker));
    this.markers[bus.id] = marker;
    return marker;
  }

  async _resolvePopupHeadsign(busId, marker) {
    const bus = this._busData[busId];
    if (!bus) return;
    if (bus.destination !== null && bus.destination !== undefined) {
      marker.setPopupContent(this._createPopupContent(bus));
      return;
    }
    const destination = await vehicleService.resolveHeadsign(bus);
    bus.destination = destination;
    this._busData[busId] = bus;
    marker.setPopupContent(this._createPopupContent(bus));
  }

  // ─── Templates dos popups ─────────────────────────────────────────────────

  _createLoadingPopup(bus) {
    const line   = bus.displayLine ?? bus.line ?? '?';
    const colors = _lineColors(line);
    return `
      <div>
        <div class="bus-popup__header" style="background:${colors.bg};">
          <span class="bus-popup__badge" style="color:${colors.bg};">${line}</span>
          <span class="bus-popup__destination">A carregar…</span>
        </div>
        <div class="bus-popup__body">
          <div class="bus-popup__row" style="--popup-accent:${colors.bg}">
            ${_ICON_SPEED}
            <span>${bus.speed != null ? bus.speed + ' km/h' : 'N/D'}</span>
          </div>
          <div class="bus-popup__vehicle">Veículo nº ${bus.busNumber ?? '—'}</div>
        </div>
      </div>`;
  }

  _createPopupContent(bus) {
    const line        = bus.displayLine ?? bus.line ?? '?';
    const colors      = _lineColors(line);
    const destination = bus.destination || 'Desconhecido';
    const speed       = bus.speed != null ? bus.speed + ' km/h' : 'N/D';
    const vehicle     = bus.busNumber ?? '—';
    return `
      <div>
        <div class="bus-popup__header" style="background:${colors.bg};">
          <span class="bus-popup__badge" style="color:${colors.bg};">${line}</span>
          <span class="bus-popup__destination" style="color:${colors.text};" title="${destination}">${destination}</span>
        </div>
        <div class="bus-popup__body">
          <div class="bus-popup__row" style="--popup-accent:${colors.bg}">
            ${_ICON_SPEED}
            <span>${speed}</span>
          </div>
          <div class="bus-popup__vehicle">Veículo nº ${vehicle}</div>
        </div>
      </div>`;
  }

  // ─── Utilitários ──────────────────────────────────────────────────────────

  removeBusMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
      delete this._busData[id];
      delete this._markerRoutes[id];
      delete this._markerDirs[id];
    }
  }

  hideAllMarkers() {
    Object.values(this.markers).forEach(m => {
      if (this.map.hasLayer(m)) this.map.removeLayer(m);
    });
  }

  openPopup(busId) {
    if (this.markers[busId]) this.markers[busId].openPopup();
  }

  getAllPositions() {
    return Object.values(this.markers).map(m => m.getLatLng());
  }

  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeBusMarker(id));
    this._markerRoutes = {};
    this._markerDirs   = {};
    this._busData      = {};
  }

  getMarkerCount() { return Object.keys(this.markers).length; }
}
