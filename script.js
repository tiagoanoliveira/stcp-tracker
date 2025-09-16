const map = L.map('map').setView([41.1579, -8.6291], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

let busMarkers = {};
let userPosition = null;
let userMarker = null;
let refreshInterval = null;

const iconCache = {};
let destinos = {};

// Carregar destinos do ficheiro JSON
async function carregarDestinos() {
  try {
    const response = await fetch('destinos.json');
    destinos = await response.json();
    console.log('Destinos carregados:', destinos);
  } catch (error) {
    console.error('Erro ao carregar destinos:', error);
  }
}

function getBusIcon(line) {
  const lineColors = {
    '106': { busColor: '#FF7900', textColor: '#fff' },
    '107': { busColor: '#187ec2', textColor: '#fff' },
    '1M': { busColor: '#000000', textColor: '#fff' },
    '2M': { busColor: '#000000', textColor: '#fff' },
    '3M': { busColor: '#000000', textColor: '#fff' },
    '4M': { busColor: '#000000', textColor: '#fff' },
    '5M': { busColor: '#000000', textColor: '#fff' },
    '6M': { busColor: '#000000', textColor: '#fff' },
    '7M': { busColor: '#000000', textColor: '#fff' },
    '8M': { busColor: '#000000', textColor: '#fff' },
    '9M': { busColor: '#000000', textColor: '#fff' },
    '10M': { busColor: '#000000', textColor: '#fff' },
    '11M': { busColor: '#000000', textColor: '#fff' },
    '12M': { busColor: '#000000', textColor: '#fff' },
    '13M': { busColor: '#000000', textColor: '#fff' },
    '2': { busColor: '#187ec2', textColor: '#fff' },
    '3': { busColor: '#187ec2', textColor: '#fff' },
    '4': { busColor: '#187ec2', textColor: '#fff' },
    '5': { busColor: '#fcd116', textColor: '#000' }, // texto preto para linha 5xx
    '6': { busColor: '#00ac00', textColor: '#000' }, // texto preto para linha 6xx
    '7': { busColor: '#FF0000', textColor: '#fff' },
    '8': { busColor: '#a347ff', textColor: '#fff' },
    '9': { busColor: '#FF7900', textColor: '#fff' },
  };

  const customLineTexts = {
    '106': 'ZF',
    '107': 'ZC'
  };

  if (iconCache[line]) return iconCache[line];

  const prefix = (line && line.length > 0) ? line[0] : '';
  const colors = lineColors[line] || lineColors[prefix] || { busColor: '#000000', textColor: '#fff' };

  const displayText = customLineTexts[line] || line;

  const svg = `<svg width="17" height="8" xmlns="http://www.w3.org/2000/svg">
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
      A 0.7 0.7 0 0 1 1.2 1
      Z"
        stroke="#18d8d0" stroke-width="0.7" fill="none"/>
    <path d="M 1.7 1.6
           H 14.8
             A 0.5 0.6 0 0 1 15.3 2.2
      V 5.8
      H 1.2
      V 2.2
      A 0.5 0.6 0 0 1 1.7 1.6
      Z" 
        stroke="#fff" stroke-width="0.4"  fill="${colors.busColor}"/>
    <rect x="3.5" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4"  fill="none"/>
    <rect x="10" y="0.3" width="3" height="0.6" rx="0.1" stroke="#18d8d0" stroke-width="0.4"  fill="none"/>
    <circle cx="5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7"  fill="none"/>
    <circle cx="11.5" cy="6.5" r="1" stroke="#18d8d0" stroke-width="0.7"  fill="none"/>
    <text x="8.5" y="4" text-anchor="middle" alignment-baseline="middle" font-family="Calibri" font-size="4" font-weight="bold" fill="${colors.textColor}">${displayText}</text>
  </svg>`;
  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  const icon = L.icon({
    iconUrl: url,
    iconSize: [40, 28],
    iconAnchor: [20, 14],
    popupAnchor: [0, -20]
  });
  iconCache[line] = icon;
  return icon;
}

function defaultIcon() {
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

function extractDirectionRaw(bus) {
  if (!bus.annotations || !bus.annotations.value) return null;
  for (const annotation of bus.annotations.value) {
    const decoded = decodeURIComponent(annotation);
    if (decoded.startsWith("stcp:sentido:")) {
      return decoded.slice("stcp:sentido:".length);
    }
  }
  return null;
}

function obterDestino(line, sentido) {
  if (destinos[line] && destinos[line][sentido]) {
    return destinos[line][sentido];
  }
  return 'Destino Desconhecido';
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
      const sentidoRaw = extractDirectionRaw(bus);
      const destino = obterDestino(line, sentidoRaw);
      if (filterValue === '' || (line && line.startsWith(filterValue))) {
        validIDs.add(bus.id);
        const lat = bus.location?.value?.coordinates?.[1];
        const lon = bus.location?.value?.coordinates?.[0];
        if (lat == undefined || lon == undefined) return;
        const speed = bus.speed ? bus.speed.value : 'N/A';
        const busNumber = bus.fleetVehicleId ? bus.fleetVehicleId.value : 'N/A';
        const popupContent = `Linha: ${line}<br>Velocidade: ${speed} km/h<br>Destino: ${destino}<br>Veículo nº ${busNumber}`;
        if (busMarkers[bus.id]) {
          busMarkers[bus.id].setLatLng([lat, lon]);
          busMarkers[bus.id].setIcon(getBusIcon(line));
          busMarkers[bus.id].bindPopup(popupContent);
        } else {
          const marker = L.marker([lat, lon], { icon: getBusIcon(line) }).addTo(map);
          marker.bindPopup(popupContent);
          busMarkers[bus.id] = marker;
        }
      }
    });

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

window.onload = carregarDestinos;

forceRefresh();
