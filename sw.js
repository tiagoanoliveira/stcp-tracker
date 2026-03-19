/**
 * Service Worker - STCP Live Tracker
 * Cache estratégico para funcionamento offline
 */

const CACHE_NAME = 'stcp-live-v6.4';

// Ficheiros essenciais para cachear
const urlsToCache = [
  // Páginas principais
  '/',
  '/index.html',
  '/stopsmap.html',
  
  // Recursos estáticos
  '/resources/favicon.svg',
  '/resources/header.js',
  '/manifest.json',
  
  // Core services
  '/src/core/apiService.js',
  '/src/core/geolocationService.js',
  
  // Services
  '/src/services/stopService.js',
  '/src/services/vehicleService.js',
  
  // Map modules
  '/src/map/MapManager.js',
  '/src/map/markers/BusMarkerManager.js',
  '/src/map/markers/StopMarkerManager.js',
  '/src/map/controls/CenterControl.js',
  '/src/map/controls/BusMapControl.js',
  
  // UI components
  '/src/ui/components/NextArrivals.js',
  '/src/ui/design/iconCache.js',
  
  // Pages (aplicações principais)
  '/src/pages/BusMapApp.js',
  '/src/pages/StopsMapApp.js',
  
  // Styles
  '/src/ui/styles/base.css',
  '/src/ui/styles/busMap.css',
  '/src/ui/styles/stopDetail.css'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('❌ Erro ao cachear ficheiros:', err);
      })
  );
});

// Ativação - Limpar caches antigas
self.addEventListener('activate', event => {

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Fetch - Estratégia: Cache First, depois Network
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar schemes não suportados
  if (!['http:', 'https:'].includes(url.protocol)) {
    return;
  }

  // Só cachear GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Não cachear chamadas à API (sempre buscar dados frescos)
  if (url.hostname === 'broker.fiware.urbanplatform.portodigital.pt' || 
      url.pathname.includes('/api/') ||
      url.pathname.includes('gtfs.portodigital.pt')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Sem ligação à Internet' }),
            { 
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        })
    );
    return;
  }

  // Estratégia Cache First para recursos estáticos
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        // Se existir em cache, retornar imediatamente
        if (cachedResponse) {
          // Atualizar cache em background (stale-while-revalidate)
          fetch(request)
            .then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(request, response.clone()))
                  .catch(err => console.warn('⚠ Erro ao atualizar cache:', err));
              }
            })
            .catch(() => {});
          
          return cachedResponse;
        }

        // Se não existir em cache, buscar da rede
        return fetch(request)
          .then(response => {
            // Cachear apenas respostas válidas
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(request, responseToCache))
                .catch(err => console.warn('⚠ Erro ao cachear resposta:', err));
            }
            return response;
          })
          .catch(err => {
            console.error('❌ Fetch falhou:', err);
            // Tentar retornar da cache como fallback
            return caches.match(request);
          });
      })
  );
});

// Mensagens do cliente
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
