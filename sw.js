const CACHE = 'ecovilla-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/components/float-nav.css',
  '/css/components/search-flow.css',
  '/js/lib/config.js',
  '/js/lib/utils.js',
  '/js/lib/auth.js',
  '/js/lib/api.js',
  '/js/components/nav.js',
  '/js/pages/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return;

  const url = new URL(e.request.url);
  const isAsset = /\.(css|js|html)$/.test(url.pathname) || url.pathname === '/';

  if (isAsset) {
    // Network-first for HTML/CSS/JS so changes are always picked up
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for images and other static assets
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
