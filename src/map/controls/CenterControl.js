/**
 * CenterControl - Controlo customizado para centrar o mapa no utilizador
 * Posiciona-se no canto inferior direito, acima dos controlos de zoom.
 *
 * Ao clicar, força um novo pedido de geolocalização ao browser em vez de
 * apenas usar a última posição em cache. Isto garante que, mesmo que o
 * utilizador se tenha deslocado desde que abriu a página, o mapa centra
 * na posição atual e não na original.
 *
 * O callback `onFreshPosition(position)` é chamado com a nova posição
 * [lat, lng] após cada pedido bem-sucedido, permitindo ao chamador
 * atualizar o marcador do utilizador no mapa.
 */

import { geolocationService } from '../../core/geolocationService.js';

export function createCenterControl(map, getUserPosition, onFreshPosition) {
  const CenterControl = L.Control.extend({
    options: {
      position: 'bottomright'
    },

    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-control-center');

      const button = L.DomUtil.create('button', '', container);
      button.type  = 'button';
      button.title = 'Centrar no utilizador';
      button.innerHTML = '<img src="./resources/icons/gps.png" alt="GPS" />';

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        refreshAndCenter(button);
      });

      return container;
    },

    onRemove: function() {}
  });

  /**
   * Faz um novo pedido de geolocalização (não usa cache).
   * Ao obter a posição, atualiza o marcador, centra o mapa e
   * notifica o chamador via onFreshPosition.
   */
  function refreshAndCenter(button) {
    // Feedback visual imediato
    button.disabled = true;
    button.style.opacity = '0.5';

    geolocationService.getFreshPosition()
      .then(position => {
        map.setView(position, 16);
        if (typeof onFreshPosition === 'function') {
          onFreshPosition(position);
        }
      })
      .catch(err => {
        console.warn('⚠ Não foi possível obter a localização atual:', err.message);
        // Se não houver posição nova, tenta usar a última em cache
        const cached = getUserPosition();
        if (cached && cached.length === 2) {
          map.setView(cached, 16);
        } else {
          alert('Localização do utilizador não disponível. Ative a localização no seu browser.');
        }
      })
      .finally(() => {
        button.disabled = false;
        button.style.opacity = '';
      });
  }

  return new CenterControl();
}
