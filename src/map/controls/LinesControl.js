/**
 * LinesControl - Botão para navegar para a página de Linhas do Porto.
 * Posiciona-se entre o controlo de paragens/autocarros e o tutorial.
 */

export function createLinesControl(map, linesUrl = 'lines') {
  const LinesControl = L.Control.extend({
    options: { position: 'bottomleft' },

    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control-lines');
      const btn = L.DomUtil.create('button', 'lines-map-btn', container);
      btn.type  = 'button';
      btn.title = 'Ver Linhas do Porto';
      btn.setAttribute('aria-label', 'Ver Linhas do Porto');

      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"
             stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"
             width="26" height="26" aria-hidden="true">
          <!-- paragem superior esquerda -->
          <circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>
          <!-- paragem central direita -->
          <circle cx="38" cy="18" r="5" fill="currentColor" stroke="none"/>
          <!-- paragem inferior esquerda -->
          <circle cx="20" cy="25" r="5" fill="currentColor" stroke="none"/>
          <circle cx="38" cy="38" r="5" fill="currentColor" stroke="none"/>
          <!-- traço: cima esquerda → direita curva → baixo esquerda -->
          <path d="M10 10 C30 10 38 10 38 18 C38 26 10 22 10 30 C0 38 38 38 38 38" fill="none"/>
        </svg>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        window.location.href = linesUrl;
      });

      return container;
    }
  });

  return new LinesControl();
}
