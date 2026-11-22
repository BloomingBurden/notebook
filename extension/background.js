'use strict';

const APP = 'https://bloomingburden.github.io/notebook/notebook_app_rich_improved.html';
const DEV_PATH = '/notebook_app_rich_improved.html';
const ALARM = 'notebook-review';
const RETRY_DELAY = 5 * 60_000;
const REMINDER_INTERVAL = 30 * 60_000;
const iconUrl = chrome.runtime.getURL('icon.png');
let queue = Promise.resolve();

function trustedApp(url) {
  if (!url) return null;
  const parsed = new URL(url);
  const app = parsed.origin + parsed.pathname;
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:';
  return app === APP || (local && parsed.pathname === DEV_PATH) ? app : null;
}

function runSerial(task) {
  const job = queue.then(task);
  queue = job.catch(error => console.warn('Smart Notebook:', error));
  return job;
}

function checkSchedule() {
  runSerial(async () => {
    const { schedules = {} } = await chrome.storage.local.get('schedules');
    await processDue(schedules);
  });
}

function lastDelivery(entry) {
  if (Number.isSafeInteger(entry.lastNotifiedAt) && entry.lastNotifiedAt >= entry.dueAt) return entry.lastNotifiedAt;
  // Version 1 recorded delivery with a boolean.
  return entry.delivered === true ? entry.dueAt : null;
}

function nextReminderAt(entry) {
  const lastNotifiedAt = lastDelivery(entry);
  return lastNotifiedAt === null ? entry.dueAt : lastNotifiedAt + REMINDER_INTERVAL;
}

function syncEntries(config, entries) {
  if (!Array.isArray(entries)) throw new Error('Invalid reminder list');
  const existing = new Map(config.entries.map(entry => [entry.id, entry]));
  const next = new Map();
  for (const entry of entries) {
    if (typeof entry?.id !== 'string' || !entry.id || entry.id.length > 256 ||
        typeof entry.title !== 'string' || !Number.isSafeInteger(entry.dueAt) || entry.dueAt <= 0) continue;
    const previous = existing.get(entry.id);
    const previousDelivery = previous?.dueAt === entry.dueAt ? lastDelivery(previous) : null;
    next.set(entry.id, {
      id: entry.id,
      title: entry.title.slice(0, 160),
      dueAt: entry.dueAt,
      lastNotifiedAt: Math.max(previousDelivery ?? 0, lastDelivery(entry) ?? 0) || null
    });
  }
  config.entries = [...next.values()];
}

async function processDue(schedules) {
  const alertsAllowed = await chrome.notifications.getPermissionLevel() === 'granted';
  const now = Date.now();
  let nextAt = Infinity;
  let changed = false;

  for (const [app, config] of Object.entries(schedules)) {
    if (!config.enabled) continue;
    const due = config.entries.filter(entry => nextReminderAt(entry) <= now);
    if (due.length && alertsAllowed) {
      const selected = due.length === 1 ? due[0] : null;
      const id = 'review|' + encodeURIComponent(app) + '|' + encodeURIComponent(selected?.id || '');
      try {
        await chrome.notifications.create(id, {
          type: 'basic',
          iconUrl,
          title: 'Пора повторить',
          message: selected?.title || 'Заметок к повторению: ' + due.length
        });
        const lastNotifiedAt = Date.now();
        for (const entry of due) entry.lastNotifiedAt = lastNotifiedAt;
        changed = true;
      } catch (error) {
        console.warn('Notification could not be displayed', error);
      }
    }
    for (const entry of config.entries) {
      const nextReminder = nextReminderAt(entry);
      nextAt = Math.min(nextAt, nextReminder <= now ? now + RETRY_DELAY : nextReminder);
    }
  }

  if (changed) await chrome.storage.local.set({ schedules });
  if (Number.isFinite(nextAt)) await chrome.alarms.create(ALARM, { when: nextAt });
  else await chrome.alarms.clear(ALARM);
}

async function handleRequest(app, message) {
  const { schedules = {} } = await chrome.storage.local.get('schedules');
  const config = schedules[app] || { enabled: false, entries: [] };
  const allowed = await chrome.notifications.getPermissionLevel() === 'granted';
  switch (message.action) {
    case 'status':
      break;
    case 'test':
      if (!config.enabled || !allowed) return { ok: false };
      await chrome.notifications.create('notebook-test', {
        type: 'basic', iconUrl, title: 'Проверка уведомлений',
        message: 'Smart Notebook сможет напомнить о повторении при закрытой вкладке.'
      });
      break;
    case 'set-enabled':
      config.enabled = message.enabled === true;
      if (config.enabled) syncEntries(config, message.entries);
      break;
    case 'sync':
      if (config.enabled) syncEntries(config, message.entries);
      break;
    default:
      return { ok: false };
  }
  if (message.action === 'sync' || message.action === 'set-enabled') {
    schedules[app] = config;
    await chrome.storage.local.set({ schedules });
    await processDue(schedules);
  }
  const deliveries = config.entries.flatMap(entry => {
    const lastNotifiedAt = lastDelivery(entry);
    return lastNotifiedAt === null ? [] : [{ id: entry.id, dueAt: entry.dueAt, lastNotifiedAt }];
  });
  return { ok: true, enabled: config.enabled, allowed, recurring: true, deliveries };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const app = trustedApp(sender.url);
  if (!app || sender.id !== chrome.runtime.id || sender.frameId !== 0) return false;
  runSerial(() => handleRequest(app, message)).then(reply, () => reply({ ok: false }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.warn);
  checkSchedule();
});
chrome.runtime.onStartup.addListener(checkSchedule);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) checkSchedule();
});
chrome.notifications.onClicked.addListener(async id => {
  if (!id.startsWith('review|')) return;
  const [, encodedApp, encodedNote] = id.split('|');
  const app = trustedApp(decodeURIComponent(encodedApp));
  if (!app) return;
  const url = new URL(app);
  const note = decodeURIComponent(encodedNote);
  url.searchParams.set(note ? 'note' : 'review', note || 'due');
  await chrome.tabs.create({ url: url.href });
  await chrome.notifications.clear(id);
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: APP }));
