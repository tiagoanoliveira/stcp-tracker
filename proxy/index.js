import STCP_ROUTES_DATA from '../resources/routes/stcp-routes.json' with { type: 'json' };
import UNIR_ROUTES_DATA from '../resources/routes/unir-routes.json' with { type: 'json' };
import METROBUS_ROUTES_DATA from '../resources/routes/metrobus-routes.json' with { type: 'json' };
import METROBUS_STOP_TIMES from '../resources/metrobus/stop-times.json' with { type: 'json' };

const STCP_ROUTES = Array.isArray(STCP_ROUTES_DATA) ? STCP_ROUTES_DATA : (STCP_ROUTES_DATA.routes ?? []);
const UNIR_ROUTES = Array.isArray(UNIR_ROUTES_DATA) ? UNIR_ROUTES_DATA : (UNIR_ROUTES_DATA.routes ?? []);
const METROBUS_ROUTES = Array.isArray(METROBUS_ROUTES_DATA) ? METROBUS_ROUTES_DATA : (METROBUS_ROUTES_DATA.routes ?? []);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Cache-Control',
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
};

const STCP_BASE_URL = 'https://api.stcp.pt/whatever-you-use-today';
const UNIR_VEHICLES_URL = 'https://link-real-que-ja-usas-para-unir';
const USER_AGENT = 'Mozilla/5.0 (compatible; STCP-Tracker/5.0; +https://tiagoanoliveira.pt)';

function jsonResponse(data, status = 200, cacheControl = 'public, max-age=15') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': cacheControl,
    },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({
    success: false,
    error: message,
  }, status, 'no-store');
}

function emptyOk(payload = {}) {
  return jsonResponse({
    success: true,
    ...payload,
  });
}

function normalizeColor(value, fallback = '#187EC2') {
  if (!value) return fallback;
  const color = String(value).trim();
  if (!color) return fallback;
  return color.startsWith('#') ? color : `#${color}`;
}

function normalizeRouteRecord(route, fallbackOperator = 'STCP') {
  const id = String(route.id ?? route.route_id ?? route.number ?? route.route_short_name ?? '').trim();
  const number = String(route.number ?? route.route_short_name ?? route.id ?? '').trim();
  const name = String(route.name ?? route.route_long_name ?? route.long_name ?? number).trim();

  return {
    id,
    number,
    name,
    color: normalizeColor(route.color ?? route.route_color, '#187EC2'),
    text_color: normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
    operator: String(route.operator ?? fallbackOperator),
  };
}

function normalizeStcpVehicle(raw) {
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lon ?? raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: String(raw.id ?? raw.vehicle_id ?? raw.bus_id ?? ''),
    line: String(raw.line ?? raw.route ?? raw.route_short_name ?? ''),
    displayLine: String(raw.displayLine ?? raw.line ?? raw.route ?? raw.route_short_name ?? ''),
    direction: Number(raw.direction ?? raw.direction_id ?? 0),
    destination: raw.destination ?? raw.headsign ?? null,
    tripId: raw.tripId ?? raw.trip_id ?? null,
    busNumber: raw.busNumber ?? raw.vehicle_label ?? raw.id ?? null,
    lat,
    lng,
    bearing: Number.isFinite(Number(raw.bearing)) ? Number(raw.bearing) : null,
    timestamp: Number(raw.timestamp ?? Math.floor(Date.now() / 1000)),
    source: 'stcp',
  };
}

function normalizeUnirVehicle(raw) {
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lon ?? raw.lng ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const line = String(raw.line ?? raw.route_id ?? raw.route_short_name ?? raw.pattern_id ?? '').trim();

  return {
    id: String(raw.id ?? raw.vehicle_id ?? raw.bus_id ?? ''),
    line,
    displayLine: line,
    direction: Number(raw.direction ?? raw.direction_id ?? 0),
    destination: raw.destination ?? raw.headsign ?? null,
    tripId: raw.tripId ?? raw.trip_id ?? null,
    busNumber: raw.busNumber ?? raw.vehicle_label ?? raw.id ?? null,
    lat,
    lng,
    bearing: Number.isFinite(Number(raw.bearing)) ? Number(raw.bearing) : null,
    timestamp: Number(raw.timestamp ?? Math.floor(Date.now() / 1000)),
    source: 'unir',
  };
}

