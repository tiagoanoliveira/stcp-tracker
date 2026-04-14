/**
 * StopMarkerManager - Gestão especializada de marcadores de paragens
 */

export class StopMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers = {};
    this.clickCallback = null;
    this._selectedStopId = null;
  }

  /**
   * Atualizar todos os marcadores de paragens
   */
  updateStopMarkers(stops, showDistance = false, onClickCallback = null) {
    if (onClickCallback) {
      this.clickCallback = onClickCallback;
    }
    this.clearAllMarkers();
    stops.forEach(stop => this.addStopMarker(stop, showDistance));
  }

  /**
   * Adicionar marcador de paragem
   */
  addStopMarker(stop, showDistance = false) {
    const isSelected = stop.stop_id === this._selectedStopId;
    const icon = this.createStopIcon(isSelected);
    const popupContent = this.createPopupContent(stop, showDistance);

    const marker = L.marker([stop.latitude, stop.longitude], {
      icon,
      title: stop.stop_name
    }).addTo(this.map);

    marker.bindPopup(popupContent);

    marker.on('click', () => {
      if (this.clickCallback) {
        this.clickCallback(stop);
      } else {
        this.map.setView([stop.latitude, stop.longitude], 16);
      }
    });

    this.markers[stop.stop_id] = marker;
    return marker;
  }

  /**
   * Highlight a stop marker as selected (filled accent circle).
   * Calling with null clears the selection.
   */
  setSelectedStop(stopId) {
    const prev = this._selectedStopId;
    this._selectedStopId = stopId || null;

    // Re-render previous marker back to normal
    if (prev && prev !== stopId && this.markers[prev]) {
      this.markers[prev].setIcon(this.createStopIcon(false));
    }
    // Re-render new selected marker
    if (stopId && this.markers[stopId]) {
      this.markers[stopId].setIcon(this.createStopIcon(true));
    }
  }

  /**
   * Criar ícone de paragem
   * @param {boolean} selected - se true, usa cor de destaque no círculo
   */
  createStopIcon(selected = false) {
    const fillColor  = selected ? '#F97316' : '#5EDDC1'; // laranja se seleccionado, verde-água se normal
    const strokeColor = '#0072C6';
    return L.divIcon({
      className: 'custom-stop-marker',
      html: `
        <div style="position:relative;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="3" x2="12" y2="21" />
            <rect x="4" y="3" width="16" height="11" rx="1" fill="${fillColor}" stroke="${strokeColor}"/>
            <rect x="7" y="6" width="10" height="4" rx="0.5" fill="${strokeColor}"/>
            <circle cx="9" cy="11.2" r="0.5" fill="white"/>
            <circle cx="15" cy="11.2" r="0.5" fill="white"/>
          </svg>
        </div>`,
      iconSize:    [32, 32],
      iconAnchor:  [16, 32],
      popupAnchor: [0, -32]
    });
  }

  /**
   * Criar conteúdo do popup
   */
  createPopupContent(stop, showDistance) {
    let content = `<div class="stop-popup">
      <strong>${stop.stop_name}</strong><br>
      C\u00f3digo: ${stop.stop_id}`;
    if (showDistance && stop.distance !== undefined) {
      content += `<br>Dist\u00e2ncia: ${Math.round(stop.distance)}m`;
    }
    if (!this.clickCallback) {
      content += `<br><a href="stop.html?id=${stop.stop_id}" style="color:#0072C6;font-weight:bold;">Ver hor\u00e1rios \u2192</a>`;
    }
    content += `</div>`;
    return content;
  }

  hideAllMarkers() {
    Object.values(this.markers).forEach(m => m.remove());
  }

  showAllMarkers() {
    Object.values(this.markers).forEach(m => m.addTo(this.map));
  }

  /**
   * Mostrar apenas um marcador específico (esconder todos os outros)
   */
  showOnlyMarker(stopId) {
    Object.entries(this.markers).forEach(([id, marker]) => {
      if (id === stopId) {
        if (!this.map.hasLayer(marker)) marker.addTo(this.map);
      } else {
        marker.remove();
      }
    });
  }

  removeStopMarker(stopId) {
    if (this.markers[stopId]) {
      this.map.removeLayer(this.markers[stopId]);
      delete this.markers[stopId];
    }
  }

  getAllPositions() {
    return Object.values(this.markers).map(m => m.getLatLng());
  }

  openPopup(stopId) {
    if (this.markers[stopId]) this.markers[stopId].openPopup();
  }

  clearAllMarkers() {
    Object.keys(this.markers).forEach(id => this.removeStopMarker(id));
  }

  getMarkerCount() {
    return Object.keys(this.markers).length;
  }
}
