// Cloudflare Worker - CORS Proxy para STCP API
// ES Module syntax (moderna)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Parse do pathname: /{stopId}/{endpoint}?queryparams
  const pathParts = url.pathname.slice(1).split('/').filter(p => p);
  
  // Se não houver stop_id, retorna instruções
  if (pathParts.length === 0) {
    return new Response(
      JSON.stringify({
        message: 'STCP CORS Proxy',
        version: '2.0',
        endpoints: ['realtime', 'routes', 'schedule'],
        usage: {
          realtime: 'GET /{STOP_ID}/realtime',
          routes: 'GET /{STOP_ID}/routes',
          schedule: 'GET /{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}'
        },
        examples: {
          realtime: `${url.origin}/PLNT1/realtime`,
          routes: `${url.origin}/PLNT1/routes`,
          schedule: `${url.origin}/PLNT1/schedule?route_id=200&service_id=DIAS%20UTEIS`
        },
        cache: {
          realtime: '10 segundos',
          routes: '30 minutos',
          schedule: '30 minutos'
        }
      }, null, 2),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }

  const stopId = pathParts[0];
  const endpoint = pathParts[1] || 'realtime'; // Default para realtime se não especificado

  // Validar endpoint
  const validEndpoints = ['realtime', 'routes', 'schedule'];
  if (!validEndpoints.includes(endpoint)) {
    return new Response(
      JSON.stringify({
        error: 'Endpoint inválido',
        received: endpoint,
        valid_endpoints: validEndpoints,
        usage: `Use: /{STOP_ID}/{ENDPOINT}`
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }

  // Construir URL da API STCP
  let stcpApiUrl = `https://stcp.pt/api/stops/${stopId}/${endpoint}`;
  
  // Adicionar query params se existirem
  if (url.search) {
    stcpApiUrl += url.search;
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  try {
    console.log(`[${endpoint.toUpperCase()}] Fetching: ${stcpApiUrl}`);
    
    // Fazer pedido à API STCP
    const response = await fetch(stcpApiUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; STCP-Tracker/2.0)',
        'Accept': 'application/json'
      },
    });

    // Obter os dados
    const data = await response.text();

    // Cache baseado no endpoint
    let cacheControl = 'public, max-age=10'; // Realtime: 10 segundos
    if (endpoint === 'routes') {
      cacheControl = 'public, max-age=1800'; // Routes: 30 minutos
    } else if (endpoint === 'schedule') {
      cacheControl = 'public, max-age=1800'; // Schedule: 30 minutos
    }

    console.log(`[${endpoint.toUpperCase()}] Success: ${response.status}`);

    // Retornar com headers CORS
    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
        'X-Proxy-Version': '2.0',
        'X-Endpoint': endpoint
      }
    });
  } catch (error) {
    console.error(`[${endpoint.toUpperCase()}] Error:`, error.message);
    
    return new Response(
      JSON.stringify({
        error: 'Erro ao obter dados da paragem',
        stop_id: stopId,
        endpoint: endpoint,
        message: error.message,
        url: stcpApiUrl
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

// ES Module export (sintaxe moderna requerida pela Cloudflare)
export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request);
  }
};
