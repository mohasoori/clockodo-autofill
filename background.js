// background.js — MV3 service worker
// Owns the daily auto-fill alarm and routes popup requests to clockodo-api.js.

import {
  loadConfig,
  saveConfig,
  fillDay,
  fillRange,
  testConnectionAndResolveUser,
  getCustomers,
  getServices,
  todayStr,
} from "./clockodo-api.js";

const ALARM_NAME = "clockodo-daily-fill";

// ---------------------------------------------------------------------------
// Alarm scheduling
// ---------------------------------------------------------------------------
function nextFireTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function rescheduleAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  const cfg = await loadConfig();
  if (!cfg.autoDaily) return;
  chrome.alarms.create(ALARM_NAME, {
    when: nextFireTime(cfg.autoTime),
    periodInMinutes: 24 * 60,
  });
}

chrome.runtime.onInstalled.addListener(rescheduleAlarm);
chrome.runtime.onStartup.addListener(rescheduleAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const cfg = await loadConfig();
  if (!cfg.autoDaily || !cfg.usersId) return;

  try {
    const result = await fillDay(cfg, todayStr(cfg.timezone), { force: false });
    if (result.status === "created") {
      notify(
        "Clockodo filled",
        result.approved
          ? `Today (${result.dateStr}) filled and approved.`
          : `Today (${result.dateStr}) filled — pending approval.`
      );
    } else if (result.status === "error") {
      notify("Clockodo auto-fill failed", result.error || "Unknown error");
    }
    // "skipped" / "exists" -> silent, nothing to report.
  } catch (e) {
    notify("Clockodo auto-fill failed", e.message);
  }
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

// ---------------------------------------------------------------------------
// Message router (popup/options -> background)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true; // keep the channel open for the async response
});

async function handle(msg) {
  switch (msg.action) {
    case "testConnection": {
      const cfg = await loadConfig();
      const { usersId, name } = await testConnectionAndResolveUser(cfg);
      await saveConfig({ usersId });
      return { ok: true, usersId, name };
    }
    case "fillToday": {
      const cfg = await loadConfig();
      const result = await fillDay(cfg, todayStr(cfg.timezone), {
        force: !!msg.force,
      });
      return { ok: true, result };
    }
    case "fillRange": {
      const cfg = await loadConfig();
      const results = await fillRange(cfg, msg.from, msg.to, {
        force: !!msg.force,
      });
      return { ok: true, results };
    }
    case "toggleSkipToday": {
      const cfg = await loadConfig();
      const day = todayStr(cfg.timezone);
      const skipDates = new Set(cfg.skipDates || []);
      const skipped = skipDates.has(day);
      if (skipped) skipDates.delete(day);
      else skipDates.add(day);
      await saveConfig({ skipDates: [...skipDates] });
      return { ok: true, skippedToday: !skipped };
    }
    case "setAutoDaily": {
      await saveConfig({ autoDaily: !!msg.enabled });
      await rescheduleAlarm();
      return { ok: true };
    }
    case "rescheduleAlarm": {
      await rescheduleAlarm();
      return { ok: true };
    }
    case "listCustomers": {
      const cfg = await loadConfig();
      return { ok: true, customers: await getCustomers(cfg) };
    }
    case "listServices": {
      const cfg = await loadConfig();
      return { ok: true, services: await getServices(cfg) };
    }
    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}
