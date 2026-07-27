import STCP_ROUTES_DATA from '../resources/routes/stcp-routes.json' with { type: 'json' };
import UNIR_ROUTES_DATA from '../resources/routes/unir-routes.json' with { type: 'json' };
import METROBUS_ROUTES_DATA from '../resources/routes/metrobus-routes.json' with { type: 'json' };

import STCP_STOPS_DATA from '../resources/stops/stcp-stops.json' with { type: 'json' };
import UNIR_STOPS_DATA from '../resources/stops/unir-stops.json' with { type: 'json' };
import METROBUS_STOPS_DATA from '../resources/stops/metrobus-stops.json' with { type: 'json' };

import METROBUS_STOP_TIMES from '../resources/metrobus/stop-times.json' with { type: 'json' };
import METROBUS_SHAPES from '../resources/metrobus/shapes.json' with { type: 'json' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Cache-Control',
};

const STCP_API_BASE = 'https://stcp.pt/api';

const STCP_ROUTES = Array.isArray(STCP_ROUTES_DATA) ? STCP_ROUTES_DATA : (STCP_ROUTES_DATA.routes ?? []);
const UNIR_ROUTES = Array.isArray(UNIR_ROUTES_DATA) ? UNIR_ROUTES_DATA : (UNIR_ROUTES_DATA.routes ?? []);
const METROBUS_ROUTES = Array.isArray(METROBUS_ROUTES_DATA) ? METROBUS_ROUTES_DATA : (METROBUS_ROUTES_DATA.routes ?? []);

const STCP_STOPS = Array.isArray(STCP_STOPS_DATA) ? STCP_STOPS_DATA : (STCP_STOPS_DATA.stops ?? []);
const UNIR_STOPS = Array.isArray(UNIR_STOPS_DATA) ? UNIR_STOPS_DATA : (UNIR_STOPS_DATA.stops ?? []);
const METROBUS_STOPS = Array.isArray(METROBUS_STOPS_DATA) ? METROBUS_STOPS_DATA : (METROBUS_STOPS_DATA.stops ?? []);

const ALL_ROUTES = [
  ...STCP_ROUTES.map(r => normalizeRoute(r, 'stcp')),
  ...METROBUS_ROUTES.map(r => normalizeRoute(r, 'metrobus')),
  ...UNIR_ROUTES.map(r => normalizeRoute(r, 'unir')),
];

const ALL_STOPS = [
  ...STCP_STOPS.map(s => normalizeStopRecord(s, 'stcp')),
  ...METROBUS_STOPS.map(s => normalizeStopRecord(s, 'metrobus')),
  ...UNIR_STOPS.map(s => normalizeStopRecord(s, 'unir')),
];

const ROUTE_BY_ID = new Map();
for (const route of ALL_ROUTES) {
  ROUTE_BY_ID.set(String(route.id), route);
  ROUTE_BY_ID.set(String(route.number), route);
}

const STOP_BY_ID = new Map();
for (const stop of ALL_STOPS) {
  STOP_BY_ID.set(String(stop.stop_id), stop);
  STOP_BY_ID.set(String(stop.stop_code), stop);
}

function jsonResponse(data, endpoint = 'ok', cacheControl = 'public, max-age=60', status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Proxy-Endpoint': endpoint,
    },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ success: false, error: message }, 'error', 'no-store', status);
}

async function proxyRawRequest(url, endpoint) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/5.0)',
    },
  });
  return response;
}

async function proxyRequest(url, endpoint, cacheControl = 'public, max-age=60') {
  const raw = await proxyRawRequest(url, endpoint);
  if (!raw.ok) {
    return errorResponse(`Erro ao obter dados de ${endpoint}`, raw.status);
  }
  const data = await raw.json();
  return jsonResponse(data, endpoint, cacheControl);
}

function normalizeColor(value, fallback = '#187EC2') {
  if (!value) return fallback;
  const v = String(value).trim();
  if (!v) return fallback;
  return v.startsWith('#') ? v : `#${v}`;
}

