// mapInitializer.js - Wrapper em torno do Leaflet para inicializar mapas

import { createUserMarker } from '../../../realtime_bus_map/mapUtils.js';

export class MapInitializer {
  constructor(elementId, center=[41.1579,-8.6291], zoom=13) {
    this.elementId = elementId;
    this.center = center;
    this.zoom = zoom;
    this.map = null;
  }

  initialize(getUserPosition = null) {
    // Criar mapa com zoomControl desativado para reposicionar
    const map = L.map(this.elementId, {
      center: this.center,
      zoom: this.zoom,
      zoomControl: false // Desativar controlo padrão
    });

    // Adicionar controlo de zoom no canto inferior direito
    L.control.zoom({
      position: 'bottomright'
    }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Não adicionar controlos aqui - serão adicionados pelas apps específicas
    // (BusMapApp, StopsMapApp, etc) conforme necessário

    this.map = map;
    return map;
  }

  createUserMarker(position) {
    if (!this.map) return null;
    return createUserMarker(this.map, position);
  }
}
