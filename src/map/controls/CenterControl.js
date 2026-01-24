/**
 * CenterControl - Controlo customizado para centrar o mapa no utilizador
 * Usa o ícone GPS e posiciona-se no canto inferior direito
 */

export class CenterControl {
  constructor(map, getUserPosition) {
    this.map = map;
    this.getUserPosition = getUserPosition;
  }

  onAdd(map) {
    const container = L.DomUtil.create('div', 'leaflet-control-center');
    
    const button = L.DomUtil.create('button', '', container);
    button.type = 'button';
    button.title = 'Centrar no utilizador';
    button.innerHTML = '<img src="./resources/gps.png" alt="GPS" />';

    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      this.centerOnUser();
    });

    return container;
  }

  onRemove(map) {
    // Cleanup if needed
  }

  centerOnUser() {
    const position = this.getUserPosition();
    if (position && position.length === 2) {
      this.map.setView(position, 16);
    } else {
      console.warn('⚠ Localização do utilizador não disponível');
      alert('Localização do utilizador não disponível. Ative a localização no seu browser.');
    }
  }
}

/**
 * Factory function para compatibilidade com Leaflet
 */
export function createCenterControl(map, getUserPosition) {
  return new CenterControl(map, getUserPosition);
}