function normalizeRoute(route, operator) {
  return {
    id: String(route.id ?? route.route_id ?? route.number ?? route.route_short_name ?? ''),
    number: String(route.number ?? route.route_short_name ?? route.id ?? ''),
    name: String(route.name ?? route.route_long_name ?? route.long_name ?? route.number ?? ''),
    color: normalizeColor(route.color ?? route.route_color, operator === 'metrobus' ? '#D71920' : '#187EC2'),
    text_color: normalizeColor(route.text_color ?? route.route_text_color, '#FFFFFF'),
    operator,
    source: operator,
  };
}

function normalizeStopRecord(stop, operator) {
  const stopId = String(stop.stop_id ?? stop.stopid ?? stop.id ?? stop.code ?? '');
  const stopCode = String(stop.stop_code ?? stop.stopid ?? stop.code ?? stopId);
  const stopName = String(stop.stop_name ?? stop.stopname ?? stop.name ?? stopId);

  return {
    stop_id: stopId,
    stopid: stopId,
    stop_code: stopCode,
    stopcode: stopCode,
    stop_name: stopName,
    stopname: stopName,
    latitude: Number(stop.latitude ?? stop.stop_lat ?? stop.lat),
    longitude: Number(stop.longitude ?? stop.stop_lon ?? stop.lon ?? stop.lng),
    zone_id: stop.zone_id ?? null,
    operator,
    source: operator,
    routes: Array.isArray(stop.routes)
        ? stop.routes.map(r => ({
          id: String(r.id ?? r.route_id ?? r.number),
          number: String(r.number ?? r.route_short_name ?? r.id),
          name: String(r.name ?? r.route_long_name ?? r.number ?? ''),
          color: normalizeColor(r.color ?? r.route_color),
          text_color: normalizeColor(r.text_color ?? r.route_text_color, '#FFFFFF'),
          operator: r.operator ?? operator,
          source: r.source ?? operator,
        }))
        : [],
  };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeDirectionId(url) {
  return Number(url.searchParams.get('direction_id') ?? url.searchParams.get('direction') ?? '0') === 1 ? 1 : 0;
}

function getRoute(routeId) {
  return ROUTE_BY_ID.get(String(routeId)) ?? null;
}

function getStop(stopId) {
  return STOP_BY_ID.get(String(stopId)) ?? null;
}

function isMetrobusRoute(routeId) {
  const route = getRoute(routeId);
  return route?.operator === 'metrobus';
}

function isUnirRoute(routeId) {
  const route = getRoute(routeId);
  return route?.operator === 'unir';
}

function getMetrobusTrips(routeId) {
  return METROBUS_STOP_TIMES.find(r => String(r.route_id) === String(routeId))?.trips ?? [];
}

function buildMetrobusStops(routeId) {
  const trips = getMetrobusTrips(routeId);
  const unique = new Map();

  for (const trip of trips) {
    for (const stopTime of (trip.stops ?? [])) {
      const stop = getStop(stopTime.stop_id);
      if (!stop) continue;

      if (!unique.has(String(stop.stop_id))) {
        unique.set(String(stop.stop_id), {
          stop_id: stop.stop_id,
          stopid: stop.stop_id,
          stop_code: stop.stop_code,
          stopcode: stop.stop_code,
          stop_name: stop.stop_name,
          stopname: stop.stop_name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          zone_id: stop.zone_id ?? null,
          stop_sequence: Number(stopTime.stop_sequence ?? 0),
          operator: 'metrobus',
          source: 'metrobus',
        });
      }
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.stop_sequence - b.stop_sequence);
}

function buildMetrobusSchedule(routeId, stopId = null) {
  const trips = getMetrobusTrips(routeId);
  const rows = [];

  for (const trip of trips) {
    for (const stopTime of (trip.stops ?? [])) {
      if (stopId && String(stopTime.stop_id) !== String(stopId)) continue;

      rows.push({
        trip_id: String(trip.trip_id),
        stop_id: String(stopTime.stop_id),
        arrival_time: String(stopTime.arrival_time),
        departure_time: String(stopTime.departure_time),
        stop_sequence: Number(stopTime.stop_sequence ?? 0),
      });
    }
  }

  rows.sort((a, b) => {
    if (a.departure_time !== b.departure_time) return a.departure_time.localeCompare(b.departure_time);
    return a.stop_sequence - b.stop_sequence;
  });

  return rows;
}

function buildMetrobusShape(routeId, directionId) {
  const entry = Array.isArray(METROBUS_SHAPES)
      ? METROBUS_SHAPES.find(r => String(r.route_id) === String(routeId) && Number(r.direction_id ?? 0) === Number(directionId))
      : (METROBUS_SHAPES.routes ?? []).find(r => String(r.route_id) === String(routeId) && Number(r.direction_id ?? 0) === Number(directionId));

  if (!entry) {
    return [];
  }

  const points = Array.isArray(entry.coordinates) ? entry.coordinates : [];
  return points
      .map((p, idx) => ({
        lat: Number(p.lat ?? p.latitude ?? (Array.isArray(p) ? p[1] : null)),
        lng: Number(p.lng ?? p.lon ?? p.longitude ?? (Array.isArray(p) ? p[0] : null)),
        sequence: Number(p.sequence ?? idx + 1),
      }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .sort((a, b) => a.sequence - b.sequence);
}

function foldText(value) {
  return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\bavenida\b/g, 'av')
      .replace(/\bav\.\b/g, 'av')
      .replace(/\bru[a]?\b/g, 'r')
      .replace(/\br\.\b/g, 'r')
      .replace(/\bpraca\b/g, 'praca')
      .replace(/\bpraça\b/g, 'praca')
      .replace(/\bsanto\b/g, 's')
      .replace(/\bsanta\b/g, 's')
      .replace(/\bsao\b/g, 's')
      .replace(/\bs\.\b/g, 's')
      .replace(/\bsenhor\b/g, 'sr')
      .replace(/\bsenhora\b/g, 'sr')
      .replace(/\bsr\.\b/g, 'sr')
      .replace(/\bsra\.\b/g, 'sr')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

function scoreStopSearch(stop, query) {
  const q = foldText(query);
  if (!q) return 0;

  const name = foldText(stop.stop_name);
  const code = foldText(stop.stop_code);
  const operator = foldText(stop.operator);

  if (code === q) return 1000;
  if (name === q) return 900;
  if (name.startsWith(q)) return 700;
  if (name.includes(q)) return 500;
  if (`${name} ${operator}`.includes(q)) return 400;
  return 0;
}

async function handleStcpLiveVehicles() {
  const raw = await proxyRawRequest(`${STCP_API_BASE}/vehicles`, 'vehicles');
  if (!raw.ok) return errorResponse('Erro ao obter veículos STCP', raw.status);
  const data = await raw.json();
  return jsonResponse(data, 'vehicles', 'public, max-age=5');
}

async function handleUnirVehicles() {
  const raw = await proxyRawRequest('https://unir.live/api/vehicles', 'vehicles_unir');
  if (!raw.ok) return errorResponse('Erro ao obter veículos UNIR', raw.status);
  const data = await raw.json();
  const vehicles = Array.isArray(data) ? data : Array.isArray(data?.vehicles) ? data.vehicles : [];
  return jsonResponse({ success: true, vehicles, source: 'unir' }, 'vehicles_unir', 'public, max-age=5');
}

async function handleNearbyStops(lat, lng, radius) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  const nRadius = Number(radius);

  if (!Number.isFinite(nLat) || !Number.isFinite(nLng) || !Number.isFinite(nRadius)) {
    return errorResponse('Parâmetros inválidos em /nearby/{lat}/{lng}/{radius}', 400);
  }

  const stops = ALL_STOPS
      .map(stop => ({
        ...stop,
        _distance: haversineMeters(nLat, nLng, stop.latitude, stop.longitude),
      }))
      .filter(stop => stop._distance <= nRadius)
      .sort((a, b) => a._distance - b._distance)
      .map(({ _distance, ...stop }) => ({
        ...stop,
        distance: Math.round(_distance),
      }));

  return jsonResponse({ success: true, stops }, 'nearby', 'public, max-age=120');
}

async function handleRouteShape(routeId, directionId) {
  const route = getRoute(routeId);
  if (!route) return errorResponse(`Linha não encontrada: ${routeId}`, 404);

  if (route.operator === 'metrobus') {
    const coordinates = buildMetrobusShape(route.id, directionId);
    return jsonResponse({
      success: true,
      route_id: String(route.id),
      direction_id: Number(directionId),
      coordinates,
      operator: 'metrobus',
      source: 'metrobus',
    }, 'route_shape', 'public, max-age=86400');
  }

  if (route.operator === 'unir') {
    return jsonResponse({
      success: true,
      route_id: String(route.id),
      direction_id: Number(directionId),
      coordinates: [],
      operator: 'unir',
      source: 'unir',
      client_side_only: true,
    }, 'route_shape', 'public, max-age=86400');
  }

  const raw = await proxyRawRequest(
      `${STCP_API_BASE}/route/${route.id}/shape?direction_id=${directionId}`,
      'route_shape'
  );
  if (!raw.ok) return errorResponse(`Erro ao obter shape da rota ${route.id}`, raw.status);

  const d = await raw.json();
  const coords = (d.coordinates || [])
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      .map(c => ({
        lat: c.lat,
        lng: c.lng,
        sequence: c.sequence,
      }));

  return jsonResponse({
    success: true,
    route_id: String(route.id),
    direction_id: Number(directionId),
    coordinates: coords,
    operator: 'stcp',
    source: 'stcp',
  }, 'route_shape', 'public, max-age=3600');
}

async function handleRouteStops(routeId, directionId) {
  const route = getRoute(routeId);
  if (!route) return errorResponse(`Linha não encontrada: ${routeId}`, 404);

  if (route.operator === 'metrobus') {
    return jsonResponse({
      success: true,
      route_id: String(route.id),
      direction_id: Number(directionId),
      operator: 'metrobus',
      source: 'metrobus',
      stops: buildMetrobusStops(route.id),
    }, 'route_stops', 'public, max-age=86400');
  }

  if (route.operator === 'unir') {
    return errorResponse(`As paragens da rota UNIR ${routeId} devem ser servidas por recursos UNIR dedicados.`, 404);
  }

  const raw = await proxyRawRequest(
      `${STCP_API_BASE}/route/${route.id}/stops/direction?direction_id=${directionId}`,
      'route_stops'
  );
  if (!raw.ok) return errorResponse(`Erro ao obter paragens da rota ${route.id}`, raw.status);

  const d = await raw.json();
  const stops = (d.stops || [])
      .sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0))
      .map(s => ({
        stop_id: s.stop_id,
        stopid: s.stop_id,
        stop_code: s.stop_code,
        stopcode: s.stop_code,
        stop_name: s.stop_name,
        stopname: s.stop_name,
        latitude: s.stop_lat,
        longitude: s.stop_lon,
        stop_sequence: s.stop_sequence,
        zone_id: s.zone_id || null,
        operator: 'stcp',
        source: 'stcp',
      }));

  return jsonResponse({
    success: true,
    route_id: String(route.id),
    direction_id: Number(directionId),
    operator: 'stcp',
    source: 'stcp',
    stops,
  }, 'route_stops', 'public, max-age=3600');
}

async function handleRouteSchedule(routeId, url) {
  const route = getRoute(routeId);
  if (!route) return errorResponse(`Linha não encontrada: ${routeId}`, 404);

  if (route.operator === 'metrobus') {
    const stopId = url.searchParams.get('stop_id') ?? url.searchParams.get('stopId') ?? null;
    return jsonResponse({
      success: true,
      route_id: String(route.id),
      operator: 'metrobus',
      source: 'metrobus',
      stop_times: buildMetrobusSchedule(route.id, stopId),
    }, 'route_schedule', 'public, max-age=86400');
  }

  if (route.operator === 'unir') {
    return errorResponse(`Horários UNIR da rota ${routeId} devem ser resolvidos por dados locais/GTFS dedicados.`, 404);
  }

  return await proxyRequest(
      `${STCP_API_BASE}/route/${route.id}/schedule${url.search}`,
      'route_schedule',
      'public, max-age=1800'
  );
}

async function handleRoutesList() {
  return jsonResponse({
    success: true,
    source: 'static',
    routes: ALL_ROUTES,
  }, 'routes_list', 'public, max-age=86400');
}

async function handleSearch(url) {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Number(url.searchParams.get('limit') ?? '50');

  if (!q) {
    return errorResponse('Parâmetro "q" é obrigatório. Uso: /search?q={query}&limit={limit}', 400);
  }

  const stops = ALL_STOPS
      .map(stop => ({ stop, score: scoreStopSearch(stop, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.stop.stop_name.localeCompare(b.stop.stop_name))
      .slice(0, limit)
      .map(x => x.stop);

  return jsonResponse({
    success: true,
    query: q,
    stops,
  }, 'search', 'public, max-age=60');
}

async function handleStopInfo(stopId) {
  const localStop = getStop(stopId);
  if (localStop) {
    return jsonResponse({
      stop_id: localStop.stop_id,
      stopid: localStop.stopid,
      stop_name: localStop.stop_name,
      stopname: localStop.stopname,
      stop_code: localStop.stop_code,
      stopcode: localStop.stopcode,
      latitude: localStop.latitude,
      longitude: localStop.longitude,
      zone_id: localStop.zone_id || null,
      operator: localStop.operator,
      source: localStop.source,
      routes: localStop.routes || [],
    }, 'stop_info', 'public, max-age=86400');
  }

  const raw = await proxyRawRequest(`${STCP_API_BASE}/stops/${stopId}`, 'stop_info');
  if (!raw.ok) return errorResponse(`Erro ao obter informação da paragem ${stopId}`, raw.status);

  const d = await raw.json();
  return jsonResponse({
    stop_id: d.stop_id,
    stopid: d.stop_id,
    stop_name: d.stop_name,
    stopname: d.stop_name,
    stop_code: d.stop_code,
    stopcode: d.stop_code,
    latitude: d.stop_lat,
    longitude: d.stop_lon,
    zone_id: d.zone_id || null,
    operator: 'stcp',
    source: 'stcp',
    routes: (d.routes || []).map(r => ({
      id: String(r.id),
      number: String(r.number),
      name: String(r.name),
      color: normalizeColor(r.color),
      text_color: normalizeColor(r.text_color, '#FFFFFF'),
      operator: 'stcp',
      source: 'stcp',
    })),
  }, 'stop_info', 'public, max-age=1800');
}

async function handleStopRoutes(stopId) {
  const localStop = getStop(stopId);
  if (localStop) {
    return jsonResponse({
      success: true,
      stop_id: String(localStop.stop_id),
      routes: localStop.routes || [],
    }, 'stop_routes', 'public, max-age=86400');
  }

  return await proxyRequest(
      `${STCP_API_BASE}/stops/${stopId}/routes`,
      'stop_routes',
      'public, max-age=1800'
  );
}

async function handleStopRealtime(stopId, url) {
  const stop = getStop(stopId);
  if (stop && stop.operator !== 'stcp') {
    return jsonResponse({
      success: true,
      stop_id: String(stopId),
      realtime: [],
      source: stop.operator,
    }, 'realtime', 'public, max-age=30');
  }

  return await proxyRequest(
      `${STCP_API_BASE}/stops/${stopId}/realtime${url.search}`,
      'realtime',
      'public, max-age=10'
  );
}

async function handleStopSchedule(stopId, url) {
  const stop = getStop(stopId);
  if (stop && stop.operator === 'metrobus') {
    const routeId = url.searchParams.get('route_id') ?? url.searchParams.get('routeId');
    if (!routeId) {
      return errorResponse('Parâmetro "route_id" é obrigatório para paragens MetroBus.', 400);
    }

    return jsonResponse({
      success: true,
      stop_id: String(stopId),
      route_id: String(routeId),
      operator: 'metrobus',
      source: 'metrobus',
      stop_times: buildMetrobusSchedule(routeId, stopId),
    }, 'stop_schedule', 'public, max-age=86400');
  }

  return await proxyRequest(
      `${STCP_API_BASE}/stops/${stopId}/schedule${url.search}`,
      'stop_schedule',
      'public, max-age=1800'
  );
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.slice(1).split('/').filter(Boolean);

  if (pathParts.length === 0) {
    return jsonResponse({
      message: 'STCP / UNIR / MetroBus proxy',
      version: '5.0',
      endpoints: {
        vehicle_endpoints: ['vehicles', 'vehicles/unir'],
        location_endpoints: ['nearby/{lat}/{lng}/{radius}'],
        route_endpoints: ['route/{routeId}/schedule', 'route/{routeId}/shape', 'route/{routeId}/stops', 'routes/list'],
        search_endpoints: ['search?q={QUERY}&limit={LIMIT}'],
        stop_endpoints: ['{STOP_ID}/realtime', '{STOP_ID}/routes', '{STOP_ID}/schedule', '{STOP_ID}/info'],
      },
    }, 'root', 'public, max-age=300');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return errorResponse('Método não suportado', 405);
  }

  try {
    const firstSegment = pathParts[0];

    if (firstSegment === 'vehicles') {
      const mode = pathParts[1] || 'stcp';
      if (mode === 'unir') return await handleUnirVehicles();
      return await handleStcpLiveVehicles();
    }

    if (firstSegment === 'nearby') {
      if (pathParts.length < 4) {
        return errorResponse('Uso: /nearby/{LAT}/{LNG}/{RADIUS}', 400);
      }
      const [_, lat, lng, radius] = pathParts;
      return await handleNearbyStops(lat, lng, radius);
    }

    if (firstSegment === 'route') {
      const routeId = pathParts[1];
      const sub = pathParts[2];
      if (!routeId) return errorResponse('Uso: /route/{ROUTE_ID}/{schedule|shape|stops}', 400);

      const directionId = normalizeDirectionId(url);

      if (sub === 'schedule') return await handleRouteSchedule(routeId, url);
      if (sub === 'shape') return await handleRouteShape(routeId, directionId);
      if (sub === 'stops') return await handleRouteStops(routeId, directionId);

      return errorResponse(`Sub-endpoint inválido: ${sub}. Use: schedule, shape ou stops`, 400);
    }

    if (firstSegment === 'routes' && pathParts[1] === 'list') {
      return await handleRoutesList();
    }

    if (firstSegment === 'search') {
      return await handleSearch(url);
    }

    const stopId = firstSegment;
    const endpoint = pathParts[1] || 'realtime';

    if (endpoint === 'services') {
      const date = url.searchParams.get('date');
      if (!date) return errorResponse('Parâmetro "date" é obrigatório. Uso: /{stopId}/services?date=YYYY-MM-DD', 400);
      return await proxyRequest(
          `https://stcp.pt/api/stops/${stopId}/services?date=${date}`,
          'stop_services', 'public, max-age=3600'
      );
    }

    if (endpoint === 'info') return await handleStopInfo(stopId);
    if (endpoint === 'routes') return await handleStopRoutes(stopId);
    if (endpoint === 'realtime') return await handleStopRealtime(stopId, url);
    if (endpoint === 'schedule') return await handleStopSchedule(stopId, url);

    return errorResponse(`Endpoint inválido: ${endpoint}. Use: realtime, routes, schedule, info ou services`, 400);
  } catch (error) {
    console.error('[WORKER] Error:', error);
    return errorResponse(`Erro interno: ${error.message}`, 500);
  }
}

export default {
  async fetch(request) {
    return handleRequest(request);
  },
};