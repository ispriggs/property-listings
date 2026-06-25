const CACHE = 'ecovilla-v2';
const LISTINGS_CACHE = 'ecovilla-listings-v1';

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
  '/js/api/db.js',
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
      Promise.all(keys.filter(k => k !== CACHE && k !== LISTINGS_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Public listings endpoint — stale-while-revalidate so the grid renders instantly
// on repeat visits while fresh data loads silently in the background.
function isPublicListings(url) {
  return url.includes('supabase.co') &&
    url.includes('/rest/v1/listings') &&
    url.includes('status=eq.active');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Stale-while-revalidate for public listing data
  if (isPublicListings(e.request.url)) {
    e.respondWith(
      caches.open(LISTINGS_CACHE).then(cache => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        });
        return cache.match(e.request).then(cached => cached || networkFetch);
      })
    );
    return;
  }

  // Skip all other Supabase requests (auth, bookings, etc.) — always fresh
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
