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
 *   de se criar um duplicado.
 *
 * COR DO POPUP:
 *   _lineColors() consulta iconCache.getRouteColor() que verifica em cascata:
 *     1. Cores registadas via iconCache.registerRouteColors() (vindas da API)
 *     2. BUS_COLORS hardcoded (busColors.js)
 *     3. Fallback azul STCP #0072c6
 *   Para que as cores da API estejam disponíveis, o código que chama
 *   routeService.fetchRoutesList() deve passar o resultado a
 *   iconCache.registerRouteColors() logo a seguir.
 */

import { iconCache }      from '../../ui/design/iconCache.js';
import { vehicleService } from '../../services/vehicleService.js';

const _ICON_SPEED = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M16.95 7.05a7 7 0 1 0 0 9.9"/><path d="m12 12 3-4"/></svg>`;

/**
 * Devolve { bg, text } para o cabeçalho do popup.
 * Lê as cores registadas pela API; fallback para azul STCP.
 */
function _lineColors(line) {
  const colors = iconCache.getRouteColor(String(line ?? '').trim());
  if (colors?.busColor) {
    return { bg: colors.busColor, text: colors.textColor || '#fff' };
  }
  return { bg: '#0072c6', text: '#fff' };
}

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers       = {};
    this._busData      = {};
    this._markerRoutes = {};
    this._markerDirs   = {};
  }

  setRouteForMarker(busId, routeNumber, direction) {
    this._markerRoutes[busId] = String(routeNumber || '');
    this._markerDirs[busId]   = direction != null ? Number(direction) : null;
  }

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

  // ─── Upsert central ──────────────────────────────────────────────────────

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

  // ─── API pública ─────────────────────────────────────────────────────────

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

  // ─── Criação de marcador ─────────────────────────────────────────────────

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

  // ─── Templates dos popups ────────────────────────────────────────────────

  _createLoadingPopup(bus) {
    const line   = bus.displayLine ?? bus.line ?? '?';
    const colors = _lineColors(line);
    return `
      <div>
        <div class="bus-popup__header" style="background:${colors.bg};">
          <span class="bus-popup__badge" style="color:${colors.bg};">${line}</span>
          <span class="bus-popup__destination" style="color:${colors.text};">A carregar…</span>
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

  // ─── Utilitários ─────────────────────────────────────────────────────────

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
