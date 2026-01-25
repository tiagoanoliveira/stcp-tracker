const CACHE_NAME = 'stcp-live-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/busmap.html',
  '/stop.html',
  '/style.css',
  '/resources/favicon.svg',
  '/resources/header.js'
];

// Instalação
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  event.waitUntil(
      caches.open(CACHE_NAME)
          .then(cache => {
            console.log('Cache aberto');
            return cache.addAll(urlsToCache);
          })
          .then(() => self.skipWaiting())
          .catch(err => console.error('Erro ao cachear:', err))
  );
});

// Ativação
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
      caches.keys()
          .then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                  if (cacheName !== CACHE_NAME) {
                    console.log('Deletando cache antiga:', cacheName);
                    return caches.delete(cacheName);
                  }
                })
            );
          })
          .then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar schemes não suportados
  if (!['http:', 'https:'].includes(url.protocol)) {
    return; // Ignorar chrome-extension:, blob:, data:, etc
  }

  // Ignorar navegações
  if (request.mode === 'navigate') {
    return;
  }

  // Só cachear GET requests
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
      caches.match(request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }

            return fetch(request)
                .then(response => {
                  // Cachear apenas respostas válidas
                  if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, responseToCache))
                        .catch(err => console.error('Erro ao cachear resposta:', err));
                  }
                  return response;
                })
                .catch(err => {
                  console.error('Fetch falhou:', err);
                  return caches.match(request);
                });
          })
  );
});
