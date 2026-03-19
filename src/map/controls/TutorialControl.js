/**
 * TutorialControl - Botão '?' no canto inferior esquerdo do mapa.
 * Posiciona-se acima do controlo BusMapControl / StopsControl.
 */

export function createTutorialControl(map, onOpen) {
  const TutorialControl = L.Control.extend({
    options: { position: 'bottomleft' },

    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control-tutorial');
      const btn = L.DomUtil.create('button', 'tutorial-map-btn', container);
      btn.type  = 'button';
      btn.title = 'Ajuda / Tutorial';
      btn.setAttribute('aria-label', 'Abrir tutorial');
      btn.innerHTML = '?';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (onOpen) onOpen();
      });
      return container;
    }
  });

  return new TutorialControl();
}
