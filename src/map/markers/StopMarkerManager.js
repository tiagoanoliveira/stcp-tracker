/**
 * StopMarkerManager - Gestão especializada de marcadores de paragens
 */

export class StopMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers = {};
  }

  /**
   * Atualizar todos os marcadores de paragens
   * @param {Array} stops - Array de paragens
   * @param {boolean} showDistance - Mostrar distância no popup
   */
  updateStopMarkers(stops, showDistance = false) {
    this.clearAllMarkers();
    stops.forEach(stop => this.addStopMarker(stop, showDistance));
    console.log(`✓ ${stops.length} marcadores de paragens atualizados`);
  }

  /**
   * Adicionar marcador de paragem
   */
  addStopMarker(stop, showDistance = false) {
    const icon = this.createStopIcon();
    const popupContent = this.createPopupContent(stop, showDistance);

    const marker = L.marker([stop.latitude, stop.longitude], {
      icon: icon,
      title: stop.stop_name
    }).addTo(this.map);

    marker.bindPopup(popupContent);
    
    marker.on('click', () => {
      this.map.setView([stop.latitude, stop.longitude], 16);
    });

    this.markers[stop.stop_id] = marker;
    return marker;
  }

  /**
   * Criar ícone de paragem
   */
  createStopIcon() {
    return L.divIcon({
      className: 'custom-stop-marker',
      html: `
        <div style="position: relative;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0072C6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="3" x2="12" y2="21" />
            <rect x="4" y="3" width="16" height="11" rx="1" fill="#5EDDC1" stroke="#0072C6"/>
            <rect x="7" y="6" width="10" height="4" rx="0.5" fill="#0072C6"/>
            <circle cx="9" cy="11.2" r="0.5" fill="white"/>
            <circle cx="15" cy="11.2" r="0.5" fill="white"/>
          </svg>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }

  /**
   * Criar conteúdo do popup
   */
  createPopupContent(stop, showDistance) {
    let content = `<div class="stop-popup">
      <strong>${stop.stop_name}</strong><br>
      Código: ${stop.stop_id}`;
    
    if (showDistance && stop.distance !== undefined) {
      content += `<br>Distância: ${Math.round(stop.distance)}m`;
    }
    
    content += `<br><a href="stop.html?id=${stop.stop_id}" style="color: #0072C6; font-weight: bold;">Ver horários →</a>
    </div>`;
    
    return content;
  }

  /**
   * Remover marcador de paragem
   */
  removeStopMarker(stopId) {
    if (this.markers[stopId]) {
      this.map.removeLayer(this.markers[stopId]);
      delete this.markers[stopId];
    }
  }

  /**
   * Obter todas as posições das paragens
   */
  getAllPositions() {
    return Object.values(this.markers).map(marker => marker.getLatLng());
  }

  /**
   * Abrir popup de uma paragem específica
   */
  openPopup(stopId) {
    if (this.markers[stopId]) {
      this.markers[stopId].openPopup();
    }
  }

  /**
   * Limpar todos os marcadores
   */
  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeStopMarker(id));
    console.log('🗑️ Todos os marcadores de paragens removidos');
  }

  /**
   * Obter número de marcadores ativos
   */
  getMarkerCount() {
    return Object.keys(this.markers).length;
  }
}
