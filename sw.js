const SHELL_CACHE = 'steadfast-shell-3ddd00d41ec5';
const HEAVY_CACHE = 'steadfast-heavy-v1';
const SHELL = ["./","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","assets/lato-latin-900-italic-BavPsJuJ.woff2","assets/lato-latin-700-normal-BUGMgin4.woff2","assets/lato-latin-400-normal-BEhtfm5r.woff2","assets/lato-latin-900-normal-C3uaq3BA.woff2","assets/index-ItIxTTyR.css","assets/index--3nxFwsq.js","assets/vision_bundle-D3Y4SyO5.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('steadfast-') && k !== SHELL_CACHE && k !== HEAVY_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const heavy = url.pathname.includes('/models/') || url.pathname.includes('/wasm/');
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (heavy && res.ok) {
        const cache = await caches.open(HEAVY_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
