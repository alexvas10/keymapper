// ---------------------------------------------------------------------------
// Service worker — offline access.
//
// The editor has no backend to be cut off from: the config lives on the user's
// own disk and is reached through the File System Access API, which works with
// no network at all. The only thing standing between this app and working
// offline is fetching the app itself, which is what this caches.
//
// Strategy is stale-while-revalidate for the app shell. Vite fingerprints every
// asset filename, so a cached asset is immutable and serving it from the cache
// is always correct; index.html is not fingerprinted, so it is refreshed in the
// background and the new version is picked up on the next load.
// ---------------------------------------------------------------------------

const CACHE = 'keymapper-v1';

self.addEventListener('install', event => {
  // The shell is enough to boot; hashed assets land in the cache as they are
  // first requested.
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html', '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return response;
        })
        // Offline with nothing cached for a navigation: fall back to the shell,
        // so a deep link or a reload still opens the app.
        .catch(() => cached ?? caches.match('/index.html'));

      return cached ?? network;
    }),
  );
});
