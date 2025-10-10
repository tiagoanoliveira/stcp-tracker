// mapUtils.js - Utilitários centralizados para inicialização e controles de mapas
export function createCenterControl(map, getUserPosition) {
  const CenterControl = L.Control.extend({
    options: {
      position: 'topleft'
    },
    
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const button = L.DomUtil.create('a', 'leaflet-control-center', container);
      
      button.innerHTML = '📍';
      button.href = '#';
      button.title = 'Centrar no utilizador';
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', 'Centrar mapa na localização do utilizador');
      
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        
        const userPos = getUserPosition();
        console.log('Botão clicado, posição:', userPos); // Debug
        if (userPos) {
          map.setView(userPos, 16);
        } else {
          alert('Localização do utilizador não disponível.');
        }
      });
      
      return container;
    }
  });
  
  return new CenterControl();
}

export function initializeMapWithControls(elementId, center = [41.1579, -8.6291], zoom = 13, getUserPosition = null) {
  const map = L.map(elementId).setView(center, zoom);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  
  let centerControl = null;
  if (getUserPosition) {
    centerControl = createCenterControl(map, getUserPosition);
    centerControl.addTo(map);
  }
  
  return { map, centerControl };
}

export function createUserMarker(map, position) {
  const userIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
  });
  
  const marker = L.marker(position, {
    icon: userIcon,
    title: "Você está aqui"
  }).addTo(map);
  
  marker.bindPopup("Localização Atual");
  return marker;
}
