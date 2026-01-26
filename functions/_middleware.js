// Cloudflare Worker - CORS Proxy para STCP API
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
        usage: {
          realtime: 'https://stcp-worker.tiagoanoliveira.pt/{STOP_ID}/realtime',
          routes: 'https://stcp-worker.tiagoanoliveira.pt/{STOP_ID}/routes',
          schedule: 'https://stcp-worker.tiagoanoliveira.pt/{STOP_ID}/schedule?route_id={ROUTE}&service_id={SERVICE}'
        },
        examples: {
          realtime: 'https://stcp-worker.tiagoanoliveira.pt/PLNT1/realtime',
          routes: 'https://stcp-worker.tiagoanoliveira.pt/PLNT1/routes',
          schedule: 'https://stcp-worker.tiagoanoliveira.pt/PLNT1/schedule?route_id=200&service_id=DIAS%20UTEIS'
        }
      }),
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
        valid_endpoints: validEndpoints
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
    // Fazer pedido à API STCP
    const response = await fetch(stcpApiUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0'
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

    // Retornar com headers CORS
    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Erro ao obter dados da paragem',
        endpoint: endpoint,
        message: error.message
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

export async function onRequest(context) {
  return handleRequest(context.request);
}
