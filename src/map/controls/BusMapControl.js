/**
 * BusMapControl - Controlo personalizado para navegar de volta ao mapa de autocarros
 */

export function createBusMapControl(map, busMapUrl = 'index.html') {
  const BusMapControl = L.Control.extend({
    options: {
      position: 'bottomleft'
    },

    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-control-stops leaflet-bar leaflet-control');
      
      const button = L.DomUtil.create('button', '', container);
      button.type = 'button';
      button.title = 'Ver mapa de autocarros';
      button.innerHTML = `
        <img src="./resources/busmap.png" alt="Ver localização dos autocarros" />
      `;

      // Prevenir propagação de eventos do mapa
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);

      // Handler do clique
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        window.location.href = busMapUrl;
      });

      return container;
    },

    onRemove: function(map) {
      // Cleanup se necessário
    }
  });

  return new BusMapControl();
}
