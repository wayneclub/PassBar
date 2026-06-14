// PassBar push notification service worker.
// Scope is the app root so notifications work for the installed iOS/Android PWA.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'PassBar', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'PassBar';
  const options = {
    body: payload.body || '',
    icon: payload.icon || './web-app-manifest-192x192.png',
    badge: payload.badge || './web-app-manifest-192x192.png',
    data: { url: payload.url || './' },
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
