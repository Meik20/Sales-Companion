// Service Worker - Cache & Offline Support (FIXED)
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
        console.warn('[SW] Cache failed:', err);
      });
    })
  );

  self.skipWaiting();
});

// ================= ACTIVATE =================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
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

  // ❌ Ignore Google Fonts (évite CSP + bugs)
  if (
    url.origin.includes('fonts.googleapis.com') ||
    url.origin.includes('fonts.gstatic.com')
  ) {
    return;
  }

  // ================= ROUTER =================
  if (url.origin !== self.location.origin) {
    return handleExternal(event);
  }

  if (url.pathname.startsWith('/api/')) {
    return handleAPI(event);
  }

  return handleStatic(event);
});

// ================= HANDLERS =================

// 🌍 Requêtes externes (CDN, Firebase, etc.)
function handleExternal(event) {
  event.respondWith(
    fetch(event.request).catch((err) => {
      console.warn('[SW] External failed:', event.request.url);
      return new Response('', { status: 204 });
    })
  );
}

// 🔗 API → Network First
function handleAPI(event) {
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;

          return new Response(
            JSON.stringify({
              error: 'Offline',
              message: 'Service unavailable',
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
      )
  );
}

// 📦 Static → Cache First
function handleStatic(event) {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200) return res;

          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });

          return res;
        })
        .catch(() => {
          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        });
    })
  );
}