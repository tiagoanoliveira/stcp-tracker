const CACHE_NAME = 'stcp-live-v2';
const urlsToCache = [
  '/',
  'index.html',
  'busmap.html',
  'stop.html',
  'style.css',
  './resources/favicon.svg',
  './resources/header.js',
  './realtime_stops/stopsData.js',
  './realtime_stops/stopsMapApp.js',
    './realtime_bus_map/app.js',
    './realtime_bus_map/dataService.js',
    './realtime_stops/stopView.js',
    './realtime_stops/stopsService.js'
];

// Instalação - cachear recursos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Ativação - limpar caches antigas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch - servir do cache quando offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