function getAllRoutes() {
  return [
    ...STCP_ROUTES.map(r => normalizeRouteRecord(r, 'STCP')),
    ...METROBUS_ROUTES.map(r => normalizeRouteRecord(r, 'MetroBus')),
    ...UNIR_ROUTES.map(r => normalizeRouteRecord(r, 'UNIR')),
  ];
}

function getRouteMeta(routeId) {
  return getAllRoutes().find(r => String(r.id) === String(routeId) || String(r.number) === String(routeId)) ?? null;
}

function getDirection(requestUrl) {
  const dir = Number(new URL(requestUrl).searchParams.get('direction') ?? 0);
  return dir === 1 ? 1 : 0;
}

function getStopId(requestUrl) {
  return new URL(requestUrl).searchParams.get('stopId') ?? null;
}

function isMetrobusRoute(routeId) {
  const key = String(routeId);
  return METROBUS_ROUTES.some(r =>
      String(r.id ?? r.route_id ?? r.number) === key ||
      String(r.number ?? r.route_short_name ?? r.id) === key
  );
}

function buildMetrobusSchedule(routeId, stopId = null) {
  const key = String(routeId);
  const routeEntry = METROBUS_STOP_TIMES.find(r => String(r.route_id) === key);
  if (!routeEntry) {
    return {
      routeId: key,
      stopId,
      departures: [],
    };
  }

  const departures = [];

  for (const trip of (routeEntry.trips ?? [])) {
    for (const stop of (trip.stops ?? [])) {
      if (stopId && String(stop.stop_id) !== String(stopId)) continue;
      departures.push({
        tripId: String(trip.trip_id),
        stopId: String(stop.stop_id),
        arrivalTime: String(stop.arrival_time),
        departureTime: String(stop.departure_time),
        stopSequence: Number(stop.stop_sequence),
      });
    }
  }

  departures.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

  return {
    routeId: key,
    stopId,
    departures,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }

  return response.json();
}

async function handleStcpVehicles() {
  try {
    const raw = await fetchJson(`${STCP_BASE_URL}/vehicles`);
    const input = Array.isArray(raw) ? raw : (raw.vehicles ?? raw.data ?? []);
    const vehicles = input.map(normalizeStcpVehicle).filter(Boolean);

    return jsonResponse({
      success: true,
      source: 'stcp',
      vehicles,
    }, 200, 'public, max-age=5');
  } catch (error) {
    return errorResponse(`Erro ao obter veículos STCP: ${error.message}`, 502);
  }
}

async function handleUnirVehicles() {
  try {
    const raw = await fetchJson(UNIR_VEHICLES_URL);
    const input = Array.isArray(raw) ? raw : (raw.vehicles ?? raw.data ?? []);
    const vehicles = input.map(normalizeUnirVehicle).filter(Boolean);

    return jsonResponse({
      success: true,
      source: 'unir',
      vehicles,
    }, 200, 'public, max-age=5');
  } catch (error) {
    return errorResponse(`Erro ao obter veículos UNIR: ${error.message}`, 502);
  }
}

async function handleRoutesList() {
  const routes = getAllRoutes();

  return jsonResponse({
    success: true,
    routes,
  }, 200, 'public, max-age=3600');
}

async function handleRouteShape(routeId, direction) {
  const route = getRouteMeta(routeId);

  if (!route) {
    return errorResponse(`Linha não encontrada: ${routeId}`, 404);
  }

  if (route.operator === 'UNIR') {
    return errorResponse(
        'As shapes UNIR devem ser servidas localmente a partir de resources/unir-gtfs/shapes/*.json no frontend/serviço de overlays.',
        400
    );
  }

  if (route.operator === 'MetroBus') {
    return errorResponse(
        'A shape MetroBus deve ser servida a partir de recurso local dedicado se necessário.',
        400
    );
  }

  try {
    const raw = await fetchJson(`${STCP_BASE_URL}/routes/${encodeURIComponent(route.id)}/shape?direction=${direction}`);

    return jsonResponse({
      success: true,
      routeId: String(route.id),
      direction,
      ...raw,
    }, 200, 'public, max-age=86400');
  } catch (error) {
    return errorResponse(`Erro ao obter shape da linha ${routeId}: ${error.message}`, 502);
  }
}

