// Cloudflare Worker - CORS Proxy para STCP API
// v4.1 - Lista estática de linhas STCP (cores oficiais)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------------------------------------------------------------------------
// Lista completa de linhas STCP com cores oficiais.
// Mantida aqui porque a STCP não expõe endpoint de listagem fiável.
// Actualizar manualmente quando novas linhas forem criadas.
// ---------------------------------------------------------------------------
const STCP_ROUTES = [
  { id: '1M',   number: '1M',  name: 'Aliados - Matosinhos',  color: '#E4002B', text_color: '#FFFFFF' },
  { id: '200',  number: '200', name: 'Bolhão - Castelo do Queijo',                   color: '#0072C6', text_color: '#FFFFFF' },
  { id: '201',  number: '201', name: 'Campo Alegre - Nau Vitória',             color: '#0072C6', text_color: '#FFFFFF' },
  { id: '202',  number: '202', name: 'Cordoaria - Matosinhos',                 color: '#0072C6', text_color: '#FFFFFF' },
  { id: '203',  number: '203', name: 'Matosinhos - Custóias',                  color: '#0072C6', text_color: '#FFFFFF' },
  { id: '204',  number: '204', name: 'Praça Parada Leitão - Leça da Palmeira', color: '#0072C6', text_color: '#FFFFFF' },
  { id: '205',  number: '205', name: 'Marquês - Boa Nova',                     color: '#0072C6', text_color: '#FFFFFF' },
  { id: '206',  number: '206', name: 'Praça Parada Leitão - Moselos',          color: '#0072C6', text_color: '#FFFFFF' },
  { id: '207',  number: '207', name: 'Marquês - Maia (Câmara Municipal)',      color: '#0072C6', text_color: '#FFFFFF' },
  { id: '208',  number: '208', name: 'Cordoaria - Maia (Câmara Municipal)',    color: '#0072C6', text_color: '#FFFFFF' },
  { id: '209',  number: '209', name: 'Campo Alegre - Maia (Hospital)',         color: '#0072C6', text_color: '#FFFFFF' },
  { id: '301',  number: '301', name: 'Aliados - Gondomar (S. Cosme)',          color: '#E4002B', text_color: '#FFFFFF' },
  { id: '302',  number: '302', name: 'Aliados - Valbom',                       color: '#E4002B', text_color: '#FFFFFF' },
  { id: '303',  number: '303', name: 'Cordoaria - Venda Nova',                 color: '#E4002B', text_color: '#FFFFFF' },
  { id: '304',  number: '304', name: 'Aliados - Fânzeres',                     color: '#E4002B', text_color: '#FFFFFF' },
  { id: '305',  number: '305', name: 'Aliados - Rio Tinto (Estação)',          color: '#E4002B', text_color: '#FFFFFF' },
  { id: '400',  number: '400', name: 'Batalha - Paranhos',                     color: '#009A44', text_color: '#FFFFFF' },
  { id: '401',  number: '401', name: 'Batalha - Paranhos (circular)',          color: '#009A44', text_color: '#FFFFFF' },
  { id: '402',  number: '402', name: 'Trindade - Paranhos',                    color: '#009A44', text_color: '#FFFFFF' },
  { id: '403',  number: '403', name: 'Trindade - S. Roque da Lameira',        color: '#009A44', text_color: '#FFFFFF' },
  { id: '404',  number: '404', name: 'Maternidade - Nau Vitória',             color: '#009A44', text_color: '#FFFFFF' },
  { id: '500',  number: '500', name: 'Cordoaria - Foz (circular)',             color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '501',  number: '501', name: 'Cordoaria - Castelo do Queijo',         color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '502',  number: '502', name: 'Cordoaria - Foz (via Boavista)',         color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '503',  number: '503', name: 'Cordoaria - Nevogilde',                  color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '504',  number: '504', name: 'Cordoaria - Matosinhos (via Foz)',      color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '505',  number: '505', name: 'Bolhão - Foz',                           color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '506',  number: '506', name: 'Trindade - S. João de Deus',            color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '507',  number: '507', name: 'Trindade - Francos',                     color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '508',  number: '508', name: 'Trindade - Aldoar',                      color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '509',  number: '509', name: 'Marquês - Matosinhos (via Foz)',        color: '#7D3C98', text_color: '#FFFFFF' },
  { id: '600',  number: '600', name: 'São Bento - Pedrouços',                  color: '#F5A623', text_color: '#000000' },
  { id: '601',  number: '601', name: 'Campanhã - Pedrouços',                   color: '#F5A623', text_color: '#000000' },
  { id: '602',  number: '602', name: 'Campanhã - Aeroporto',                   color: '#F5A623', text_color: '#000000' },
  { id: '700',  number: '700', name: 'Campanhã - Maia (Câmara Municipal)',    color: '#00B5AD', text_color: '#FFFFFF' },
  { id: '701',  number: '701', name: 'Campanhã - Ermesinde',                   color: '#00B5AD', text_color: '#FFFFFF' },
  { id: '702',  number: '702', name: 'Campanhã - Alfena',                      color: '#00B5AD', text_color: '#FFFFFF' },
  { id: '703',  number: '703', name: 'Campanhã - Valongo',                     color: '#00B5AD', text_color: '#FFFFFF' },
  { id: '800',  number: '800', name: 'Aliados - Oliveira do Douro',           color: '#8B4513', text_color: '#FFFFFF' },
  { id: '801',  number: '801', name: 'Aliados - Avintes',                      color: '#8B4513', text_color: '#FFFFFF' },
  { id: '802',  number: '802', name: 'Aliados - Pedroso',                      color: '#8B4513', text_color: '#FFFFFF' },
  { id: '803',  number: '803', name: 'Aliados - Sandim',                       color: '#8B4513', text_color: '#FFFFFF' },
  { id: '804',  number: '804', name: 'Aliados - Serzedo',                      color: '#8B4513', text_color: '#FFFFFF' },
  { id: '900',  number: '900', name: 'Hospital S. João - Gondomar',           color: '#2E86AB', text_color: '#FFFFFF' },
  { id: '901',  number: '901', name: 'Hospital S. João - Fânzeres (circular)', color: '#2E86AB', text_color: '#FFFFFF' },
  { id: '902',  number: '902', name: 'Trindade - Baguim',                      color: '#2E86AB', text_color: '#FFFFFF' },
  { id: '903',  number: '903', name: 'Trindade - Campanhã (circular)',        color: '#2E86AB', text_color: '#FFFFFF' },
];

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.slice(1).split('/').filter(p => p);

  if (pathParts.length === 0) {
    return new Response(
      JSON.stringify({
        message: 'STCP CORS Proxy',
        version: '4.1',
        endpoints: {
          stop_endpoints:     ['realtime', 'routes', 'schedule', 'info'],
          location_endpoints: ['nearby'],
          route_endpoints:    ['schedule', 'shape', 'stops', 'list'],
          search_endpoints:   ['search']
        },
        usage: {
          realtime:       'GET /{STOP_ID}/realtime',
          routes:         'GET /{STOP_ID}/routes',
          stop_schedule:  'GET /{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}',
          stop_info:      'GET /{STOP_ID}/info',
          nearby:         'GET /nearby/{LAT}/{LNG}/{RADIUS}',
          route_schedule: 'GET /route/{ROUTE_ID}/schedule?service_id={SERVICE}&direction_id={DIR}',
          route_shape:    'GET /route/{ROUTE_ID}/shape?direction_id={DIR}',
          route_stops:    'GET /route/{ROUTE_ID}/stops?direction_id={DIR}',
          routes_list:    'GET /routes/list',
          search:         'GET /search?q={QUERY}&limit={LIMIT}'
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

      // --- 2a. Schedule
      if (sub === 'schedule') {
        return await proxyRequest(
          `https://stcp.pt/api/route/${routeId}/schedule${url.search}`,
          'route_schedule', 'public, max-age=1800'
        );
      }

      // --- 2b. Shape
      if (sub === 'shape') {
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
            'Cache-Control': 'public, max-age=3600',
            'X-Proxy-Version': '4.1',
            'X-Endpoint': 'route_shape'
          }
        });
      }

      // --- 2c. Stops da rota
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
            'Cache-Control': 'public, max-age=3600',
            'X-Proxy-Version': '4.1',
            'X-Endpoint': 'route_stops'
          }
        });
      }

      return errorResponse(`Sub-endpoint inválido: ${sub}. Use: schedule, shape ou stops`, 400);
    }

    // -----------------------------------------------------------------------
    // 3. Routes list: /routes/list  →  lista estática, sem chamada externa
    // -----------------------------------------------------------------------
    if (firstSegment === 'routes' && pathParts[1] === 'list') {
      return new Response(
        JSON.stringify({ success: true, routes: STCP_ROUTES, source: 'static' }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=86400', // 24h - dados estáticos
            'X-Proxy-Version': '4.1',
            'X-Endpoint': 'routes_list'
          }
        }
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
      return new Response(JSON.stringify({ stops }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Proxy-Version': '4.1',
          'X-Endpoint': 'search'
        }
      });
    }

    // -----------------------------------------------------------------------
    // 5. Stop endpoints: /{stopId}/{endpoint}
    // -----------------------------------------------------------------------
    const stopId   = firstSegment;
    const endpoint = pathParts[1] || 'realtime';

    if (endpoint === 'info') {
      const rawResponse = await proxyRawRequest(`https://stcp.pt/api/stops/${stopId}`, 'stop_info');
      if (!rawResponse.ok)
        return errorResponse(`Erro ao obter informação da paragem ${stopId}`, rawResponse.status);
      const d = await rawResponse.json();
      return new Response(JSON.stringify({
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
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800',
          'X-Proxy-Version': '4.1',
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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.1)', 'Accept': 'application/json' },
  });
  const data = await response.text();
  return new Response(data, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'X-Proxy-Version': '4.1',
      'X-Endpoint': endpoint
    }
  });
}

async function proxyRawRequest(stcpApiUrl, endpoint) {
  console.log(`[${endpoint.toUpperCase()}] Fetching (raw): ${stcpApiUrl}`);
  return await fetch(stcpApiUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/4.1)', 'Accept': 'application/json' },
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
