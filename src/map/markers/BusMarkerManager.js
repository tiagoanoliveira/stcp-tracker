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
 */

import { iconCache }      from '../../ui/design/iconCache.js';
import { vehicleService } from '../../services/vehicleService.js';

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

  /**
   * Insere ou actualiza um marcador para o veículo dado.
   *
   * DEDUPLICAÇÃO: se já existir um marcador com bus.id (de qualquer origem),
   * o marcador é movido e o ícone/popup actualizado em vez de se criar um novo.
   * Nunca existem dois marcadores para o mesmo id no mapa.
   *
   * @param {object} bus - veículo normalizado (saída de vehicleService.processBusData)
   * @returns {L.Marker} o marcador criado ou actualizado
   */
  _upsertMarker(bus) {
    this._busData[bus.id] = bus;
    const icon = iconCache.getBusIcon(bus.line);

    if (this.markers[bus.id]) {
      // ── Marcador já existe: mover + actualizar ──────────────────────────
      const marker = this.markers[bus.id];
      marker.setLatLng([bus.latitude, bus.longitude]);
      marker.setIcon(icon);
      if (bus.destination !== null && bus.destination !== undefined) {
        marker.setPopupContent(this._createPopupContent(bus));
      }
      return marker;
    }

    // ── Marcador novo ────────────────────────────────────────────────────
    return this._createBusMarker(bus);
  }

  // ─── API pública ───────────────────────────────────────────────────────────

  /**
   * Actualiza o conjunto completo de marcadores para a lista de veículos dada.
   * Usa _upsertMarker() para garantir que não há duplicados.
   * Veículos ausentes da lista são removidos.
   */
  updateBusMarkers(busData) {
    const validIDs = new Set();
    busData.forEach(bus => {
      validIDs.add(bus.id);
      this._upsertMarker(bus);
    });

    // Remover marcadores de veículos que já não estão na lista
    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) this.removeBusMarker(id);
    });
  }

  /**
   * Actualiza um único marcador sem afectar os restantes.
   * Usado pelo callback onVehicleUpdate do MQTT.
   * Garante deduplicação via _upsertMarker().
   */
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
    marker.bindPopup(popupContent, { maxWidth: 220 });
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

  _createLoadingPopup(bus) {
    return `
      <div class="bus-popup">
        <strong>Linha ${bus.displayLine ?? bus.line}</strong><br>
        Destino: <em style="color:#999">A carregar...</em><br>
        Velocidade: ${bus.speed != null ? bus.speed + ' km/h' : 'N/A'}<br>
        Veículo nº ${bus.busNumber}
      </div>`;
  }

  _createPopupContent(bus) {
    return `
      <div class="bus-popup">
        <strong>Linha ${bus.displayLine ?? bus.line}</strong><br>
        Destino: ${bus.destination || 'Desconhecido'}<br>
        Velocidade: ${bus.speed != null ? bus.speed + ' km/h' : 'N/A'}<br>
        Veículo nº ${bus.busNumber}
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
