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
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="6" width="18" height="12" rx="2"/>
          <path d="M7 10h.01M12 10h.01M17 10h.01"/>
        </svg>
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
