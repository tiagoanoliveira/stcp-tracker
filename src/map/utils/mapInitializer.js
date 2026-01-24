// mapInitializer.js - Wrapper em torno do Leaflet para inicializar mapas com controlos padrão

import { createCenterControl, createReloadControl, createUserMarker } from '../../../realtime_bus_map/mapUtils.js';

export class MapInitializer {
  constructor(elementId, center=[41.1579,-8.6291], zoom=13) {
    this.elementId = elementId;
    this.center = center;
    this.zoom = zoom;
    this.map = null;
  }

  initialize(getUserPosition = null) {
    const map = L.map(this.elementId).setView(this.center, this.zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    if (getUserPosition) {
      const centerCtrl = createCenterControl(map, getUserPosition);
      centerCtrl.addTo(map);
    }

    const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
    if (page === 'index.html' || page === 'busmap.html' || page === 'busmap_refactored.html' || page === '') {
      const reloadCtrl = createReloadControl();
      reloadCtrl.addTo(map);
    }

    this.map = map;
    return map;
  }

  createUserMarker(position) {
    if (!this.map) return null;
    return createUserMarker(this.map, position);
  }
}
