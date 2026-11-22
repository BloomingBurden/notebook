'use strict';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const { source, requestId, action, enabled, entries } = event.data || {};
  if (source !== 'smart-notebook-reminders' || typeof requestId !== 'string') return;
  chrome.runtime.sendMessage({ action, enabled, entries })
    .then(result => window.postMessage({ source, reply: requestId, result }, location.origin))
    .catch(() => {});
});
