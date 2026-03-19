// Cloudflare Worker - CORS Proxy para STCP API
// ES Module syntax (moderna)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.slice(1).split('/').filter(p => p);

  if (pathParts.length === 0) {
    return new Response(
      JSON.stringify({
        message: 'STCP CORS Proxy',
        version: '3.2',
        endpoints: {
          stop_endpoints: ['realtime', 'routes', 'schedule', 'info'],
          location_endpoints: ['nearby'],
          route_endpoints: ['schedule'],
          search_endpoints: ['search']
        },
        usage: {
          realtime: 'GET /{STOP_ID}/realtime',
          routes: 'GET /{STOP_ID}/routes',
          stop_schedule: 'GET /{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}',
          stop_info: 'GET /{STOP_ID}/info',
          nearby: 'GET /nearby/{LAT}/{LNG}/{RADIUS}',
          route_schedule: 'GET /route/{ROUTE_ID}/schedule?service_id={SERVICE}&direction_id={DIR}',
          search: 'GET /search?q={QUERY}&limit={LIMIT}'
        },
        examples: {
          realtime: `${url.origin}/PLNT1/realtime`,
          routes: `${url.origin}/PLNT1/routes`,
          stop_info: `${url.origin}/PLNT1/info`,
          stop_schedule: `${url.origin}/PLNT1/schedule?route_id=200&service_id=DIAS%20UTEIS`,
          nearby: `${url.origin}/nearby/41.152947/-8.637084/1000`,
          route_schedule: `${url.origin}/route/200/schedule?service_id=DIAS%20UTEIS&direction_id=0`,
          search: `${url.origin}/search?q=planetario&limit=20`
        },
        cache: {
          realtime: '10 segundos',
          routes: '30 minutos',
          schedule: '30 minutos',
          stop_info: '30 minutos',
          nearby: '5 minutos',
          search: '5 minutos'
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

    // 1. Nearby stops: /nearby/{lat}/{lng}/{radius}
    if (firstSegment === 'nearby') {
      if (pathParts.length < 4) return errorResponse('Uso: /nearby/{LAT}/{LNG}/{RADIUS}', 400);
      const [_, lat, lng, radius] = pathParts;
      return await proxyRequest(
        `https://stcp.pt/api/stops/nearby?lat=${lat}&lng=${lng}&radius=${radius}`,
        'nearby', 'public, max-age=300'
      );
    }

    // 2. Route schedule: /route/{routeId}/schedule
    if (firstSegment === 'route') {
      if (pathParts.length < 3 || pathParts[2] !== 'schedule')
        return errorResponse('Uso: /route/{ROUTE_ID}/schedule?service_id={SERVICE}&direction_id={DIR}', 400);
      return await proxyRequest(
        `https://stcp.pt/api/route/${pathParts[1]}/schedule${url.search}`,
        'route_schedule', 'public, max-age=1800'
      );
    }

    // 3. Search stops: /search?q={query}&limit={limit}
    if (firstSegment === 'search') {
      const q = url.searchParams.get('q');
      const limit = url.searchParams.get('limit') || '100';
      if (!q || q.trim().length === 0)
        return errorResponse('Par\u00e2metro "q" \u00e9 obrigat\u00f3rio. Uso: /search?q={query}&limit={limit}', 400);

      const rawResponse = await proxyRawRequest(
        `https://stcp.pt/api/stops/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
        'search'
      );
      if (!rawResponse.ok) return errorResponse('Erro ao pesquisar paragens na API STCP', rawResponse.status);

      const rawData = await rawResponse.json();
      const stops = (rawData.stops || []).map(s => ({
        stop_id: s.code || s.id,
        stop_code: s.code || s.id,
        stop_name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        zone_id: s.zone_id || null,
        routes: (s.routes || []).map(r => ({ id: r.id, number: r.number, name: r.name }))
      }));

      return new Response(JSON.stringify({ stops }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Proxy-Version': '3.2',
          'X-Endpoint': 'search'
        }
      });
    }

    // 4. Stop endpoints: /{stopId}/{endpoint}
    const stopId = firstSegment;
    const endpoint = pathParts[1] || 'realtime';

    // ⭐ NOVO: /{stopId}/info — info completa da paragem incluindo linhas com cores
    if (endpoint === 'info') {
      const rawResponse = await proxyRawRequest(
        `https://stcp.pt/api/stops/${stopId}`,
        'stop_info'
      );
      if (!rawResponse.ok)
        return errorResponse(`Erro ao obter informa\u00e7\u00e3o da paragem ${stopId}`, rawResponse.status);

      const d = await rawResponse.json();
      const data = {
        stop_id: d.stop_id,
        stop_name: d.stop_name,
        stop_code: d.stop_code,
        latitude: d.stop_lat,
        longitude: d.stop_lon,
        zone_id: d.zone_id || null,
        routes: (d.routes || []).map(r => ({
          id: r.id,
          number: r.number,
          name: r.name,
          color: r.color,
          text_color: r.text_color
        }))
      };

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800', // 30 min
          'X-Proxy-Version': '3.2',
          'X-Endpoint': 'stop_info'
        }
      });
    }

    const validStopEndpoints = ['realtime', 'routes', 'schedule'];
    if (!validStopEndpoints.includes(endpoint))
      return errorResponse(`Endpoint inv\u00e1lido: ${endpoint}. Use: ${validStopEndpoints.join(', ')} ou info`, 400);

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

async function proxyRequest(stcpApiUrl, endpoint, cacheControl) {
  console.log(`[${endpoint.toUpperCase()}] Fetching: ${stcpApiUrl}`);
  const response = await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/3.2)', 'Accept': 'application/json' },
  });
  const data = await response.text();
  console.log(`[${endpoint.toUpperCase()}] Status: ${response.status}`);
  return new Response(data, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Proxy-Version': '3.2',
      'X-Endpoint': endpoint
    }
  });
}

async function proxyRawRequest(stcpApiUrl, endpoint) {
  console.log(`[${endpoint.toUpperCase()}] Fetching (raw): ${stcpApiUrl}`);
  return await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/3.2)', 'Accept': 'application/json' },
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
