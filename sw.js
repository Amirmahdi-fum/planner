/**
 * Study Planner Service Worker
 * Cache-first for app assets, network-first for navigations, dedicated cache for Google Fonts.
 * Bump CACHE_NAME on each release to invalidate old shell & assets.
 */
const CACHE_NAME = 'study-planner-v6.6.0';
const CACHE_FONTS = 'study-planner-fonts-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './detect.js',
  './sync.js',
  './app.js',
  './favicon.svg',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  // Pre-cache each asset individually instead of caches.addAll(). addAll() is
  // atomic: if ANY single asset rejects (intermittent 404 on an icon, a flaky
  // mobile connection mid-install, a transient 5xx), the whole batch rejects
  // and the new SW's precache stays EMPTY. The user is then stuck on the old
  // SW indefinitely and the assets they actually need (index.html, app.js,
  // style.css) — which may well have fetched fine — are never stored. Per-asset
  // put() degrades gracefully: a missing icon is logged but the core shell is
  // still cached and the SW activates. Non-essential icons will be filled in
  // lazily by the cache-first handler on first request.
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c =>
        Promise.all(ASSETS.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => res.ok ? c.put(url, res.clone()) : Promise.reject(new Error('status ' + res.status + ' for ' + url)))
            .catch(err => { console.warn('[SW] precache miss for', url, err && err.message); })
        ))
      )
      .then(() => self.skipWaiting())
  );
});

// Allow the client to tell this SW to activate immediately
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== CACHE_NAME && k !== CACHE_FONTS)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Google Fonts: stale-while-revalidate (cache-first, refresh in background)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE_FONTS).then(c =>
        c.match(e.request).then(r => {
          const networkFetch = fetch(e.request).then(res => {
            if (res.ok) c.put(e.request, res.clone());
            return res;
          }).catch(() => r);
          return r || networkFetch;
        })
      )
    );
    return;
  }

  // Navigations: network-first with 3s timeout, offline fallback to cached index.html.
  // On a slow/hanging network an un-raced fetch() can stall the page load for the
  // browser's full TCP timeout (~30s+), which feels like a total hang. Racing
  // against a 3s timeout lets us fall through to the cached shell quickly so the
  // app stays responsive even on flaky mobile connections.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const networkPromise = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put('./index.html', clone));
          }
          return res;
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('nav-timeout')), 3000)
        );
        try {
          return await Promise.race([networkPromise, timeoutPromise]);
        } catch (err) {
          const cached = await caches.match('./index.html');
          return cached || networkPromise.catch(() =>
            new Response('Offline', { status: 503, statusText: 'Offline' })
          );
        }
      })()
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate. The previous pure cache-first
  // meant app.js/style.css served from cache were NEVER refreshed between
  // CACHE_NAME bumps — so a user who opened the app once could run a stale
  // shell for the entire lifetime of a release even though a fresh build was
  // deployed, with no path to pick it up short of a hard reload. SWR serves the
  // cached copy instantly (fast, offline-safe) and simultaneously fires a
  // background fetch whose result updates the cache for the NEXT load. This
  // also mitigates navigation version skew: index.html (network-first nav) is
  // always fresh after a reload, and the background revalidation keeps the
  // referenced app.js/style.css in lockstep with the deployed HTML, so a new
  // HTML document and its assets converge to the same version across loads.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET' && e.request.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => null);
      // Serve cached immediately when present; otherwise wait on the network.
      if (cached) {
        // Kick off background revalidation without blocking the response.
        networkFetch.catch(() => {});
        return cached;
      }
      return networkFetch || new Response('Offline', { status: 503, statusText: 'Offline' });
    })
  );
});
