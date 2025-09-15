const map = L.map('map').setView([41.1579, -8.6291], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

let busMarkers = {};
let userPosition = null;
let userMarker = null;
let refreshInterval = null;

const iconCache = {};

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

  const prefix = (line && line.length > 0) ? line[0] : '';

  if (iconCache[prefix]) return iconCache[prefix];

  let color = colorMap[prefix] || '#000000';

  const svg = `
  <svg width="17" height="8" xmlns="http://www.w3.org/2000/svg">
  <!-- Contorno exterior do autocarro que contorna as rodas -->
  <path d="M 1.2 1
        	H 15
            A 1 1 0 0 1 16 2
    V 6.5
    H 12.5
    A 0.7 0.7 0 0 1 10.5 6.5
    H 6
    A 0.7 0.7 0 0 1 4 6.5
    H 0.5
    V 1.7
    A 0.7 0.7 0 0 1 1.2 1"
    
        stroke="#18d8d0" stroke-width="0.7" fill="none"/>

    <!-- Contorno branco interior que contorna as rodas -->
  <path d="M 1.7 2
        	H 14.5
            A 0.5 0.5 0 0 1 15 2.5
    V 5.5
    H 1.5
    V 2.3
    A 0.2 0.3 0 0 1 1.7 2" 
       stroke="#fff" stroke-width="0.6"  fill="${color}"/>

    <!-- Detalhes no teto -->
    <rect x="3.5" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4"  fill="none"/>
      <rect x="10" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4"  fill="none"/>

  <!-- Rodas -->
  <circle cx="5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7"  fill="none"/>
    <circle cx="11.5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7"  fill="none"/>
</svg>`;

  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);

const icon = L.icon({
    iconUrl: url,
    iconSize: [40, 28],
    iconAnchor: [20, 14],
    popupAnchor: [0, -20]
  });

  iconCache[prefix] = icon;
  return icon;
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
    map.setView(userPosition, 14);
    if (!userMarker) {
      userMarker = L.marker(userPosition, {
        title: "Você está aqui",
        icon: defaultIcon()
      }).addTo(map).bindPopup("Localização Atual");
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
