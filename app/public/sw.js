/*
 * The service worker: it exists for push notifications, and for the "add to home screen"
 * install that iOS requires before it will deliver any. It caches nothing — the app is a live
 * view of the books, and a stale copy served offline would be worse than an error.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'התראה';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    // A tag that repeats replaces the notification in the tray instead of stacking a copy.
    renotify: Boolean(data.tag),
    dir: 'rtl',
    lang: 'he',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open window of the app rather than opening a second one.
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});

// The browser rotated the subscription (it does, now and then): hand the new one to the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  event.waitUntil((async () => {
    const key = old && old.options && old.options.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  })());
});
