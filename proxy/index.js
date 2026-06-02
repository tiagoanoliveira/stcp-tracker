// Cloudflare Worker - CORS Proxy para STCP API
// v4.5 - Suporte a rotas custom (MB1 Metrobus) + veículos em tempo real unificados

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------------------------------------------------------------------------
// Endpoints externos
// ---------------------------------------------------------------------------
const FIWARE_VEHICLES_URL =
  'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType==bus&limit=1000';

const STCP_LIVE_VEHICLES_URL = 'https://stcp.live/api/vehicles';

// ---------------------------------------------------------------------------
// Lista completa de linhas STCP com cores oficiais.
// Mantida aqui porque a STCP não expõe endpoint de listagem fiável.
// Actualizar manualmente quando novas linhas forem criadas.
// ---------------------------------------------------------------------------
const STCP_ROUTES = [
  { id: '200',  number: '200', name: 'Bolhão - Castelo do Queijo',                    color: '#187EC2', text_color: '#FFFFFF' },
  { id: '201',  number: '201', name: 'Aliados - Viso',                                color: '#187EC2', text_color: '#FFFFFF' },
  { id: '202',  number: '202', name: 'Aliados - Passeio Alegre',                      color: '#187EC2', text_color: '#FFFFFF' },
  { id: '203',  number: '203', name: 'Estádio do Dragão - Boavista (Casa da Música)', color: '#187EC2', text_color: '#FFFFFF' },
  { id: '204',  number: '204', name: 'Hospital De S.João - Foz',                      color: '#187EC2', text_color: '#FFFFFF' },
  { id: '205',  number: '205', name: 'Campanhã - Castelo do Queijo',                  color: '#187EC2', text_color: '#FFFFFF' },
  { id: '206',  number: '206', name: 'Campanhã - Viso',                               color: '#187EC2', text_color: '#FFFFFF' },
  { id: '207',  number: '207', name: 'Campanhã - Mercado da Foz',                     color: '#187EC2', text_color: '#FFFFFF' },
  { id: '208',  number: '208', name: 'Aliados - Aldoar',                              color: '#187EC2', text_color: '#FFFFFF' },
  { id: '209',  number: '209', name: 'Pasteleira - Prelada',                          color: '#187EC2', text_color: '#FFFFFF' },
  { id: '300',  number: '300', name: 'Circular Hospital S. João - Aliados',           color: '#187EC2', text_color: '#FFFFFF' },
  { id: '301',  number: '301', name: 'Circular Hospital S. João - Sá da Bandeira',    color: '#187EC2', text_color: '#FFFFFF' },
  { id: '302',  number: '302', name: 'Circular Aliados - Damião de Gois',             color: '#187EC2', text_color: '#FFFFFF' },
  { id: '303',  number: '303', name: 'Circular Praça da liberdade - Constituição',    color: '#187EC2', text_color: '#FFFFFF' },
  { id: '304',  number: '304', name: 'Aliados - Sta. Lúzia',                          color: '#187EC2', text_color: '#FFFFFF' },
  { id: '305',  number: '305', name: 'Cordoaria - Hospital de S. João',               color: '#187EC2', text_color: '#FFFFFF' },
  { id: '400',  number: '400', name: 'Aliados - Parque Nascente',                     color: '#187EC2', text_color: '#FFFFFF' },
  { id: '401',  number: '401', name: 'Bolhão - S. Roque',                             color: '#187EC2', text_color: '#FFFFFF' },
  { id: '402',  number: '402', name: 'Boavista (Bom Sucesso) - S. Roque',             color: '#187EC2', text_color: '#FFFFFF' },
  { id: '403',  number: '403', name: 'Boavista (Casa da Música) - Campanhã',          color: '#187EC2', text_color: '#FFFFFF' },
  { id: '404',  number: '404', name: 'Campanhã (TIC) - Hospital de S. João',          color: '#187EC2', text_color: '#FFFFFF' },
  { id: '107',  number: 'ZC',  name: 'Estádio do Dragão - Areias',                    color: '#187EC2', text_color: '#FFFFFF' }, 
  { id: '500',  number: '500', name: 'Praça Liberdade - Matosinhos (Mercado)',        color: '#FCD116', text_color: '#000000' },
  { id: '501',  number: '501', name: 'Aliados - Matosinhos (Praia)',                  color: '#FCD116', text_color: '#000000' },
  { id: '502',  number: '502', name: 'Bolhão - Matosinhos (Mercado)',                 color: '#FCD116', text_color: '#000000' },
  { id: '503',  number: '503', name: 'Boavista (Bom Sucesso) - Gatões',               color: '#FCD116', text_color: '#000000' },
  { id: '504',  number: '504', name: 'Boavista (Casa da Música) - NorteShopping',     color: '#FCD116', text_color: '#000000' },
  { id: '505',  number: '505', name: 'Hospital de S. João - Matosinhos (Mercado)',    color: '#FCD116', text_color: '#000000' },
  { id: '506',  number: '506', name: 'Hospital de S. João - Matosinhos (Mercado)',    color: '#FCD116', text_color: '#000000' },
  { id: '507',  number: '507', name: 'Cordoaria - Mar Shopping',                      color: '#FCD116', text_color: '#000000' },
  { id: '508',  number: '508', name: 'Boavista (Casa da Música) - Cabo do Mundo',     color: '#FCD116', text_color: '#000000' },
  { id: '600',  number: '600', name: 'Aliados - Maia',                                color: '#00AC00', text_color: '#ffffff' },
  { id: '601',  number: '601', name: 'Cordoaria - Aeroporto (via Mar Shopping)',      color: '#00AC00', text_color: '#ffffff' },
  { id: '602',  number: '602', name: 'Cordoaria - Aeroporto (via Padrão Moreira)',    color: '#00AC00', text_color: '#ffffff' },
  { id: '603',  number: '603', name: 'Marquês - Maia (Espido)',                       color: '#00AC00', text_color: '#FFFFFF' },
  { id: '604',  number: '604', name: 'Hospital de S. João - Aeroporto (via Crestins)',color: '#00AC00', text_color: '#FFFFFF' },
  { id: '605',  number: '605', name: 'Marquês - Maia (Barca)',                        color: '#00AC00', text_color: '#FFFFFF' },
  { id: '700',  number: '700', name: 'Bolhão - Campo',                                color: '#FF0000', text_color: '#FFFFFF' },
  { id: '701',  number: '701', name: 'Bolhão - Codiceira',                            color: '#FF0000', text_color: '#FFFFFF' },
  { id: '702',  number: '702', name: 'Bolhão - Travagem',                             color: '#FF0000', text_color: '#FFFFFF' },
  { id: '703',  number: '703', name: 'Cordoaria - Ermesinde (Estação, via Sonhos)',   color: '#FF0000', text_color: '#FFFFFF' },
  { id: '704',  number: '704', name: 'Boavista (Casa da Música) - Codiceira',         color: '#FF0000', text_color: '#FFFFFF' },
  { id: '705',  number: '705', name: 'Hospital de S. João - Valongo',                 color: '#FF0000', text_color: '#FFFFFF' },
  { id: '706',  number: '706', name: 'Hosp. S. João - Ermesinde (via Mte. Penedo)',   color: '#FF0000', text_color: '#FFFFFF' }, 
  { id: '707',  number: '707', name: 'Hosp. S. João - Ermesinde (via Arregadas)',     color: '#FF0000', text_color: '#FFFFFF' },
  { id: '800',  number: '800', name: 'Bolhão - Gondomar',                             color: '#A347FF', text_color: '#FFFFFF' },
  { id: '801',  number: '801', name: 'Cordoaria - S. Pedro da Cova',                  color: '#A347FF', text_color: '#FFFFFF' },
  { id: '803',  number: '803', name: 'Boavista (Bom Sucesso) - Rio Tinto',            color: '#A347FF', text_color: '#FFFFFF' },
  { id: '804',  number: '804', name: 'Hospital de S. João - S. Pedro da Cova',        color: '#A347FF', text_color: '#FFFFFF' },
  { id: '805',  number: '805', name: 'Marquês - Rio Tinto (Estação)',                 color: '#A347FF', text_color: '#FFFFFF' },
  { id: '806',  number: '806', name: 'Marquês - Fânzeres (Metro)',                    color: '#A347FF', text_color: '#FFFFFF' },
  { id: '900',  number: '900', name: 'Cordoaria - Francelos',                         color: '#FF7900', text_color: '#FFFFFF' },
  { id: '901',  number: '901', name: 'Trindade - Valadares',                          color: '#FF7900', text_color: '#FFFFFF' },
  { id: '902',  number: '902', name: 'Boavista (Casa da Música) - Lavadores',         color: '#FF7900', text_color: '#FFFFFF' },
  { id: '903',  number: '903', name: 'Boavista (Casa da Música) - Laborim',           color: '#FF7900', text_color: '#FFFFFF' },
  { id: '904',  number: '904', name: 'Bolhão - Coimbrões',                            color: '#FF7900', text_color: '#FFFFFF' },
  { id: '905',  number: '905', name: 'Trindade - Madalena (C. Saúde)',                color: '#FF7900', text_color: '#FFFFFF' },
  { id: '906',  number: '906', name: 'Trindade - Madalena',                           color: '#FF7900', text_color: '#FFFFFF' },
  { id: '907',  number: '907', name: 'Boavista (Bom Sucesso) - Vila d Este',          color: '#FF7900', text_color: '#FFFFFF' },
  { id: '1M',   number: '1M',  name: 'Aliados - Matosinhos (Praia)',                  color: '#000000', text_color: '#FFFFFF' },
  { id: '2M',   number: '2M',  name: 'Aliados - Hospital de S. João',                 color: '#000000', text_color: '#FFFFFF' },
  { id: '3M',   number: '3M',  name: 'Aliados - Aeroporto',                           color: '#000000', text_color: '#FFFFFF' },
  { id: '4M',   number: '4M',  name: 'Aliados - Maia (Câmara)',                       color: '#000000', text_color: '#FFFFFF' },
  { id: '5M',   number: '5M',  name: 'Aliados - Ermesinde (Estação)',                 color: '#000000', text_color: '#FFFFFF' },
  { id: '7M',   number: '7M',  name: 'Aliados - Valongo',                             color: '#000000', text_color: '#FFFFFF' },
  { id: '8M',   number: '8M',  name: 'Aliados - S. Pedro da Cova',                    color: '#000000', text_color: '#FFFFFF' },
  { id: '9M',   number: '9M',  name: 'Aliados - Gondomar (via TIC)',                  color: '#000000', text_color: '#FFFFFF' },
  { id: '10M',  number: '10M', name: 'Aliados - Vila D Este',                         color: '#000000', text_color: '#FFFFFF' },
  { id: '11M',  number: '11M', name: 'Hospital S. João - Coimbrões (via Aliados)',    color: '#000000', text_color: '#FFFFFF' },
  { id: '12M',  number: '12M', name: 'Aliados - Sto. Ovídio',                         color: '#000000', text_color: '#FFFFFF' },
  { id: '13M',  number: '13M', name: 'Aliados - Matosinhos (Mercado)',                color: '#000000', text_color: '#FFFFFF' },
];

