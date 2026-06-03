const CACHE_NAME = 'ujeebn-tickets-v' + Date.now();
const urlsToCache = [
  '.',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'libs/qrcode.js',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Bebas+Neue&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  // Force l'activation immédiate sans attendre la fermeture des onglets
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    }).then(() => self.clients.claim()) // Prend le contrôle immédiatement
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});