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

  /**
   * Inicializar o mapa
   */
  initialize(getUserPosition = null) {
    this.mapInitializer = new MapInitializer(
      this.elementId,
      this.options.center,
      this.options.zoom
    );
    
    // Se getUserPosition for null, usa this.getUserPosition.bind(this)
    const positionGetter = getUserPosition || (() => this.userPosition);
    this.map = this.mapInitializer.initialize(positionGetter);
    
    console.log(`✓ MapManager inicializado para elemento #${this.elementId}`);
    return this.map;
  }

  /**
   * Aguardar que o mapa esteja pronto
   */
  async waitForReady() {
    return new Promise((resolve) => {
      if (this.map && this.map._loaded) {
        resolve();
        return;
      }
      const checkInterval = setInterval(() => {
        if (this.map && this.map._loaded) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(checkInterval);
        console.warn('⚠ Timeout ao aguardar mapa estar pronto');
        resolve();
      }, 3000);
    });
  }

  /**
   * Adicionar marcador genérico
   */
  addMarker(id, position, icon, popupContent = null) {
    if (!this.map) {
      console.error('❌ Mapa não inicializado');
      return null;
    }

    const marker = L.marker(position, { icon }).addTo(this.map);
    if (popupContent) {
      marker.bindPopup(popupContent);
    }
    this.markers[id] = marker;
    return marker;
  }

  /**
   * Remover marcador
   */
  removeMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
    }
  }

  /**
   * Atualizar posição de um marcador
   */
  updateMarker(id, position, icon = null, popupContent = null) {
    if (this.markers[id]) {
      this.markers[id].setLatLng(position);
      if (icon) this.markers[id].setIcon(icon);
      if (popupContent) this.markers[id].bindPopup(popupContent);
    }
  }

  /**
   * Centrar mapa numa posição
   */
  centerOn(position, zoom = null) {
    if (!this.map) return;
    const targetZoom = zoom || this.map.getZoom();
    this.map.setView(position, targetZoom);
  }

  /**
   * Ajustar mapa para mostrar todos os pontos
   */
  fitBounds(positions, options = {}) {
    if (!this.map || !positions || positions.length === 0) return;
    const bounds = L.latLngBounds(positions);
    this.map.fitBounds(bounds, {
      padding: [50, 50],
      maxZoom: 16,
      ...options
    });
  }

  /**
   * Definir posição do utilizador
   */
  setUserPosition(lat, lon) {
    this.userPosition = [lat, lon];
  }

  /**
   * Obter posição do utilizador
   */
  getUserPosition() {
    return this.userPosition;
  }

  /**
   * Criar/atualizar marcador do utilizador
   */
  updateUserMarker(position) {
    this.userPosition = position;
    if (!this.userMarker) {
      this.userMarker = this.mapInitializer.createUserMarker(position);
    } else {
      this.userMarker.setLatLng(position);
    }
  }

  /**
   * Centrar no utilizador
   */
  centerOnUser(zoom = 16) {
    if (this.userPosition) {
      this.centerOn(this.userPosition, zoom);
    } else {
      console.warn('⚠ Localização do utilizador não disponível');
    }
  }

  /**
   * Limpar todos os marcadores
   */
  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeMarker(id));
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.clearAllMarkers();
    if (this.userMarker) {
      this.map.removeLayer(this.userMarker);
      this.userMarker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