// ---------------------------------------------------------------------------
// Rotas custom (não disponíveis na API STCP) — dados estáticos geridos aqui.
// ---------------------------------------------------------------------------
const CUSTOM_ROUTES = [
  { id: 'MB1', number: 'MB1', name: 'Boavista - Praça do Império', color: '#00a7b0', text_color: '#FFFFFF' },
];

const CUSTOM_ROUTE_IDS = new Set(CUSTOM_ROUTES.map(r => r.id));

// Shape da MB1 (coordenadas da polyline)
const MB1_SHAPE = {
  success: true, route_id: 'MB1', direction_id: 0,
  coordinates: [
    { lat: 41.158239, lng: -8.630995, sequence: 1 },
    { lat: 41.159209, lng: -8.636708, sequence: 2 },
    { lat: 41.160582, lng: -8.645091, sequence: 3 },
    { lat: 41.161924, lng: -8.653029, sequence: 4 },
    { lat: 41.162323, lng: -8.655446, sequence: 5 },
    { lat: 41.160858, lng: -8.658241, sequence: 6 },
    { lat: 41.155539, lng: -8.671809, sequence: 7 },
  ],
};

// Paragens da MB1
const MB1_STOPS = {
  success: true, route_id: 'MB1', direction_id: 0,
  stops: [
    { stop_id: 'MB1_01', stop_code: 'MB1_01', stop_name: 'Boavista',         latitude: 41.158239, longitude: -8.630995, stop_sequence: 1, zone_id: '1' },
    { stop_id: 'MB1_02', stop_code: 'MB1_02', stop_name: 'Guerra Junqueiro', latitude: 41.159209, longitude: -8.636708, stop_sequence: 2, zone_id: '1' },
    { stop_id: 'MB1_03', stop_code: 'MB1_03', stop_name: 'Bessa',            latitude: 41.160582, longitude: -8.645091, stop_sequence: 3, zone_id: '1' },
    { stop_id: 'MB1_04', stop_code: 'MB1_04', stop_name: 'Pinheiro Manso',   latitude: 41.161878, longitude: -8.653037, stop_sequence: 4, zone_id: '2' },
    { stop_id: 'MB1_05', stop_code: 'MB1_05', stop_name: 'Serralves',        latitude: 41.160617, longitude: -8.658885, stop_sequence: 5, zone_id: '2' },
    { stop_id: 'MB1_06', stop_code: 'MB1_06', stop_name: 'João De Barros',   latitude: 41.158491, longitude: -8.664280, stop_sequence: 6, zone_id: '2' },
    { stop_id: 'MB1_07', stop_code: 'MB1_07', stop_name: 'Praça do Império', latitude: 41.155539, longitude: -8.671809, stop_sequence: 7, zone_id: '2' },
  ],
};

