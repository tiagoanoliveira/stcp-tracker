/**
 * BusMarkerManager - Gest\u00e3o especializada de marcadores de autocarros
 */

import { iconCache } from '../../ui/design/iconCache.js';

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers = {};
    // mapa de busId -> n\u00famero de linha (ex: '200', '1M')
    this._markerRoutes = {};
  }

  /**
   * Associa um busId a um n\u00famero de linha.
   * Chamado por StopsMapApp ap\u00f3s processar cada autocarro.
   */
  setRouteForMarker(busId, routeNumber) {
    this._markerRoutes[busId] = String(routeNumber || '');
  }

  /**
   * Mostra apenas os marcadores cujas linhas est\u00e3o no Set fornecido.
   * Se o Set estiver vazio, mostra todos.
   * @param {Set<string>} selectedRoutes
   * @returns {Array<[number,number]>} posi\u00e7\u00f5es dos markers vis\u00edveis
   */
  filterByRoutes(selectedRoutes) {
    const showAll = !selectedRoutes || selectedRoutes.size === 0;
    const visiblePositions = [];

    Object.entries(this.markers).forEach(([id, marker]) => {
      const routeNum = this._markerRoutes[id] || '';
      const visible = showAll || selectedRoutes.has(routeNum);

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

  updateBusMarkers(busData) {
    const validIDs = new Set();

    busData.forEach(bus => {
      validIDs.add(bus.id);
      const popupContent = this.createPopupContent(bus);
      const icon = iconCache.getBusIcon(bus.line);

      if (this.markers[bus.id]) {
        this.markers[bus.id].setLatLng([bus.latitude, bus.longitude]);
        this.markers[bus.id].setIcon(icon);
        this.markers[bus.id].bindPopup(popupContent);
      } else {
        this.createBusMarker(bus.id, bus, icon, popupContent);
      }
    });

    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) this.removeBusMarker(id);
    });
  }

  createBusMarker(id, bus, icon, popupContent) {
    const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(this.map);
    marker.bindPopup(popupContent);
    this.markers[id] = marker;
    return marker;
  }

  removeBusMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
      delete this._markerRoutes[id];
    }
  }

  createPopupContent(bus) {
    return `
      <div class="bus-popup">
        <strong>Linha: ${bus.line}</strong><br>
        Destino: ${bus.destination}<br>
        Velocidade: ${bus.speed} km/h<br>
        Ve\u00edculo n\u00ba ${bus.busNumber}
      </div>
    `;
  }

  getAllPositions() {
    return Object.values(this.markers).map(m => m.getLatLng());
  }

  openPopup(busId) {
    if (this.markers[busId]) this.markers[busId].openPopup();
  }

  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeBusMarker(id));
    this._markerRoutes = {};
  }

  getMarkerCount() {
    return Object.keys(this.markers).length;
  }
}
