/**
 * LineOverlayManager - Gere as polylines e paragens de linhas no mapa.
 *
 * Responsabilidades:
 *  - Desenhar/remover polylines coloridas de uma ou mais linhas
 *  - Colocar marcadores de paragem por cima das polylines
 *  - Fazer fitBounds ao conjunto de linhas visíveis
 *  - Cache de layers por routeId+direction para não re-desenhar
 */

export class LineOverlayManager {
  constructor(map) {
    this.map = map;

    // Layers activos: chave = `${routeId}:${direction}`
    // valor = { polyline: L.Polyline, stopMarkers: L.LayerGroup }
    this._layers = new Map();
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Desenha shape + paragens de uma linha. Se já estiver desenhada não faz nada.
   * @param {string} routeId
   * @param {0|1}    direction
   * @param {string} color        - hex, ex: '#187EC2'
   * @param {string} textColor    - hex, ex: '#FFFFFF'
   * @param {Array}  coordinates  - [{lat, lng}]
   * @param {Array}  stops        - [{stop_id, stop_name, latitude, longitude}]
   */
  addRoute(routeId, direction, color, textColor, coordinates, stops) {
    const key = `${routeId}:${direction}`;
    if (this._layers.has(key)) return; // já desenhada

    const polyline = this._drawPolyline(coordinates, color);
    const stopMarkers = this._drawStopMarkers(stops, color, textColor);

    this._layers.set(key, { polyline, stopMarkers });
  }

  /**
   * Remove a overlay de uma linha específica.
   */
  removeRoute(routeId, direction) {
    const key = `${routeId}:${direction}`;
    this._removeLayers(key);
  }

  /**
   * Remove todas as overlays activas.
   */
  clearAll() {
    for (const key of this._layers.keys()) {
      this._removeLayers(key);
    }
  }

  /**
   * Substitui as overlays activas pelo conjunto recebido.
   * Remove as que já não estão no novo conjunto e adiciona as novas.
   * @param {Array<{routeId, direction, color, text_color, shape, stops}>} routeDataList
   */
  setRoutes(routeDataList) {
    const newKeys = new Set(
      routeDataList.map(r => `${r.routeId}:${r.direction ?? 0}`)
    );

    // Remover layers que já não fazem parte do filtro
    for (const key of this._layers.keys()) {
      if (!newKeys.has(key)) this._removeLayers(key);
    }

    // Adicionar novas
    routeDataList.forEach(r => {
      const direction = r.direction ?? 0;
      const coords    = r.shape?.coordinates || [];
      const routeStops = r.stops?.stops || [];
      this.addRoute(r.routeId, direction, r.color, r.text_color, coords, routeStops);
    });
  }

  /**
   * Faz fitBounds a todas as overlays activas (com offset para o painel inferior).
   * @param {Object} options - { panelHeightRatio: 0.5 }
   */
  fitBounds(options = {}) {
    const { panelHeightRatio = 0 } = options;
    const allLatLngs = [];

    for (const { polyline } of this._layers.values()) {
      polyline.getLatLngs().forEach(ll => allLatLngs.push(ll));
    }

    if (allLatLngs.length === 0) return;

    const bounds = L.latLngBounds(allLatLngs);
    const mapHeight = this.map.getSize().y;
    const bottomPad = Math.round(mapHeight * panelHeightRatio);

    this.map.fitBounds(bounds, {
      paddingTopLeft:     [40, 40],
      paddingBottomRight: [40, bottomPad + 40],
      maxZoom: 16
    });
  }

  /**
   * Retorna true se há pelo menos uma overlay activa.
   */
  hasActiveLayers() {
    return this._layers.size > 0;
  }

  /**
   * Lista as keys activas ('routeId:direction').
   */
  getActiveKeys() {
    return Array.from(this._layers.keys());
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  _drawPolyline(coordinates, color) {
    const latLngs = coordinates.map(c => [c.lat, c.lng]);
    return L.polyline(latLngs, {
      color,
      weight:  5,
      opacity: 0.85,
      smoothFactor: 1
    }).addTo(this.map);
  }

  _drawStopMarkers(stops, lineColor, textColor) {
    const group = L.layerGroup().addTo(this.map);

    stops.forEach(stop => {
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius:      7,
        fillColor:   '#FFFFFF',
        color:       lineColor,
        weight:      3,
        opacity:     1,
        fillOpacity: 1
      });

      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:120px">
          <strong style="color:${lineColor}">${stop.stop_name}</strong><br>
          <small style="color:#666">${stop.stop_code || stop.stop_id}</small>
        </div>
      `, { maxWidth: 200, closeButton: false });

      group.addLayer(marker);
    });

    return group;
  }

  _removeLayers(key) {
    const entry = this._layers.get(key);
    if (!entry) return;
    if (entry.polyline)    this.map.removeLayer(entry.polyline);
    if (entry.stopMarkers) this.map.removeLayer(entry.stopMarkers);
    this._layers.delete(key);
  }
}
