const CACHE = 'duvar-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon-32.png',
  '/favicon-16.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('duvar-') && k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// ── Push bildirimleri ──
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'DUVAR', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      tag: data.tag || 'duvar-notif',
      renotify: true,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  // Bildirimdeki adres sadece bu sitenin içine gidebilir (başka siteye yönlendirme yok)
  let url = '/';
  try {
    const u = new URL(e.notification.data?.url || '/', self.location.origin);
    if (u.origin === self.location.origin) url = u.pathname + u.search + u.hash;
  } catch (_) {}
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes('duvar.site') || w.url.includes('localhost'));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', e => {
  // Supabase ve Google Fonts isteklerini cache'leme
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
