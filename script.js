const map = L.map('map').setView([41.1579, -8.6291], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

let busMarkers = {};
let userPosition = null;
let userMarker = null;
let refreshInterval = null;

// Ícones personalizados com cor conforme linha
function getBusIcon(line) {
  const colorMap = {
    '2': '#187ec2',  // azul
    '3': '#187ec2',
    '4': '#187ec2',
    '5': '#fcd116',  // amarelo (gold)
    '6': '#00ac00',  // verde
    '7': '#FF0000',  // vermelho
    '8': '#a347ff',  // roxo
    '9': '#FF7900'   // laranja
  };

  let color = (line && line.length > 0) ? (colorMap[line[0]] || '#0000FF') : '#0000FF';

  const svg = `
    <svg width="10" height="7" xmlns="http://www.w3.org/2000/svg">
    <!-- Fundo de cor da linha -->
  <rect width="10" height="7" fill="${color}"/>
  <!-- Contorno exterior do autocarro que contorna as rodas -->
  <path d="M 2.3 2
        	L 7 2
            A 1 1 0 0 1 8 3
    L 8 5
    L 7 5
    M 6 5
    L 4 5
    M 3 5
    L 1.7 5
    L 1.7 3
    A 0.6 1 0 0 1 2.3 2"
    
        stroke="#18d8d0" stroke-width="0.3" fill="none"/>

    <!-- Contorno branco interior que contorna as rodas -->
  <path d="M 2.3 2.5
        	L 7 2.5
            A 0.5 0.5 0 0 1 7.5 3
    L 7.5 4.5
    L 2.2 4.5
    L 2.2 3
    A 0.1 0.5 0 0 1 2.3 2.5" 
       stroke="#fff" stroke-width="0.2"  fill="none"/>

    <!-- Detalhes no teto -->
    <rect x="3" y="1.7" width="1.2" height="0.3" rx="0.1" stroke="#18d8d0" stroke-width="0.2"  fill="none"/>
      <rect x="5.5" y="1.7" width="1.2" height="0.3" rx="0.1" stroke="#18d8d0" stroke-width="0.2"  fill="none"/>

  
  <!-- Rodas -->
  <circle cx="6.5" cy="5" r="0.5" stroke="#18d8d0" stroke-width="0.3"  fill="none"/>
    <circle cx="3.5" cy="5" r="0.5" stroke="#18d8d0" stroke-width="0.3"  fill="none"/>

</svg>`;

  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);

  return L.icon({
    iconUrl: url,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
}

function defaultIcon(){
  return L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
  });
}

function centerMapOnUser() {
  if (userPosition) {
    map.setView(userPosition, 16);
    if (!userMarker) {
      userMarker = L.marker(userPosition, {
        title: "Você está aqui",
        icon: defaultIcon()
      }).addTo(map).bindPopup("Localização Atual").openPopup();
    } else {
      userMarker.setLatLng(userPosition);
    }
  } else {
    alert('Localização do utilizador não disponível.');
  }
}

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(position => {
    userPosition = [position.coords.latitude, position.coords.longitude];
    centerMapOnUser();
  }, err => {
    console.warn('Não foi possível obter a localização, mapa permanece centrado no Porto.');
  }, {
    enableHighAccuracy: true,
    maximumAge: 30000,
    timeout: 27000
  });
}

function extractLineNumber(bus) {
  if (!bus.annotations || !bus.annotations.value) return null;
  for (const annotation of bus.annotations.value) {
    const decoded = decodeURIComponent(annotation);
    if (decoded.startsWith("stcp:route:")) {
      return decoded.slice("stcp:route:".length);
    }
  }
  return null;
}

async function fetchBusData() {
  const filterValue = document.getElementById('line-filter').value.trim();

  try {
    const response = await fetch('https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000');
    const data = await response.json();

    if (!Array.isArray(data)) {
      console.error('Dados inválidos:', data);
      return;
    }

    const validIDs = new Set();

    data.forEach(bus => {
      const line = extractLineNumber(bus);

      if (filterValue === '' || (line && line.startsWith(filterValue))) {
        validIDs.add(bus.id);

        const lat = bus.location?.value?.coordinates?.[1];
        const lon = bus.location?.value?.coordinates?.[0];
        if (lat == undefined || lon == undefined) return;

        const speed = bus.speed ? bus.speed.value : 'N/A';

        if (busMarkers[bus.id]) {
          busMarkers[bus.id].setLatLng([lat, lon]);
          busMarkers[bus.id].setIcon(getBusIcon(line));
          busMarkers[bus.id].bindPopup(`ID: ${bus.id}<br>Linha: ${line}<br>Velocidade: ${speed} km/h`);
        } else {
          const marker = L.marker([lat, lon], {icon: getBusIcon(line)}).addTo(map);
          marker.bindPopup(`ID: ${bus.id}<br>Linha: ${line}<br>Velocidade: ${speed} km/h`);
          busMarkers[bus.id] = marker;
        }
      }
    });

    // Remover marcadores que já não estão
    Object.keys(busMarkers).forEach(id => {
      if (!validIDs.has(id)) {
        map.removeLayer(busMarkers[id]);
        delete busMarkers[id];
      }
    });

  } catch (error) {
    console.error('Erro ao obter dados dos autocarros:', error);
  }
}

function applyFilter() {
  forceRefresh();
}

function forceRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  fetchBusData().then(() => {
    refreshInterval = setInterval(fetchBusData, 10000);
  });
}

document.getElementById('apply-filter').addEventListener('click', applyFilter);
document.getElementById('center-user').addEventListener('click', centerMapOnUser);
document.getElementById('refresh-now').addEventListener('click', forceRefresh);

forceRefresh();
