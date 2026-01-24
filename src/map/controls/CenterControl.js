/**
 * CenterControl - Controlo customizado para centrar o mapa no utilizador
 * Usa o ícone GPS e posiciona-se no canto inferior direito
 */

export function createCenterControl(map, getUserPosition) {
  const CenterControl = L.Control.extend({
    options: {
      position: 'bottomright'
    },

    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-control-center leaflet-bar');
      
      const button = L.DomUtil.create('button', '', container);
      button.type = 'button';
      button.title = 'Centrar no utilizador';
      button.innerHTML = '<img src="./resources/gps.png" alt="GPS" />';

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        centerOnUser();
      });

      return container;
    },

    onRemove: function(map) {
      // Cleanup if needed
    }
  });

  function centerOnUser() {
    const position = getUserPosition();
    if (position && position.length === 2) {
      map.setView(position, 16);
    } else {
      console.warn('⚠ Localização do utilizador não disponível');
      alert('Localização do utilizador não disponível. Ative a localização no seu browser.');
    }
  }

  return new CenterControl();
}
