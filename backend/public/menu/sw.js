// Service Worker - Offline-first menu caching
const CACHE_NAME = 'hotel-menu-v3';
const MENU_API = '/api/public/menu';

// Assets to cache on install
const STATIC_ASSETS = [
  '/menu/',
  '/menu/index.html',
  '/menu/app.js',
  '/menu/style.css',
  '/menu/manifest.json',
];

// Install: cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === MENU_API) {
    // Network-first for menu data, fallback to cache
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and update cache with fresh data
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
            console.log('[SW] Menu data updated in cache');
          });
          return response;
        })
        .catch(() => {
          console.log('[SW] Offline - serving menu from cache');
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // Return empty menu structure if nothing cached
            return new Response(
              JSON.stringify({
                hotel: { name: 'Menu', currency: '₹' },
                categories: [],
                products: [],
                offline: true,
              }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
  } else {
    // Cache-first for static assets
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request);
      })
    );
  }
});

// Listen for messages to force refresh menu cache
self.addEventListener('message', (event) => {
  if (event.data === 'REFRESH_MENU') {
    caches.open(CACHE_NAME).then((cache) => {
      fetch(MENU_API)
        .then((res) => cache.put(MENU_API, res))
        .then(() => {
          self.clients.matchAll().then((clients) => {
            clients.forEach((client) =>
              client.postMessage('MENU_REFRESHED')
            );
          });
        });
    });
  }
});
