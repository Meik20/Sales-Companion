// Service Worker - Cache & Offline Support (CORRIGÉ)
const CACHE_NAME = 'sales-companion-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ================= INSTALL =================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');

      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
        return Promise.resolve(); // ne casse pas l'installation
      });
    })
  );

  self.skipWaiting();
});

// ================= ACTIVATE =================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// ================= FETCH =================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // ❌ Ignore non-GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ================= EXTERNAL REQUESTS =================
  // (Google Fonts, Firebase CDN, etc.)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).catch((err) => {
        console.warn('[SW] External fetch failed:', req.url, err);

        // Toujours retourner une réponse valide
        return new Response('', { status: 204 });
      })
    );
    return;
  }

  // ================= API REQUESTS =================
  const isApi = url.pathname.startsWith('/api/');

  if (isApi) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, clone);
            });
          }

          return res;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;

            console.warn('[SW] API offline:', req.url);

            return new Response(
              JSON.stringify({ error: 'Offline', message: 'Service unavailable' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          });
        })
    );

    return;
  }

  // ================= STATIC FILES =================
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          if (!res || res.status !== 200 || res.type === 'error') {
            return res;
          }

          const clone = res.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, clone);
          });

          return res;
        })
        .catch(() => {
          console.warn('[SW] Offline static fallback:', req.url);

          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        });
    })
  );
});