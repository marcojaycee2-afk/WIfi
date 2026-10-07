self.addEventListener('push', event => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('Could not parse push notification payload', error);
  }
  event.waitUntil(self.registration.showNotification(message.title || 'NAPBOX reminder', {
    body: message.body || 'There are overdue payments to review.',
    tag: message.tag || 'late-payments-daily',
    data: { url: message.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      return existing.navigate(target).then(client => (client || existing).focus());
    }
    return self.clients.openWindow(target);
  }));
});
