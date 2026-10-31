// Keeps the app itself available with a weak connection. Map tiles and Wikipedia
// always come from the network (they're live data), so they're not cached here.
// The AI voice files are cached separately by js/neuralVoice.js.
const CACHE = 'roamie-v4';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './js/app.js',
  './js/geo.js',
  './js/geocode.js',
  './js/i18n.js',
  './js/itineraryImport.js',
  './js/location.js',
  './js/modes.js',
  './js/narration.js',
  './js/narrator.js',
  './js/neuralVoice.js',
  './js/openingHours.js',
  './js/suggest.js',
  './js/text.js',
  './js/tourEngine.js',
  './js/voices.js',
  './js/wiki.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network first (so updates show up immediately), falling back to the cached copy offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
  );
});
