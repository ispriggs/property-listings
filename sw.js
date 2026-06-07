const CACHE = 'valle-vivo-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/auth.js',
  '/js/data.js',
  '/js/main.js',
  '/images/logo_nobackground.png',
  '/images/Logo_background.png',
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
  // Always go to network for Supabase — listings need to be live
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
