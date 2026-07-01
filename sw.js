// SubWatt service worker
// Bump CACHE_NAME whenever shipped assets change so clients pick them up.
// SubWatt v2 — rates now live in Supabase, not data.json.
// data.json is kept in the repo only as an offline last-resort fallback.
const CACHE_NAME = 'subwatt-v49';
const TILE_CACHE = 'subwatt-tiles-v1';
const MAX_TILES  = 500;

// Precache only same-origin assets. Cross-origin CDN assets (leaflet, supabase,
// google fonts) are served from the catch-all handler — caching opaque/CORS
// responses in the SW has historically caused "Unexpected token '<'" errors
// when stale entries get served back as empty bodies.
const PRECACHE_URLS = [
  'index.html',
  'admin.html',
  'manifest.json',
  'data.json',
  'SmoothWheelZoom.js?v=1',
  'favicon.svg?v=4',
  'icons/icon-192-v3.png',
  'icons/icon-512-v3.png',
];

function isSupabaseRequest(url){
  return url.hostname.endsWith('.supabase.co');
}

function isMapboxApi(url){
  return url.hostname === 'api.mapbox.com';
}

function isNetworkFirst(url){
  return url.pathname.endsWith('/data.json');
}

function isOsmTile(url){
  return /^https:\/\/([a-z0-9-]+\.)?tile\.openstreetmap\.org\//.test(url);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Wipe ALL old caches up-front so a buggy prior install can't keep
    // serving stale opaque cross-origin responses.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE).map((k) => caches.delete(k))
    );

    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      PRECACHE_URLS.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
          console.warn('[SW] precache failed for', url, err);
        })
      )
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

async function trimTileCache(cache, maxEntries){
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let parsed;
  try { parsed = new URL(req.url); } catch (e) { return; }

  // Never intercept Supabase or Mapbox API traffic — let them go straight
  // to the network so auth, real-time, and routing always work.
  if (isSupabaseRequest(parsed)) return;
  if (isMapboxApi(parsed)) return;

  // OSM tiles — long-lived cache with size cap.
  if (isOsmTile(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          cache.put(req, resp.clone()).then(() => trimTileCache(cache, MAX_TILES));
        }
        return resp;
      } catch (err) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Same-origin data.json — network-first so the offline fallback stays fresh.
  if (parsed.origin === self.location.origin && isNetworkFirst(parsed)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const resp = await fetch(req, { cache: 'no-cache' });
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Same-origin static assets — cache-first, then network.
  if (parsed.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok && resp.type === 'basic') {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (err) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  // Cross-origin (CDN scripts, fonts, etc.) — passthrough only. Don't cache
  // these in the SW: opaque/CORS edge cases here have caused script bodies
  // to come back empty and break parsing.
});
