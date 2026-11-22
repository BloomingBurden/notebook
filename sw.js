'use strict';

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data.url);
  if (destination.origin !== self.location.origin || !destination.href.startsWith(self.registration.scope)) return;

  event.waitUntil((async () => {
    const noteId = destination.searchParams.get('note');
    const dueList = destination.searchParams.get('review') === 'due';
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const notebook = windows.find(client => new URL(client.url).pathname === destination.pathname);
    if (notebook) {
      if (noteId || dueList) notebook.postMessage({ source: 'notebook-notification', noteId: noteId || '' });
      await notebook.focus();
    } else {
      await self.clients.openWindow(destination.href);
    }
  })());
});