// Map auxiliar de stops MB1 por ID para endpoints de info
const MB1_STOPS_MAP = new Map(MB1_STOPS.stops.map(s => [s.stop_id, s]));

// ---------------------------------------------------------------------------
// Veículos - normalização para formato comum
// ---------------------------------------------------------------------------

function normalizeStcpLiveVehicle(v) {
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return null;

  return {
    id: String(v.id),
    routeId: String(v.routeId ?? ''),
    directionId: Number(v.directionId ?? 0),
    lat: v.lat,
    lng: v.lng,
    speed: Number.isFinite(v.speed) ? v.speed : 0,
    bearing: Number.isFinite(v.bearing) ? v.bearing : null,
    timestamp: Number.isFinite(v.timestamp)
      ? v.timestamp
      : Math.floor(Date.now() / 1000),
    tripId: v.tripId ?? null,
  };
}

function extractAnnotationFromFiware(bus, prefix) {
  const arr = bus.annotations?.value;
  if (!Array.isArray(arr)) return null;
  for (const raw of arr) {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith(prefix)) return decoded.slice(prefix.length);
  }
  return null;
}

function normalizeFiwareVehicle(bus) {
  const coords = bus.location?.value?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const lon = coords[0];
  const lat = coords[1];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const routeId = extractAnnotationFromFiware(bus, 'stcp:route:');
  const directionStr = extractAnnotationFromFiware(bus, 'stcp:sentido:');
  const tripId = extractAnnotationFromFiware(bus, 'stcp:nr_viagem:');

  if (!routeId || directionStr == null) return null;

  const directionId = Number(directionStr);
  const speedVal = bus.speed?.value;
  const speed = Number.isFinite(speedVal) ? speedVal : 0;

  const tsRaw =
    bus.dateObserved?.value ||
    bus.observedAt ||
    bus.modifiedAt ||
    Date.now();
  const tsMs = typeof tsRaw === 'string' ? Date.parse(tsRaw) : tsRaw;
  const timestamp = Number.isFinite(tsMs)
    ? Math.floor(tsMs / 1000)
    : Math.floor(Date.now() / 1000);

  const id =
    bus.fleetVehicleId?.value != null
      ? String(bus.fleetVehicleId.value)
      : String(bus.id);

  return {
    id,
    routeId: String(routeId),
    directionId: Number.isNaN(directionId) ? 0 : directionId,
    lat,
    lng: lon,
    speed,
    bearing: null,
    timestamp,
    tripId: tripId ?? null,
  };
}

