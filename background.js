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
  wallclockToUTC,
} from "./clockodo-api.js";

const ALARM_NAME = "clockodo-daily-fill";
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Alarm scheduling (all in cfg.timezone, not the machine's zone)
// ---------------------------------------------------------------------------
function scheduledTodayMs(cfg) {
  return Date.parse(wallclockToUTC(todayStr(cfg.timezone), cfg.autoTime, cfg.timezone));
}

function nextFireTime(cfg) {
  const today = scheduledTodayMs(cfg);
  if (today > Date.now()) return today;
  const tomorrow = new Date(Date.parse(todayStr(cfg.timezone) + "T12:00:00Z") + DAY_MS)
    .toISOString().slice(0, 10);
  return Date.parse(wallclockToUTC(tomorrow, cfg.autoTime, cfg.timezone));
}

async function rescheduleAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  const cfg = await loadConfig();
  if (!cfg.autoDaily) return null;
  const when = nextFireTime(cfg);
  chrome.alarms.create(ALARM_NAME, { when, periodInMinutes: 24 * 60 });
  return when;
}

// Alarms only fire while Chrome is running. If today's scheduled time already
// passed (Chrome was closed, or auto-fill was just enabled late in the day),
// run once now so the day doesn't get missed. fillDay's dup check keeps this safe.
async function catchUpIfMissed() {
  const cfg = await loadConfig();
  if (!cfg.autoDaily || !cfg.usersId) return;
  if (Date.now() < scheduledTodayMs(cfg)) return;
  const { lastAutoRun } = await chrome.storage.local.get("lastAutoRun");
  if (lastAutoRun && lastAutoRun.dateStr === todayStr(cfg.timezone)) return;
  await runAutoFill();
}

async function runAutoFill() {
  const cfg = await loadConfig();
  if (!cfg.autoDaily || !cfg.usersId) return;
  const dateStr = todayStr(cfg.timezone);
  let result;
  try {
    result = await fillDay(cfg, dateStr, { force: false });
  } catch (e) {
    result = { dateStr, status: "error", error: e.message };
  }
  await chrome.storage.local.set({ lastAutoRun: { ...result, at: Date.now() } });

  if (result.status === "created") {
    const detail =
      cfg.mode === "entry" ? "time entries created." :
      result.approved ? "working time approved." : "change request pending approval.";
    notify("Clockodo filled", `Today (${dateStr}): ${detail}`);
  } else if (result.status === "error") {
    notify("Clockodo auto-fill failed", result.error || "Unknown error");
  }
  // "skipped" / "exists" -> silent, nothing to report.
}

chrome.runtime.onInstalled.addListener(async () => {
  await rescheduleAlarm();
  await catchUpIfMissed();
});
chrome.runtime.onStartup.addListener(async () => {
  await rescheduleAlarm();
  await catchUpIfMissed();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runAutoFill();
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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true; // keep the channel open for the async response
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;

function assertDate(s, label) {
  if (typeof s !== "string" || !DATE_RE.test(s) || Number.isNaN(Date.parse(s + "T12:00:00Z"))) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}

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
      assertDate(msg.from, "From");
      assertDate(msg.to, "To");
      if (msg.from > msg.to) throw new Error("\"From\" must not be after \"To\".");
      const days = Math.round((Date.parse(msg.to) - Date.parse(msg.from)) / 86400000) + 1;
      if (days > MAX_RANGE_DAYS) throw new Error(`Range too large (max ${MAX_RANGE_DAYS} days).`);
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
      const nextRun = await rescheduleAlarm();
      if (msg.enabled) await catchUpIfMissed();
      return { ok: true, nextRun };
    }
    case "rescheduleAlarm": {
      const nextRun = await rescheduleAlarm();
      return { ok: true, nextRun };
    }
    case "getStatus": {
      const alarm = await chrome.alarms.get(ALARM_NAME);
      const { lastAutoRun } = await chrome.storage.local.get("lastAutoRun");
      return {
        ok: true,
        nextRun: alarm ? alarm.scheduledTime : null,
        lastAutoRun: lastAutoRun || null,
      };
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
