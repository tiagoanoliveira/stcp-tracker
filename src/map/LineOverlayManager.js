/**
 * LineOverlayManager - Gere as polylines e paragens de linhas no mapa.
 *
 * Responsabilidades:
 *  - Desenhar/remover polylines coloridas de uma ou mais linhas
 *  - Colocar marcadores de paragem por cima das polylines
 *  - Fazer fitBounds ao conjunto de linhas visíveis
 *  - Cache de layers por routeId+direction para não re-desenhar
 *
 * Callback:
 *  onStopClick(cb)  — cb(stop) chamado quando o utilizador clica em
 *                     "Próximos autocarros" no popup de uma paragem
 */

export class LineOverlayManager {
  constructor(map) {
    this.map = map;
    this._layers = new Map(); // chave = `${routeId}:${direction}`
    this._onStopClick = null;
  }

  /** Regista callback chamado quando o utilizador pede próximas chegadas de uma paragem */
  onStopClick(callback) {
    this._onStopClick = callback;
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  addRoute(routeId, direction, color, textColor, coordinates, stops) {
    const key = `${routeId}:${direction}`;
    if (this._layers.has(key)) return;
    const polyline    = this._drawPolyline(coordinates, color);
    const stopMarkers = this._drawStopMarkers(stops, color, textColor);
    this._layers.set(key, { polyline, stopMarkers });
  }

  removeRoute(routeId, direction) {
    this._removeLayers(`${routeId}:${direction}`);
  }

  clearAll() {
    for (const key of this._layers.keys()) this._removeLayers(key);
  }

  setRoutes(routeDataList) {
    const newKeys = new Set(routeDataList.map(r => `${r.routeId}:${r.direction ?? 0}`));
    for (const key of this._layers.keys()) {
      if (!newKeys.has(key)) this._removeLayers(key);
    }
    routeDataList.forEach(r => {
      const direction  = r.direction ?? 0;
      const coords     = r.shape?.coordinates || [];
      const routeStops = r.stops?.stops || [];
      this.addRoute(r.routeId, direction, r.color, r.text_color, coords, routeStops);
    });
  }

  fitBounds(options = {}) {
    const { panelHeightRatio = 0 } = options;
    const allLatLngs = [];
    for (const { polyline } of this._layers.values()) {
      polyline.getLatLngs().forEach(ll => allLatLngs.push(ll));
    }
    if (allLatLngs.length === 0) return;
    const bounds    = L.latLngBounds(allLatLngs);
    const mapHeight = this.map.getSize().y;
    const bottomPad = Math.round(mapHeight * panelHeightRatio);
    this.map.fitBounds(bounds, {
      paddingTopLeft:     [40, 40],
      paddingBottomRight: [40, bottomPad + 40],
      maxZoom: 17
    });
  }

  hasActiveLayers() { return this._layers.size > 0; }
  getActiveKeys()   { return Array.from(this._layers.keys()); }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  _drawPolyline(coordinates, color) {
    const latLngs = coordinates.map(c => [c.lat, c.lng]);
    return L.polyline(latLngs, { color, weight: 5, opacity: 0.85, smoothFactor: 1 }).addTo(this.map);
  }

  _drawStopMarkers(stops, lineColor, textColor) {
    const group = L.layerGroup().addTo(this.map);
    stops.forEach(stop => {
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: 7, fillColor: '#FFFFFF', color: lineColor,
        weight: 3, opacity: 1, fillOpacity: 1
      });
      marker.bindPopup(
        this._buildStopPopup(stop, lineColor),
        { maxWidth: 220, closeButton: false }
      );
      // Delega clique no botão após o popup abrir (event delegation)
      marker.on('popupopen', () => {
        const btn = marker.getPopup()?.getElement()?.querySelector('.stop-popup-arrivals-btn');
        if (btn) {
          btn.onclick = () => {
            this.map.closePopup();
            if (this._onStopClick) this._onStopClick(stop);
          };
        }
      });
      group.addLayer(marker);
    });
    return group;
  }

  _buildStopPopup(stop, lineColor) {
    return `
      <div class="popup-line-stop" style="font-family:inherit;min-width:150px;padding:2px 0">
        <strong style="color:${lineColor};font-size:13px">${stop.stop_name}</strong><br>
        <small style="color:#777">${stop.stop_code || stop.stop_id}</small><br>
        <button class="stop-popup-arrivals-btn" style="
          margin-top:8px;
          width:100%;
          padding:6px;
          background:${lineColor};
          color:#fff;
          border:none;
          border-radius:12px;
          font-size:12px;
          font-weight:600;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:4px;
        ">
          Próximos autocarros
        </button>
      </div>`;
  }

  _removeLayers(key) {
    const entry = this._layers.get(key);
    if (!entry) return;
    if (entry.polyline)    this.map.removeLayer(entry.polyline);
    if (entry.stopMarkers) this.map.removeLayer(entry.stopMarkers);
    this._layers.delete(key);
  }
}
