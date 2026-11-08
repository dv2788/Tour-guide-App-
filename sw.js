// Keeps the app itself available with a weak connection. Map tiles and Wikipedia
// always come from the network (they're live data), so they're not cached here.
// The AI voice files are cached separately by js/neuralVoice.js and js/supertonicVoice.js.
const CACHE = 'roamie-v53';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/street.css',
  './streetview.html',
  './css/fonts.css',
  './fonts/cormorant-garamond-latin.woff2',
  './fonts/cormorant-garamond-italic-latin.woff2',
  './fonts/jost-latin.woff2',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './js/app.js',
  './js/geo.js',
  './js/geocode.js',
  './js/i18n.js',
  './js/itineraryImport.js',
  './js/lens.js',
  './js/lensView.js',
  './js/declination.js',
  './js/events.js',
  './js/frame-guard.js',
  './js/location.js',
  './js/modes.js',
  './js/moved.js',
  './js/narration.js',
  './js/navigation.js',
  './js/samples.js',
  './js/sample-places.js',
  './js/narrator.js',
  './js/neuralVoice.js',
  './js/numbers.js',
  './js/supertonicVoice.js',
  './js/story.js',
  './js/openingHours.js',
  './js/plus.js',
  './js/plus-config.js',
  './js/saved.js',
  './js/streetView.js',
  './js/photoView.js',
  './js/streetview-frame.js',
  './js/streetview-config.js',
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
    // Only Roamie's old offline copies ("roamie-v36", and "tour-guide-v4" from before the name):
    // the downloaded voices, and anything else on this github.io address, are not ours to delete.
    caches.keys().then((keys) => Promise.all(keys.filter((k) => /^(roamie|tour-guide)-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network first (so updates show up immediately), falling back to the cached copy offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Answers about your links (/api/) are never kept; pages are kept once, whatever follows "?".
  if (url.pathname.includes('/api/')) return;
  const key = request.mode === 'navigate' ? url.pathname : request.url;
  event.respondWith(
    // "no-cache": ask the server whether there's a newer version (not the browser's 10-minute copy).
    // By address: a page navigation can't be re-sent with options.
    fetch(request.url, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE); // our own copy only
        return (await cache.match(key)) ?? (await cache.match('./index.html'));
      }),
  );
});
