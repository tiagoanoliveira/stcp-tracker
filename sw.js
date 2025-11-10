const CACHE_NAME = 'stcp-live-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/busmap.html',
  '/stop.html',
  '/style.css',
  '/resources/favicon.svg',
  '/resources/header.js',
  '/realtime_stops/stopsData.js',
  '/realtime_stops/stopsMapApp.js',
  '/realtime_bus_map/app.js',
  '/realtime_bus_map/dataService.js',
  '/realtime_stops/stopView.js',
  '/realtime_stops/stopsService.js'
];

// Instalação com tratamento de erros
self.addEventListener('install', event => {
  event.waitUntil(
      caches.open(CACHE_NAME)
          .then(cache => {
            return cache.addAll(urlsToCache);
          })
          .then(() => self.skipWaiting())
          .catch(err => {
            console.error('Falha ao cachear recursos:', err);
          })
  );
});

// Ativação
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
          .then(() => self.clients.claim())
  );
});

// Fetch melhorado
self.addEventListener('fetch', event => {
  // Ignorar pedidos não-GET ou externos
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
      caches.match(event.request)
          .then(response => {
            if (response) {
              return response;
            }
            return fetch(event.request)
                .then(fetchResponse => {
                  // Cachear respostas válidas dinamicamente
                  if (fetchResponse && fetchResponse.status === 200) {
                    const responseToCache = fetchResponse.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, responseToCache));
                  }
                  return fetchResponse;
                });
          })
          .catch(() => {
            // Retornar página offline se for navegação
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          })
  );
});