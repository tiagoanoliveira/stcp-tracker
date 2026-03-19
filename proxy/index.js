// Cloudflare Worker - CORS Proxy para STCP API
// v4.0 - Adiciona endpoints de shape, paragens e listagem de rotas

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
        version: '4.0',
        endpoints: {
          stop_endpoints: ['realtime', 'routes', 'schedule', 'info'],
          location_endpoints: ['nearby'],
          route_endpoints: ['schedule', 'shape', 'stops', 'list'],
          search_endpoints: ['search']
        },
        usage: {
          realtime:        'GET /{STOP_ID}/realtime',
          routes:          'GET /{STOP_ID}/routes',
          stop_schedule:   'GET /{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}',
          stop_info:       'GET /{STOP_ID}/info',
          nearby:          'GET /nearby/{LAT}/{LNG}/{RADIUS}',
          route_schedule:  'GET /route/{ROUTE_ID}/schedule?service_id={SERVICE}&direction_id={DIR}',
          route_shape:     'GET /route/{ROUTE_ID}/shape?direction_id={DIR}',
          route_stops:     'GET /route/{ROUTE_ID}/stops?direction_id={DIR}',
          routes_list:     'GET /routes/list',
          search:          'GET /search?q={QUERY}&limit={LIMIT}'
        },
        examples: {
          realtime:       `${url.origin}/PLNT1/realtime`,
          stop_info:      `${url.origin}/PLNT1/info`,
          nearby:         `${url.origin}/nearby/41.152947/-8.637084/1000`,
          route_shape:    `${url.origin}/route/200/shape?direction_id=0`,
          route_stops:    `${url.origin}/route/200/stops?direction_id=0`,
          routes_list:    `${url.origin}/routes/list`,
          search:         `${url.origin}/search?q=planetario&limit=20`
        },
        cache: {
          realtime:      '10 segundos',
          routes:        '30 minutos',
          schedule:      '30 minutos',
          stop_info:     '30 minutos',
          nearby:        '5 minutos',
          search:        '5 minutos',
          route_shape:   '1 hora',
          route_stops:   '1 hora',
          routes_list:   '1 hora'
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

      // --- 2a. Schedule: /route/{id}/schedule?service_id=...&direction_id=...
      if (sub === 'schedule') {
        return await proxyRequest(
          `https://stcp.pt/api/route/${routeId}/schedule${url.search}`,
          'route_schedule', 'public, max-age=1800'
        );
      }

      // --- 2b. Shape: /route/{id}/shape?direction_id={0|1}
      if (sub === 'shape') {
        const directionId = url.searchParams.get('direction_id') ?? '0';
        const raw = await proxyRawRequest(
          `https://stcp.pt/api/route/${routeId}/shape?direction_id=${directionId}`,
          'route_shape'
        );
        if (!raw.ok) return errorResponse(`Erro ao obter shape da rota ${routeId}`, raw.status);

        const d = await raw.json();
        // Normalizar: garantir campo coordinates ordenado por sequence
        const coords = (d.coordinates || [])
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
          .map(c => ({ lat: c.lat, lng: c.lng, sequence: c.sequence }));

        return new Response(JSON.stringify({
          success: true,
          route_id: String(routeId),
          direction_id: Number(directionId),
          coordinates: coords
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // 1 hora
            'X-Proxy-Version': '4.0',
            'X-Endpoint': 'route_shape'
          }
        });
      }

      // --- 2c. Stops da rota: /route/{id}/stops?direction_id={0|1}
      if (sub === 'stops') {
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

        return new Response(JSON.stringify({
          success: true,
          route_id: String(routeId),
          direction_id: Number(directionId),
          stops
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600', // 1 hora
            'X-Proxy-Version': '4.0',
            'X-Endpoint': 'route_stops'
          }
        });
      }

      return errorResponse(`Sub-endpoint inválido: ${sub}. Use: schedule, shape ou stops`, 400);
    }

    // -----------------------------------------------------------------------
    // 3. Routes list: /routes/list
    //    Devolve todas as linhas STCP com id, number, name, color, text_color.
    //    A STCP não tem endpoint de listagem directo; usamos a paragem BLRB1
    //    (Bolhão, passam quase todas as linhas) como seed e complementamos com
    //    um conjunto fixo de IDs conhecidos para garantir cobertura total.
    //    Cache de 1 hora - dados muito estáticos.
    // -----------------------------------------------------------------------
    if (firstSegment === 'routes' && pathParts[1] === 'list') {
      // Tentar obter lista via endpoint de linhas da STCP
      const raw = await proxyRawRequest('https://stcp.pt/api/routes', 'routes_list');

      if (raw.ok) {
        const d = await raw.json();
        const routes = (d.routes || d || []).map(r => ({
          id:         r.id || r.route_id,
          number:     r.number || r.route_short_name,
          name:       r.name   || r.route_long_name,
          color:      r.color  || r.route_color      || '#187EC2',
          text_color: r.text_color || r.route_text_color || '#FFFFFF'
        })).filter(r => r.id && r.number);

        if (routes.length > 0) {
          return new Response(JSON.stringify({ success: true, routes }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
              'X-Proxy-Version': '4.0',
              'X-Endpoint': 'routes_list'
            }
          });
        }
      }

      // Fallback: recolher rotas de várias paragens bem servidas em paralelo
      const seedStops = ['BLRB1', 'PLNT2', 'ALDD1', 'CRMP2', 'MTSN1'];
      const results = await Promise.allSettled(
        seedStops.map(s => proxyRawRequest(`https://stcp.pt/api/stops/${s}`, 'stop_seed').then(r => r.ok ? r.json() : null))
      );

      const routeMap = new Map();
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.routes) {
          r.value.routes.forEach(route => {
            if (!routeMap.has(route.id)) {
              routeMap.set(route.id, {
                id:         route.id,
                number:     route.number,
                name:       route.name,
                color:      route.color      || '#187EC2',
                text_color: route.text_color || '#FFFFFF'
              });
            }
          });
        }
      });

      const routes = Array.from(routeMap.values())
        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

      return new Response(JSON.stringify({ success: true, routes, source: 'seed_stops' }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          'X-Proxy-Version': '4.0',
          'X-Endpoint': 'routes_list'
        }
      });
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

      return new Response(JSON.stringify({ stops }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Proxy-Version': '4.0',
          'X-Endpoint': 'search'
        }
      });
    }

    // -----------------------------------------------------------------------
    // 5. Stop endpoints: /{stopId}/{endpoint}
    // -----------------------------------------------------------------------
    const stopId  = firstSegment;
    const endpoint = pathParts[1] || 'realtime';

    if (endpoint === 'info') {
      const rawResponse = await proxyRawRequest(`https://stcp.pt/api/stops/${stopId}`, 'stop_info');
      if (!rawResponse.ok)
        return errorResponse(`Erro ao obter informação da paragem ${stopId}`, rawResponse.status);

      const d = await rawResponse.json();
      const data = {
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
      };

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800',
          'X-Proxy-Version': '4.0',
          'X-Endpoint': 'stop_info'
        }
      });
    }

    const validStopEndpoints = ['realtime', 'routes', 'schedule'];
    if (!validStopEndpoints.includes(endpoint))
      return errorResponse(`Endpoint inválido: ${endpoint}. Use: ${validStopEndpoints.join(', ')} ou info`, 400);

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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.0)', 'Accept': 'application/json' },
  });
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Proxy-Version': '4.0',
      'X-Endpoint': endpoint
    }
  });
}

async function proxyRawRequest(stcpApiUrl, endpoint) {
  console.log(`[${endpoint.toUpperCase()}] Fetching (raw): ${stcpApiUrl}`);
  return await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.0)', 'Accept': 'application/json' },
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