async function handleRouteStops(routeId, direction) {
  const route = getRouteMeta(routeId);

  if (!route) {
    return errorResponse(`Linha não encontrada: ${routeId}`, 404);
  }

  if (route.operator === 'MetroBus') {
    const routeEntry = METROBUS_STOP_TIMES.find(r => String(r.route_id) === String(route.id));
    if (!routeEntry) {
      return emptyOk({
        routeId: String(route.id),
        direction,
        stops: [],
      });
    }

    const byStop = new Map();

    for (const trip of (routeEntry.trips ?? [])) {
      for (const stop of (trip.stops ?? [])) {
        const stopId = String(stop.stop_id);
        if (!byStop.has(stopId)) {
          byStop.set(stopId, {
            stopid: stopId,
            stop_sequence: Number(stop.stop_sequence),
          });
        }
      }
    }

    const stops = Array.from(byStop.values()).sort((a, b) => a.stop_sequence - b.stop_sequence);

    return jsonResponse({
      success: true,
      routeId: String(route.id),
      direction,
      stops,
    }, 200, 'public, max-age=86400');
  }

  try {
    const raw = await fetchJson(`${STCP_BASE_URL}/routes/${encodeURIComponent(route.id)}/stops?direction=${direction}`);

    return jsonResponse({
      success: true,
      routeId: String(route.id),
      direction,
      ...raw,
    }, 200, 'public, max-age=86400');
  } catch (error) {
    return errorResponse(`Erro ao obter paragens da linha ${routeId}: ${error.message}`, 502);
  }
}

async function handleRouteSchedule(routeId, stopId) {
  const route = getRouteMeta(routeId);

  if (!route) {
    return errorResponse(`Linha não encontrada: ${routeId}`, 404);
  }

  if (route.operator === 'MetroBus') {
    return jsonResponse({
      success: true,
      source: 'metrobus-local',
      ...buildMetrobusSchedule(route.id, stopId),
    }, 200, 'public, max-age=3600');
  }

  try {
    const url = new URL(`${STCP_BASE_URL}/routes/${encodeURIComponent(route.id)}/schedule`);
    if (stopId) url.searchParams.set('stopId', stopId);

    const raw = await fetchJson(url.toString());

    return jsonResponse({
      success: true,
      source: 'stcp-remote',
      routeId: String(route.id),
      stopId,
      ...raw,
    }, 200, 'public, max-age=60');
  } catch (error) {
    return errorResponse(`Erro ao obter horários da linha ${routeId}: ${error.message}`, 502);
  }
}

function parseRoutePath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;

  return {
    routeId: decodeURIComponent(parts[1]),
    action: parts[2],
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return errorResponse('Método não suportado', 405);
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/vehicles/stcp') {
      return handleStcpVehicles();
    }

    if (pathname === '/vehicles/unir') {
      return handleUnirVehicles();
    }

    if (pathname === '/routes/list') {
      return handleRoutesList();
    }

    if (pathname.startsWith('/routes/')) {
      const parsed = parseRoutePath(pathname);

      if (!parsed) {
        return errorResponse('Endpoint de rota inválido', 404);
      }

      const { routeId, action } = parsed;
      const direction = getDirection(request.url);
      const stopId = getStopId(request.url);

      if (action === 'shape') {
        return handleRouteShape(routeId, direction);
      }

      if (action === 'stops') {
        return handleRouteStops(routeId, direction);
      }

      if (action === 'schedule') {
        return handleRouteSchedule(routeId, stopId);
      }

      return errorResponse('Ação de rota inválida', 404);
    }

    return errorResponse('Endpoint não encontrado', 404);
  },
};