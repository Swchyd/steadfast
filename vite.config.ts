import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

// Writes sw.js at build time: cache-first app shell, no background sync.
// The pose model and wasm live in a separate cache so app updates don't re-download them.
function serviceWorker(): Plugin {
  return {
    name: 'steadfast-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      const shell = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
      for (const [name, item] of Object.entries(bundle)) {
        hash.update(name);
        if (item.type === 'asset') hash.update(item.source);
        else hash.update(item.code);
        if (!name.endsWith('.map')) shell.push(name);
      }
      const version = hash.digest('hex').slice(0, 12);
      const source = `const SHELL_CACHE = 'steadfast-shell-${version}';
const HEAVY_CACHE = 'steadfast-heavy-v1';
const SHELL = ${JSON.stringify(shell)};

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
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2020' },
});
