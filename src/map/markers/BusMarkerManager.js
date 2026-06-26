/**
 * BusMarkerManager - Gestão de marcadores de autocarros
 *
 * Popup lazy: o destino (headsign) é resolvido apenas no primeiro clique,
 * a menos que bus.destination já esteja preenchido (ex: vindo do tópico MQTT).
 *
 * Deduplicação: updateBusMarkers() move o marcador existente se o id já existir
 * em vez de criar um novo, garantindo que não aparecem duplicados.
 * Marcadores cujos ids não constem na lista passada são removidos.
 */

import { iconCache }      from '../../ui/design/iconCache.js';
import { vehicleService } from '../../services/vehicleService.js';

export class BusMarkerManager {
  constructor(map) {
    this.map = map;
    this.markers       = {};   // busId -> L.Marker
    this._busData      = {};   // busId -> objecto processado
    this._markerRoutes = {};   // busId -> displayLine string (nome real da linha)
    this._markerDirs   = {};   // busId -> direction number (0|1)
  }

  setRouteForMarker(busId, routeNumber, direction) {
    this._markerRoutes[busId] = String(routeNumber || '');
    this._markerDirs[busId]   = direction != null ? Number(direction) : null;
  }

  /**
   * Filtra marcadores por linha e, opcionalmente, por direção.
   * A comparação é feita contra o displayLine do autocarro (nome real da linha,
   * resolvendo aliases como '107' -> 'ZC'), não contra o ID interno da API.
   * @param {Set<string>}         selectedRoutes  - números de linha seleccionados
   * @param {Map<string,number>}  [routeDirMap]   - mapa linha -> direção (0|1)
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

  /**
   * Actualiza (ou cria) os marcadores para a lista de veículos fornecida.
   * Se um veículo com o mesmo id já tiver marcador, move-o e actualiza os dados
   * em vez de criar um duplicado. Veículos ausentes da lista são removidos.
   */
  updateBusMarkers(busData) {
    const validIDs = new Set();
    busData.forEach(bus => {
      validIDs.add(bus.id);
      this._busData[bus.id] = bus;
      const icon = iconCache.getBusIcon(bus.line);

      if (this.markers[bus.id]) {
        // Marcador já existe — mover e actualizar ícone
        this.markers[bus.id].setLatLng([bus.latitude, bus.longitude]);
        this.markers[bus.id].setIcon(icon);
        // Actualizar popup se o destino já estiver resolvido
        if (bus.destination !== null) {
          this.markers[bus.id].setPopupContent(this._createPopupContent(bus));
        }
      } else {
        // Marcador novo
        this._createBusMarker(bus);
      }
    });

    // Remover marcadores de veículos que já não estão na lista
    Object.keys(this.markers).forEach(id => {
      if (!validIDs.has(id)) this.removeBusMarker(id);
    });
  }

  /**
   * Actualiza um único marcador de veículo sem afectar os restantes.
   * Útil para actualizações individuais vindas do MQTT (onVehicleUpdate).
   * Cria o marcador se ainda não existir.
   */
  updateSingleBusMarker(bus) {
    this._busData[bus.id] = bus;
    const icon = iconCache.getBusIcon(bus.line);

    if (this.markers[bus.id]) {
      this.markers[bus.id].setLatLng([bus.latitude, bus.longitude]);
      this.markers[bus.id].setIcon(icon);
      if (bus.destination !== null) {
        this.markers[bus.id].setPopupContent(this._createPopupContent(bus));
      }
    } else {
      this._createBusMarker(bus);
    }
  }

  _createBusMarker(bus) {
    const icon   = iconCache.getBusIcon(bus.line);
    // Se o destino já veio do tópico MQTT, mostrar directamente; senão lazy-load
    const popupContent = bus.destination !== null
      ? this._createPopupContent(bus)
      : this._createLoadingPopup(bus);
    const marker = L.marker([bus.latitude, bus.longitude], { icon }).addTo(this.map);
    marker.bindPopup(popupContent, { maxWidth: 220 });
    // Resolver o headsign só se necessário (destination === null)
    marker.on('popupopen', () => this._resolvePopupHeadsign(bus.id, marker));
    this.markers[bus.id] = marker;
    return marker;
  }

  async _resolvePopupHeadsign(busId, marker) {
    const bus = this._busData[busId];
    if (!bus) return;
    // Se o destino já veio do tópico MQTT, não há nada a resolver
    if (bus.destination !== null) {
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
        Velocidade: ${bus.speed} km/h<br>
        Veículo nº ${bus.busNumber}
      </div>`;
  }

  _createPopupContent(bus) {
    return `
      <div class="bus-popup">
        <strong>Linha ${bus.displayLine ?? bus.line}</strong><br>
        Destino: ${bus.destination || 'Desconhecido'}<br>
        Velocidade: ${bus.speed} km/h<br>
        Veículo nº ${bus.busNumber}
      </div>`;
  }

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
