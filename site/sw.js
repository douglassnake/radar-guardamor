const CACHE = 'radar-gm-v16-zoom-hotfix';
const SHELL = [
  './', './index.html', './styles.css', './v4.css', './visual.css', './app.js', './cptec.js', './v4.js', './v5.js', './visual.js', './zoom.js', './data/guardamor/v5.json', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    const match = url.pathname.match(/\/light_all\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (match) {
      const osm = `https://tile.openstreetmap.org/${match[1]}/${match[2]}/${match[3]}.png`;
      event.respondWith(fetch(osm, { mode: 'no-cors', cache: 'force-cache' }));
      return;
    }
  }

  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
