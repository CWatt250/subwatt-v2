// SubWatt service worker
// Bump CACHE_NAME when shipping new assets so clients pick them up
// SubWatt v2 — rates now live in Supabase, not data.json.
// data.json is kept in the repo as an offline last-resort fallback only.
// Bump CACHE_NAME whenever you ship changes to index.html, admin.html, or other assets.
const CACHE_NAME = 'subwatt-v11';
const TILE_CACHE = 'subwatt-tiles-v1';
const MAX_TILES = 500;

const PRECACHE_URLS = [
  'index.html',
  'manifest.json',
  'data.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// Supabase API requests must never be served from cache.
function isSupabaseRequest(url){
  return url.hostname.endsWith('.supabase.co');
}

// data.json stays network-first so the offline fallback stays fresh when online.
function isNetworkFirst(url){
  return url.pathname.endsWith('/data.json') || url.pathname === '/data.json';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] precache failed for', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isOsmTile(url) {
  return /^https:\/\/([a-z0-9-]+\.)?tile\.openstreetmap\.org\//.test(url);
}

async function trimTileCache(cache, maxEntries) {
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

  const url = req.url;
  const parsed = new URL(url);

  // Supabase API — never cache, always go to network
  if (isSupabaseRequest(parsed)) return;

  // Network-first for offline fallback data.json
  if (parsed.origin === self.location.origin && isNetworkFirst(parsed)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const resp = await fetch(req, { cache: 'no-cache' });
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        } catch (err) {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  if (isOsmTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
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
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok && new URL(url).origin === self.location.origin) {
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
    })
  );
});
