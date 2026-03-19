/**
 * MapManager - Classe base para todos os mapas
 * Fornece API unificada para operações comuns
 */

import { MapInitializer } from './utils/mapInitializer.js';

export class MapManager {
  constructor(elementId, options = {}) {
    this.elementId = elementId;
    this.options = {
      center: [41.1579, -8.6291],
      zoom: 13,
      ...options
    };
    this.map = null;
    this.mapInitializer = null;
    this.markers = {};
    this.userMarker = null;
    this.userPosition = null;
  }

  initialize(getUserPosition = null) {
    this.mapInitializer = new MapInitializer(
      this.elementId,
      this.options.center,
      this.options.zoom
    );
    const positionGetter = getUserPosition || (() => this.userPosition);
    this.map = this.mapInitializer.initialize(positionGetter);
    return this.map;
  }

  async waitForReady() {
    return new Promise((resolve) => {
      if (this.map && this.map._loaded) { resolve(); return; }
      const checkInterval = setInterval(() => {
        if (this.map && this.map._loaded) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 3000);
    });
  }

  addMarker(id, position, icon, popupContent = null) {
    if (!this.map) { console.error('❌ Mapa não inicializado'); return null; }
    const marker = L.marker(position, { icon }).addTo(this.map);
    if (popupContent) marker.bindPopup(popupContent);
    this.markers[id] = marker;
    return marker;
  }

  removeMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
    }
  }

  updateMarker(id, position, icon = null, popupContent = null) {
    if (this.markers[id]) {
      this.markers[id].setLatLng(position);
      if (icon) this.markers[id].setIcon(icon);
      if (popupContent) this.markers[id].bindPopup(popupContent);
    }
  }

  centerOn(position, zoom = null) {
    if (!this.map) return;
    this.map.setView(position, zoom || this.map.getZoom());
  }

  /**
   * Centrar com offset em pixels — útil quando há UI (ex: bottom sheet) a tapar parte do mapa.
   * offsetYPx positivo desloca o centro para baixo, fazendo o ponto aparecer mais acima no ecrã.
   */
  centerOnWithOffset(position, zoom = null, offsetYPx = 0, offsetXPx = 0) {
    if (!this.map) return;
    const targetZoom = zoom || this.map.getZoom();
    const latlng = L.latLng(position[0], position[1]);
    const point = this.map.project(latlng, targetZoom);
    const shifted = point.add(L.point(offsetXPx, offsetYPx));
    this.map.setView(this.map.unproject(shifted, targetZoom), targetZoom);
  }

  /**
   * Ajustar mapa para mostrar todos os pontos.
   * Suporta a opção extra `minZoom` (não nativa do Leaflet) que garante
   * que o mapa não fica excessivamente afastado mesmo quando há padding grande.
   */
  fitBounds(positions, options = {}) {
    if (!this.map || !positions || positions.length === 0) return;

    // Extrair minZoom das opções (não é suportado nativamente pelo Leaflet)
    const { minZoom, ...leafletOptions } = options;

    const bounds = L.latLngBounds(positions);
    this.map.fitBounds(bounds, {
      paddingTopLeft: [15, 15],
      paddingBottomRight: [15, 15],
      maxZoom: 17,
      ...leafletOptions
    });

    // Aplicar zoom mínimo após o Leaflet terminar a animação (~200ms)
    if (minZoom !== undefined) {
      setTimeout(() => {
        if (this.map && this.map.getZoom() < minZoom) {
          this.map.setZoom(minZoom, { animate: true });
        }
      }, 250);
    }
  }

  setUserPosition(lat, lon) { this.userPosition = [lat, lon]; }
  getUserPosition() { return this.userPosition; }

  updateUserMarker(position) {
    this.userPosition = position;
    if (!this.userMarker) {
      this.userMarker = this.mapInitializer.createUserMarker(position);
    } else {
      this.userMarker.setLatLng(position);
    }
  }

  centerOnUser(zoom = 16) {
    if (this.userPosition) {
      this.centerOn(this.userPosition, zoom);
    } else {
      console.warn('⚠ Localização do utilizador não disponível');
    }
  }

  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeMarker(id));
  }

  cleanup() {
    this.clearAllMarkers();
    if (this.userMarker) { this.map.removeLayer(this.userMarker); this.userMarker = null; }
    if (this.map) { this.map.remove(); this.map = null; }
  }
}
