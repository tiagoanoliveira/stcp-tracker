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
    '2': '#0000FF',  // azul
    '3': '#0000FF',
    '4': '#0000FF',
    '5': '#FFD700',  // amarelo (gold)
    '6': '#008000',  // verde
    '7': '#FF0000',  // vermelho
    '8': '#800080',  // roxo
    '9': '#FFA500'   // laranja
  };

  let color = (line && line.length > 0) ? (colorMap[line[0]] || '#0000FF') : '#0000FF';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 64 64">
      <rect x="8" y="16" width="48" height="32" fill="${color}" stroke="black" stroke-width="2" />
      <circle cx="20" cy="52" r="6" fill="black"/>
      <circle cx="44" cy="52" r="6" fill="black"/>
      <rect x="20" y="24" width="24" height="16" fill="white" />
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