async function handleStcpLiveVehicles() {
  try {
    const resp = await fetch(STCP_LIVE_VEHICLES_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.5)',
      },
    });

    if (!resp.ok) {
      return errorResponse(
        `Erro ao obter veículos da STCP LIVE (status ${resp.status})`,
        resp.status
      );
    }

    const raw = await resp.json();
    const vehicles = Array.isArray(raw)
      ? raw.map(normalizeStcpLiveVehicle).filter(Boolean)
      : [];

    return jsonResponse(
      { success: true, source: 'stcp-live', vehicles },
      'vehicles',
      'public, max-age=3'
    );
  } catch (error) {
    return errorResponse(
      `Erro ao obter veículos da STCP LIVE: ${error.message}`,
      502
    );
  }
}

async function handleFiwareVehicles() {
  try {
    const resp = await fetch(FIWARE_VEHICLES_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.5)',
      },
    });

    if (!resp.ok) {
      return errorResponse(
        `Erro ao obter veículos da FIWARE (status ${resp.status})`,
        resp.status
      );
    }

    const raw = await resp.json();
    const vehicles = Array.isArray(raw)
      ? raw.map(normalizeFiwareVehicle).filter(Boolean)
      : [];

    return jsonResponse(
      { success: true, source: 'fiware', vehicles },
      'vehicles_fiware',
      'no-store'
    );
  } catch (error) {
    return errorResponse(
      `Erro ao obter veículos da FIWARE: ${error.message}`,
      502
    );
  }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.slice(1).split('/').filter(p => p);

  if (pathParts.length === 0) {
    return new Response(
      JSON.stringify({
        message: 'STCP CORS Proxy',
        version: '4.5',
        endpoints: {
          stop_endpoints:     ['realtime', 'routes', 'schedule', 'info', 'services'],
          location_endpoints: ['nearby'],
          route_endpoints:    ['schedule', 'shape', 'stops', 'list'],
          search_endpoints:   ['search'],
          vehicles_endpoints: ['vehicles', 'vehicles/fiware']
        },
        usage: {
          realtime:       'GET /{STOP_ID}/realtime',
          routes:         'GET /{STOP_ID}/routes',
          stop_schedule:  'GET /{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}',
          stop_info:      'GET /{STOP_ID}/info',
          stop_services:  'GET /{STOP_ID}/services?date={YYYY-MM-DD}',
          nearby:         'GET /nearby/{LAT}/{LNG}/{RADIUS}',
          route_schedule: 'GET /route/{ROUTE_ID}/schedule?service_id={SERVICE}&direction_id={DIR}',
          route_shape:    'GET /route/{ROUTE_ID}/shape?direction_id={DIR}',
          route_stops:    'GET /route/{ROUTE_ID}/stops?direction_id={DIR}',
          routes_list:    'GET /routes/list',
          search:         'GET /search?q={QUERY}&limit={LIMIT}',
          vehicles:       'GET /vehicles (preciso) ou /vehicles/fiware (alternativo)'
        }
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const firstSegment = pathParts[0];

    // -----------------------------------------------------------------------
    // 0. Vehicle endpoints: /vehicles (stcp.live) e /vehicles/fiware (FIWARE)
    // -----------------------------------------------------------------------
    if (firstSegment === 'vehicles') {
      const mode = pathParts[1] || 'primary';
      if (mode === 'fiware') return await handleFiwareVehicles();
      return await handleStcpLiveVehicles();
    }

    // -----------------------------------------------------------------------
    // 1. Nearby stops: /nearby/{lat}/{lng}/{radius}
    // -----------------------------------------------------------------------
    if (firstSegment === 'nearby') {
      if (pathParts.length < 4) return errorResponse('Uso: /nearby/{LAT}/{LNG}/{RADIUS}', 400);
      const [_, lat, lng, radius] = pathParts;
      return await proxyRequest(
        `https://stcp.pt/api/stops/nearby?lat=${lat}&lng=${lng}&radius=${radius}`,
        'nearby', 'public, max-age=300'
      );
    }

    // -----------------------------------------------------------------------
    // 2. Route endpoints: /route/{routeId}/{sub}
    // -----------------------------------------------------------------------
    if (firstSegment === 'route') {
      const routeId = pathParts[1];
      const sub     = pathParts[2];

      if (!routeId) return errorResponse('Uso: /route/{ROUTE_ID}/{schedule|shape|stops}', 400);

      // --- 2a. Schedule (não existe para rotas custom — o horário é gerido no frontend)
      if (sub === 'schedule') {
        if (CUSTOM_ROUTE_IDS.has(routeId)) {
          return errorResponse(`A rota ${routeId} é uma rota custom; o horário é gerido localmente pelo cliente.`, 404);
        }
        return await proxyRequest(
          `https://stcp.pt/api/route/${routeId}/schedule${url.search}`,
          'route_schedule', 'public, max-age=1800'
        );
      }

      // --- 2b. Shape
      if (sub === 'shape') {
        if (routeId === 'MB1') {
          return jsonResponse(MB1_SHAPE, 'route_shape', 'public, max-age=86400');
        }
        const directionId = url.searchParams.get('direction_id') ?? '0';
        const raw = await proxyRawRequest(
          `https://stcp.pt/api/route/${routeId}/shape?direction_id=${directionId}`,
          'route_shape'
        );
        if (!raw.ok) return errorResponse(`Erro ao obter shape da rota ${routeId}`, raw.status);
        const d = await raw.json();
        const coords = (d.coordinates || [])
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
          .map(c => ({ lat: c.lat, lng: c.lng, sequence: c.sequence }));
        return jsonResponse({
          success: true,
          route_id: String(routeId),
          direction_id: Number(directionId),
          coordinates: coords
        }, 'route_shape', 'public, max-age=3600');
      }

      // --- 2c. Stops da rota
      if (sub === 'stops') {
        if (routeId === 'MB1') {
          return jsonResponse(MB1_STOPS, 'route_stops', 'public, max-age=86400');
        }
        const directionId = url.searchParams.get('direction_id') ?? '0';
        const raw = await proxyRawRequest(
          `https://stcp.pt/api/route/${routeId}/stops/direction?direction_id=${directionId}`,
          'route_stops'
        );
        if (!raw.ok) return errorResponse(`Erro ao obter paragens da rota ${routeId}`, raw.status);
        const d = await raw.json();
        const stops = (d.stops || [])
          .sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0))
          .map(s => ({
            stop_id:       s.stop_id,
            stop_code:     s.stop_code,
            stop_name:     s.stop_name,
            latitude:      s.stop_lat,
            longitude:     s.stop_lon,
            stop_sequence: s.stop_sequence,
            zone_id:       s.zone_id || null
          }));
        return jsonResponse({
          success: true,
          route_id: String(routeId),
          direction_id: Number(directionId),
          stops
        }, 'route_stops', 'public, max-age=3600');
      }

      return errorResponse(`Sub-endpoint inválido: ${sub}. Use: schedule, shape ou stops`, 400);
    }

    // -----------------------------------------------------------------------
    // 3. Routes list: /routes/list  →  lista estática + custom, sem chamada externa
    // -----------------------------------------------------------------------
    if (firstSegment === 'routes' && pathParts[1] === 'list') {
      const allRoutes = [...STCP_ROUTES, ...CUSTOM_ROUTES];
      return jsonResponse(
        { success: true, routes: allRoutes, source: 'static' },
        'routes_list', 'public, max-age=86400'
      );
    }

    // -----------------------------------------------------------------------
    // 4. Search stops: /search?q={query}&limit={limit}
    // -----------------------------------------------------------------------
    if (firstSegment === 'search') {
      const q     = url.searchParams.get('q');
      const limit = url.searchParams.get('limit') || '100';
      if (!q || q.trim().length === 0)
        return errorResponse('Parâmetro "q" é obrigatório. Uso: /search?q={query}&limit={limit}', 400);
      const rawResponse = await proxyRawRequest(
        `https://stcp.pt/api/stops/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
        'search'
      );
      if (!rawResponse.ok) return errorResponse('Erro ao pesquisar paragens na API STCP', rawResponse.status);
      const rawData = await rawResponse.json();
      const stops = (rawData.stops || []).map(s => ({
        stop_id:   s.code || s.id,
        stop_code: s.code || s.id,
        stop_name: s.name,
        latitude:  s.latitude,
        longitude: s.longitude,
        zone_id:   s.zone_id || null,
        routes:    (s.routes || []).map(r => ({ id: r.id, number: r.number, name: r.name }))
      }));
      return jsonResponse({ stops }, 'search', 'public, max-age=300');
    }

    // -----------------------------------------------------------------------
    // 5. Stop endpoints: /{stopId}/{endpoint}
    // -----------------------------------------------------------------------
    const stopId   = firstSegment;
    const endpoint = pathParts[1] || 'realtime';

    // --- 5a. Serviços ativos de uma paragem para uma data
    if (endpoint === 'services') {
      const date = url.searchParams.get('date');
      if (!date) return errorResponse('Parâmetro "date" é obrigatório. Uso: /{stopId}/services?date=YYYY-MM-DD', 400);
      return await proxyRequest(
        `https://stcp.pt/api/stops/${stopId}/services?date=${date}`,
        'stop_services', 'public, max-age=3600'
      );
    }

    // --- 5b. Info da paragem
    if (endpoint === 'info') {
      // Paragens custom (ex: MB1_04) — devolve info sintética
      if (MB1_STOPS_MAP.has(stopId)) {
        const s = MB1_STOPS_MAP.get(stopId);
        return jsonResponse({
          stop_id:   s.stop_id,
          stop_name: s.stop_name,
          stop_code: s.stop_code,
          latitude:  s.latitude,
          longitude: s.longitude,
          zone_id:   s.zone_id || null,
          routes:    CUSTOM_ROUTES.filter(r => r.id === 'MB1'),
        }, 'stop_info', 'public, max-age=86400');
      }

      const rawResponse = await proxyRawRequest(`https://stcp.pt/api/stops/${stopId}`, 'stop_info');
      if (!rawResponse.ok)
        return errorResponse(`Erro ao obter informação da paragem ${stopId}`, rawResponse.status);
      const d = await rawResponse.json();
      return jsonResponse({
        stop_id:   d.stop_id,
        stop_name: d.stop_name,
        stop_code: d.stop_code,
        latitude:  d.stop_lat,
        longitude: d.stop_lon,
        zone_id:   d.zone_id || null,
        routes: (d.routes || []).map(r => ({
          id:         r.id,
          number:     r.number,
          name:       r.name,
          color:      r.color,
          text_color: r.text_color
        }))
      }, 'stop_info', 'public, max-age=1800');
    }

    const validStopEndpoints = ['realtime', 'routes', 'schedule'];
    if (!validStopEndpoints.includes(endpoint))
      return errorResponse(`Endpoint inválido: ${endpoint}. Use: ${validStopEndpoints.join(', ')}, info ou services`, 400);

    let stcpApiUrl = `https://stcp.pt/api/stops/${stopId}/${endpoint}`;
    if (url.search) stcpApiUrl += url.search;

    const cacheControl = (endpoint === 'routes' || endpoint === 'schedule')
      ? 'public, max-age=1800'
      : 'public, max-age=10';

    return await proxyRequest(stcpApiUrl, endpoint, cacheControl);

  } catch (error) {
    console.error('[WORKER] Error:', error.message);
    return errorResponse(`Erro interno: ${error.message}`, 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, endpoint, cacheControl) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Proxy-Version': '4.5',
      'X-Endpoint': endpoint,
    },
  });
}

async function proxyRequest(stcpApiUrl, endpoint, cacheControl) {
  const response = await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.5)', 'Accept': 'application/json' },
  });
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Proxy-Version': '4.5',
      'X-Endpoint': endpoint
    }
  });
}

async function proxyRawRequest(stcpApiUrl) {
  return await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.5)', 'Accept': 'application/json' },
  });
}

function errorResponse(message, status = 400) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request);
  }
};
