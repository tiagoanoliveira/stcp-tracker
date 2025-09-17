// mapService.js - Responsável pela visualização e elementos do mapa
import { createBusIcon } from './busDesign/busIcon.js';
import { BUS_COLORS, CUSTOM_LINE_TEXTS } from './busDesign/busColors.js';

class MapService {
  constructor() {
    this.map = null;
    this.busMarkers = {};
    this.userMarker = null;
    this.iconCache = {};
    this.userPosition = null;
  }

  // Inicializar o mapa
  initializeMap() {
    this.map = L.map('map').setView([41.1579, -8.6291], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);
  }

  // Configuração de cores das linhas (agora importada)
  getLineColors() {
    return BUS_COLORS;
  }

  // Obter ícone do autocarro
  getBusIcon(line) {
    if (this.iconCache[line]) return this.iconCache[line];
    this.iconCache[line] = createBusIcon(line, this.getLineColors(), CUSTOM_LINE_TEXTS);
    return this.iconCache[line];
  }

  // Ícone padrão para localização do utilizador
  defaultIcon() {
    return L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34]
    });
  }

  // Atualizar marcadores dos autocarros no mapa
  updateBusMarkers(busData) {
    const validIDs = new Set();

    busData.forEach(bus => {
      validIDs.add(bus.id);

      const popupContent = `Linha: ${bus.line}<br>Velocidade: ${bus.speed} km/h<br>Destino: ${bus.destino}<br>Veículo nº ${bus.busNumber}`;

      if (this.busMarkers[bus.id]) {
        // Atualizar marcador existente
        this.busMarkers[bus.id].setLatLng([bus.latitude, bus.longitude]);
        this.busMarkers[bus.id].setIcon(this.getBusIcon(bus.line));
        this.busMarkers[bus.id].bindPopup(popupContent);
      } else {
        // Criar novo marcador
        const marker = L.marker([bus.latitude, bus.longitude], {
          icon: this.getBusIcon(bus.line)
        }).addTo(this.map);
        marker.bindPopup(popupContent);
        this.busMarkers[bus.id] = marker;
      }
    });

    // Remover marcadores que já não existem
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
        this.userMarker = L.marker(this.userPosition, {
          title: "Você está aqui",
          icon: this.defaultIcon()
        }).addTo(this.map).bindPopup("Localização Atual");
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

// Exportar instância singleton
export const mapService = new MapService();
