// mapService.js - Responsável pela visualização e elementos do mapa
import { createBusIcon } from '../resources/busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from '../resources/busDesign/busColors.js';
import { initializeMapWithControls, createUserMarker } from './mapUtils.js';

class MapService {
  constructor() {
    this.map = null;
    this.busMarkers = {};
    this.userMarker = null;
    this.iconCache = {};
    this.userPosition = null;
  }

  // Inicializar o mapa com botão de centrar
  initializeMap() {
    const { map } = initializeMapWithControls(
      'map',
      [41.1579, -8.6291],
      13,
      () => this.userPosition
    );
    this.map = map;
  }

  // Configuração de cores das linhas
  getLineColors() {
    return BUS_COLORS;
  }

  // Obter ícone do autocarro
  getBusIcon(line) {
    if (this.iconCache[line]) return this.iconCache[line];
    this.iconCache[line] = createBusIcon(line, this.getLineColors(), CUSTOM_LINE_TEXTS);
    return this.iconCache[line];
  }

  // Atualizar marcadores dos autocarros no mapa
  updateBusMarkers(busData) {
    const validIDs = new Set();

    busData.forEach(bus => {
      validIDs.add(bus.id);

      const popupContent = `Linha: ${bus.line}<br>Velocidade: ${bus.speed} km/h<br>Destino: ${bus.destino}<br>Veículo nº ${bus.busNumber}`;

      if (this.busMarkers[bus.id]) {
        this.busMarkers[bus.id].setLatLng([bus.latitude, bus.longitude]);
        this.busMarkers[bus.id].setIcon(this.getBusIcon(bus.line));
        this.busMarkers[bus.id].bindPopup(popupContent);
      } else {
        const marker = L.marker([bus.latitude, bus.longitude], {
          icon: this.getBusIcon(bus.line)
        }).addTo(this.map);
        marker.bindPopup(popupContent);
        this.busMarkers[bus.id] = marker;
      }
    });

    Object.keys(this.busMarkers).forEach(id => {
      if (!validIDs.has(id)) {
        this.map.removeLayer(this.busMarkers[id]);
        delete this.busMarkers[id];
      }
    });
  }

  // Centrar mapa na localização do utilizador
  centerMapOnUser() {
    if (this.userPosition) {
      this.map.setView(this.userPosition, 16);
      if (!this.userMarker) {
        this.userMarker = createUserMarker(this.map, this.userPosition);
      } else {
        this.userMarker.setLatLng(this.userPosition);
      }
    } else {
      alert('Localização do utilizador não disponível.');
    }
  }

  // Definir posição do utilizador
  setUserPosition(lat, lon) {
    this.userPosition = [lat, lon];
  }
}

export const mapService = new MapService();
