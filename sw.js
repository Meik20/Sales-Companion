// Service Worker - Cache & Offline Support (FIXED v3)
const CACHE_NAME = 'sales-companion-v3';

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

  // ❌ LAISSER PASSER SANS INTERCEPTION
  // Fonts Google — évite CSP + TypeError Response
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    // ⚠️ NE PAS appeler event.respondWith() — laisse le browser gérer
    return;
  }

  // ❌ Firebase — laisser passer
  if (
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  // ❌ Railway API server — laisser passer (géré par handleAPI)
  if (url.hostname.includes('railway.app') && !url.pathname.startsWith('/api/')) {
    return;
  }

  // ================= ROUTER =================

  // Requêtes externes (autres CDN)
  if (url.origin !== self.location.origin) {
    return handleExternal(event);
  }

  // API → Network First
  if (url.pathname.startsWith('/api/')) {
    return handleAPI(event);
  }

  // Static → Cache First
  return handleStatic(event);
});

// ================= SAFE FETCH =================
function fetchSafe(request) {
  try {
    return fetch(request).catch((err) => {
      console.warn('[SW] fetchSafe error:', err && err.message);
      return new Response('', {
        status: 408,
        statusText: 'Network error'
      });
    });
  } catch (e) {
    return Promise.resolve(new Response('', {
      status: 408,
      statusText: 'Network error'
    }));
  }
}

// ================= HANDLERS =================

// 🌍 Externes — fetch direct, pas de cache
function handleExternal(event) {
  event.respondWith(
    fetchSafe(event.request).then((response) => {
      // Ne pas considérer les réponses opaques comme des échecs :
      // les ressources cross-origin (ex: Google Fonts) peuvent être de type 'opaque'
      if (!response || response.status !== 200) {
        return response;
      }
      return response;
    })
  );
}

// 🔗 API → Network First, cache fallback
function handleAPI(event) {
  event.respondWith(
    fetchSafe(event.request)
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

// 📦 Static → Cache First, network fallback
function handleStatic(event) {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Revalider en arrière-plan (stale-while-revalidate)
        fetchSafe(event.request).then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, res);
            });
          }
        });
        return cached;
      }

      return fetchSafe(event.request).then((res) => {
        if (!res || res.status !== 200) return res;

        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });

        return res;
      }).catch(() => {
        // Fallback: page offline si disponible
        return caches.match('/mobile') ||
               caches.match('/') ||
               new Response(
                 '<h1 style="font-family:sans-serif;padding:20px">Hors ligne</h1>',
                 {
                   status: 200,
                   headers: { 'Content-Type': 'text/html' }
                 }
               );
      });
    })
  );
}