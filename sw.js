/* mFinance service worker — çevrimdışı çalışma
 * - Uygulama dosyaları: önce ağ, ağ yoksa önbellek (internet varken hep güncel sürüm)
 * - 3D ikonlar, fontlar ve CDN kütüphaneleri: önce önbellek
 * - Supabase ve kur API'leri: hiç önbelleğe alınmaz
 */
const CACHE = 'mfinance-v3';
const SHELL = [
  './', './index.html', './css/style.css', './js/config.js', './js/merge.js', './js/lock.js', './js/app.js',
  './manifest.webmanifest', './assets/logo.svg', './assets/icon-192.png', './assets/apple-touch-icon.png',
];
const ICONS = ['cart', 'burger', 'coffee', 'pizza', 'bus', 'car', 'fuel', 'plane', 'house', 'bulb', 'tv', 'music',
  'phone', 'laptop', 'desktop', 'cloud', 'pill', 'game', 'shirt', 'books', 'paw', 'tools', 'gift', 'gem', 'card',
  'bank', 'briefcase', 'bags', 'moneybag', 'banknote', 'wings', 'coin', 'chart', 'piggy', 'shield', 'lock',
  'receipt', 'calendar', 'spiral', 'bell', 'globe', 'sparkles', 'package'].map((n) => `./assets/icons/${n}.png`);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...ICONS])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NEVER_CACHE = ['supabase.co', 'open.er-api.com', 'frankfurter.app'];
const CACHE_FIRST_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER_CACHE.some((h) => url.hostname.endsWith(h))) return;

  const cacheFirst = CACHE_FIRST_HOSTS.includes(url.hostname) ||
    (url.origin === location.origin && url.pathname.includes('/assets/icons/'));

  if (cacheFirst) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (url.origin === location.origin) {
    // cache: 'no-cache' → tarayıcı önbelleği yerine her seferinde sunucuya doğrulat (yeni sürüm hemen gelsin)
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  }
});

// ---------- Bildirimler ----------
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'mFinance', {
    body: data.body || '',
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    tag: data.tag || 'mfinance',
    renotify: true,
    data: { url: data.url || './#dashboard' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#dashboard', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin)) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
