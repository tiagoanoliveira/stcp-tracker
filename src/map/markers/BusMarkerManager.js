/**
 * BusMarkerManager - Gestão especializada de marcadores de autocarros
 * Usa iconCache para ícones e gere lifecycle completo dos markers
 */

import { iconCache } from '../../ui/design/iconCache.js';

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers = {};
  }

  /**
   * Atualizar todos os marcadores de autocarros
   * @param {Array} busData - Array de dados de autocarros processados
   */
  updateBusMarkers(busData) {
    const validIDs = new Set();

    busData.forEach(bus => {
      validIDs.add(bus.id);

      const popupContent = this.createPopupContent(bus);
      const icon = iconCache.getBusIcon(bus.line);

      if (this.markers[bus.id]) {
        // Atualizar marcador existente
        this.markers[bus.id].setLatLng([bus.latitude, bus.longitude]);
        this.markers[bus.id].setIcon(icon);
        this.markers[bus.id].bindPopup(popupContent);
      } else {
        // Criar novo marcador
        this.createBusMarker(bus.id, bus, icon, popupContent);
      }
    });

    // Remover marcadores que já não existem
    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) {
        this.removeBusMarker(id);
      }
    });

    console.log(`✓ ${busData.length} marcadores de autocarros atualizados`);
  }

  /**
   * Criar marcador de autocarro
   */
  createBusMarker(id, bus, icon, popupContent) {
    const marker = L.marker([bus.latitude, bus.longitude], { icon })
      .addTo(this.map);
    marker.bindPopup(popupContent);
    this.markers[id] = marker;
    return marker;
  }

  /**
   * Remover marcador de autocarro
   */
  removeBusMarker(id) {
    if (this.markers[id]) {
      this.map.removeLayer(this.markers[id]);
      delete this.markers[id];
    }
  }

  /**
   * Criar conteúdo do popup
   */
  createPopupContent(bus) {
    return `
      <div class="bus-popup">
        <strong>Linha: ${bus.line}</strong><br>
        Destino: ${bus.destination}<br>
        Velocidade: ${bus.speed} km/h<br>
        Veículo nº ${bus.busNumber}
      </div>
    `;
  }

  /**
   * Obter todas as posições dos autocarros
   */
  getAllPositions() {
    return Object.values(this.markers).map(marker => marker.getLatLng());
  }

  /**
   * Abrir popup de um autocarro específico
   */
  openPopup(busId) {
    if (this.markers[busId]) {
      this.markers[busId].openPopup();
    }
  }

  /**
   * Limpar todos os marcadores
   */
  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeBusMarker(id));
    console.log('🖮 Todos os marcadores de autocarros removidos');
  }

  /**
   * Obter número de marcadores ativos
   */
  getMarkerCount() {
    return Object.keys(this.markers).length;
  }
}
