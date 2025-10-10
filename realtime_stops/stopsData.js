// stopsData.js - Carrega e gere informações sobre paragens STCP

let STOPS_DATA = [];

// Carregar dados do ficheiro stops.json
export async function loadStopsData() {
  try {
    const response = await fetch('./resources/stops.json');
    const data = await response.json();
    
    // Mapear os dados para o formato esperado
    STOPS_DATA = data.map(stop => ({
      stop_id: stop.stop_code,
      stop_name: stop.stop_name,
      latitude: stop.stop_lat,
      longitude: stop.stop_lon,
      stop_url: stop.stop_url
    }));
    
    console.log(`${STOPS_DATA.length} paragens carregadas`);
    return STOPS_DATA;
  } catch (error) {
    console.error('Erro ao carregar stops.json:', error);
    return [];
  }
}

// Obter todas as paragens
export function getAllStops() {
  return STOPS_DATA;
}

// Função para obter paragens próximas ao utilizador
export function getNearbyStops(userLat, userLon, maxDistance = 1000) {
  return STOPS_DATA.map(stop => {
    const distance = calculateDistance(userLat, userLon, stop.latitude, stop.longitude);
    return { ...stop, distance };
  })
  .filter(stop => stop.distance <= maxDistance)
  .sort((a, b) => a.distance - b.distance);
}

// Função para pesquisar paragens por nome
export function searchStops(query) {
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return STOPS_DATA;
  
  return STOPS_DATA.filter(stop => 
    stop.stop_name.toLowerCase().includes(lowerQuery) ||
    stop.stop_id.toLowerCase().includes(lowerQuery)
  );
}

// Cálculo de distância usando fórmula Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Raio da Terra em metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distância em metros
}

export { STOPS_DATA };
