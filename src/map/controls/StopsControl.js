/**
 * StopsControl - Controlo personalizado para navegar para o mapa de paragens
 */

export function createStopsControl(map, stopsMapUrl = 'stopsmap.html') {
  const StopsControl = L.Control.extend({
    options: {
      position: 'bottomleft'
    },

    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-control-stops leaflet-bar leaflet-control');
      
      const button = L.DomUtil.create('button', '', container);
      button.type = 'button';
      button.title = 'Ver mapa de paragens';
      button.innerHTML = `
        <img src="./resources/paragem.png" alt="Ver paragens" />
      `;

      // Prevenir propagação de eventos do mapa
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);

      // Handler do clique
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        window.location.href = stopsMapUrl;
      });

      return container;
    },

    onRemove: function(map) {
      // Cleanup se necessário
    }
  });

  return new StopsControl();
}
