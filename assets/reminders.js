(() => {
  'use strict';

  const APP_URL = new URL('./notebook_app_rich_improved.html', location.href);
  const STORAGE_KEY = 'smart-notebook-delivered-reviews-v1';
  const BRIDGE = 'smart-notebook-reminders';
  let registration;
  let extensionEnabled = false;
  let extensionDelivers = false;
  let lastSync;
  let backgroundRequest = Promise.resolve();

  function start(onOpen) {
    if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', ({ data }) => {
          if (data?.source === 'notebook-notification') onOpen(data.noteId);
        });
        registration = navigator.serviceWorker.register('./sw.js')
          .then(() => navigator.serviceWorker.ready)
          .catch(error => { console.warn('Service worker registration failed', error); });
      }
    }
  }

  function sendToExtension(action, details = {}) {
    if (location.origin === 'null') return Promise.resolve(null);
    return new Promise(resolve => {
      const requestId = crypto.randomUUID?.() || Math.random().toString(36);
      const respond = event => {
        if (event.source === window && event.origin === location.origin &&
            event.data?.source === BRIDGE && event.data.reply === requestId) {
          clearTimeout(timeout);
          window.removeEventListener('message', respond);
          resolve(event.data.result);
        }
      };
      const timeout = setTimeout(() => {
        window.removeEventListener('message', respond);
        resolve(null);
      }, 1200);
      window.addEventListener('message', respond);
      window.postMessage({ source: BRIDGE, requestId, action, ...details }, location.origin);
    });
  }

  function updateExtensionStatus(response) {
    const previouslyEnabled = extensionEnabled;
    extensionEnabled = Boolean(response?.enabled);
    extensionDelivers = Boolean(extensionEnabled && response?.allowed);
    if (!extensionEnabled || !previouslyEnabled) lastSync = null;
    return { available: Boolean(response?.ok), enabled: extensionEnabled, allowed: response?.allowed };
  }

  function enqueueBackground(task) {
    backgroundRequest = backgroundRequest.then(task, task);
    return backgroundRequest;
  }

  function getBackgroundStatus() {
    return enqueueBackground(async () => updateExtensionStatus(await sendToExtension('status')));
  }

  function setBackground(enabled, getEntries) {
    return enqueueBackground(async () => {
      const entries = enabled ? getEntries() : [];
      const result = updateExtensionStatus(await sendToExtension('set-enabled', { enabled, entries }));
      if (result.enabled) lastSync = JSON.stringify(entries);
      return result;
    });
  }

  function syncBackground(getEntries) {
    return enqueueBackground(async () => {
      if (!extensionEnabled) return;
      const entries = getEntries();
      const json = JSON.stringify(entries);
      if (json === lastSync) return;
      const result = updateExtensionStatus(await sendToExtension('sync', { entries }));
      if (result.enabled) lastSync = json;
    });
  }

  async function showSystemNotification(title, body, noteId, onOpen) {
    const url = new URL(APP_URL);
    if (noteId) url.searchParams.set('note', noteId);
    else if (noteId === '') url.searchParams.set('review', 'due');
    const options = { body, tag: noteId === undefined ? 'review-test' : noteId ? 'review-' + noteId : 'review-due', data: { url: url.href } };
    const worker = await registration;
    if (worker) {
      await worker.showNotification(title, { ...options, icon: new URL('./extension/icon.png', APP_URL).href });
      return;
    }
    const notification = new Notification(title, options);
    if (noteId !== undefined) {
      notification.onclick = () => {
        window.focus();
        onOpen(noteId);
        notification.close();
      };
    }
  }

  function deliveredReviews() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function markDelivered(entries) {
    const now = Date.now();
    const recorded = Object.fromEntries(Object.entries(deliveredReviews()).filter(([, dueAt]) => now - dueAt < 90 * 86400_000));
    for (const { id, dueAt } of entries) {
      Object.defineProperty(recorded, id, { value: dueAt, enumerable: true, configurable: true });
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recorded)); }
    catch (error) { console.warn('Delivery state could not be saved', error); }
  }

  async function deliverDue(getEntries, onOpen) {
    if (extensionDelivers || window.Notification?.permission !== 'granted') return;
    const notify = async () => {
      const recorded = deliveredReviews();
      const entries = getEntries().filter(entry => entry.dueAt <= Date.now() && recorded[entry.id] !== entry.dueAt);
      if (!entries.length) return;
      const single = entries.length === 1;
      const body = single ? entries[0].title : 'Заметок к повторению: ' + entries.length;
      try {
        await showSystemNotification('Пора повторить', body, single ? entries[0].id : '', onOpen);
        markDelivered(entries);
      } catch (error) {
        console.warn('Reminder could not be displayed', error);
      }
    };
    if (navigator.locks && location.origin !== 'null') await navigator.locks.request(STORAGE_KEY, notify);
    else await notify();
  }

  window.notebookReminders = {
    start, getBackgroundStatus, setBackground, syncBackground, deliverDue,
    testBackground: () => sendToExtension('test'),
    testSite: () => showSystemNotification('Проверка уведомлений', 'Smart Notebook сможет напомнить о повторении.'),
    siteWasDelivered: (id, dueAt) => deliveredReviews()[id] === dueAt
  };
})();
