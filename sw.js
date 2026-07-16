/* Service Worker：离线缓存 + 本地通知 */
const CACHE = 'item-keeper-v2';
const ASSETS = [
  './', './index.html', './styles.css',
  './js/app.js', './js/db.js', './js/knowledge.js', './js/recipes.js', './js/nutrition.js',
  './manifest.webmanifest', './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // 网络优先：保证每次部署更新都能拿到最新文件；离线时回退缓存
  e.respondWith(
    fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(e.request))
  );
});

// 接收主线程发来的本地通知请求
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'notify') {
    const d = e.data.payload || {};
    self.registration.showNotification(d.title || '小满提醒', {
      body: d.body || '',
      icon: './icon.svg',
      badge: './icon.svg',
      tag: d.tag || 'ik-reminder',
      renotify: true
    });
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cls => {
    for (const c of cls) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./index.html');
  }));
});
