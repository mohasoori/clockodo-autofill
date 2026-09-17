// background.js — MV3 service worker
// Owns the daily auto-fill alarm and routes popup/options requests to clockodo-api.js.

import {
  loadConfig,
  saveConfig,
  fillDay,
  fillRange,
  testConnectionAndResolveUser,
  getCustomers,
  getServices,
  todayStr,
  addDays,
  wallclockToUTC,
  DATE_RE,
  ON_EXISTING,
  pullFromSync,
  exportConfig,
  importConfig,
} from "../lib/clockodo-api.js";
import { fetchLatestVersion, updateCheckConfigured, compareVersions } from "../lib/updates.js";

const ALARM_NAME = "clockodo-daily-fill";
const UPDATE_ALARM_NAME = "clockodo-update-check";
const MAX_RANGE_DAYS = 92;

// ---------------------------------------------------------------------------
// Alarm scheduling — one-shot, recomputed after every fire so the wall-clock
// time in cfg.timezone survives DST changes (a fixed 24 h period would drift).
// ---------------------------------------------------------------------------
function scheduledTodayMs(cfg) {
  return Date.parse(wallclockToUTC(todayStr(cfg.timezone), cfg.autoTime, cfg.timezone));
}

function nextFireTime(cfg) {
  const today = scheduledTodayMs(cfg);
  if (today > Date.now()) return today;
  return Date.parse(wallclockToUTC(addDays(todayStr(cfg.timezone), 1), cfg.autoTime, cfg.timezone));
}

async function rescheduleAlarm(cfg) {
  await chrome.alarms.clear(ALARM_NAME);
  if (!cfg.autoDaily) return null;
  const when = nextFireTime(cfg);
  await chrome.alarms.create(ALARM_NAME, { when });
  return when;
}

// Alarms only fire while Chrome is running. If today's time already passed
// (Chrome was closed, or auto-fill was just enabled late in the day) and today
// hasn't been handled successfully yet, run once now.
async function catchUpIfMissed(cfg) {
  if (!cfg.autoDaily || !cfg.usersId) return;
  if (Date.now() < scheduledTodayMs(cfg)) return;
  const { lastAutoRun } = await chrome.storage.local.get("lastAutoRun");
  const doneToday =
    lastAutoRun &&
    lastAutoRun.dateStr === todayStr(cfg.timezone) &&
    lastAutoRun.status !== "error";
  if (!doneToday) await runAutoFill(cfg);
}

// Serialised: onInstalled, onStartup and a persisted alarm can all arrive at
// launch; without this two runs could both pass the duplicate check and insert.
let autoFillInFlight = null;

function runAutoFill(cfg) {
  if (!autoFillInFlight) {
    autoFillInFlight = doAutoFill(cfg).finally(() => { autoFillInFlight = null; });
  }
  return autoFillInFlight;
}

async function doAutoFill(cfg) {
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
    await notify("Clockodo filled", `Today (${dateStr}): ${detail}`);
  } else if (result.status === "error") {
    await notify("Clockodo auto-fill failed", result.error || "Unknown error");
  }
  // "skipped" / "exists" → silent, nothing to report.
}

// ---------------------------------------------------------------------------
// Update check (opt-out). Fetches only the public manifest.json from GitHub.
// ---------------------------------------------------------------------------
const UPDATE_NOTIFICATION_ID = "clockodo-update-available";

async function scheduleUpdateCheck(cfg) {
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  if (!cfg.checkUpdates || !updateCheckConfigured()) return;
  await chrome.alarms.create(UPDATE_ALARM_NAME, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

async function checkForUpdate() {
  let info;
  try {
    info = await fetchLatestVersion();
  } catch (e) {
    console.warn("[Clockodo Auto-Fill] update check failed:", e.message);
    return;
  }
  if (!info) return;
  const { updateInfo } = await chrome.storage.local.get("updateInfo");
  await chrome.storage.local.set({ updateInfo: { ...info, notifiedVersion: updateInfo?.notifiedVersion } });
  if (info.available && updateInfo?.notifiedVersion !== info.latest) {
    await notify(
      `Clockodo Auto-Fill ${info.latest} is available`,
      `You have ${info.current}. Click to open the download page.`,
      UPDATE_NOTIFICATION_ID
    );
    await chrome.storage.local.set({ updateInfo: { ...info, notifiedVersion: info.latest } });
  }
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== UPDATE_NOTIFICATION_ID) return;
  const { updateInfo } = await chrome.storage.local.get("updateInfo");
  if (updateInfo?.url) chrome.tabs.create({ url: updateInfo.url });
  chrome.notifications.clear(id);
});

async function onLaunch() {
  await pullFromSync(); // a fresh device picks up settings from the user's Chrome account
  const cfg = await loadConfig();
  await rescheduleAlarm(cfg);
  await scheduleUpdateCheck(cfg);
  await catchUpIfMissed(cfg);
}
chrome.runtime.onInstalled.addListener(onLaunch);
chrome.runtime.onStartup.addListener(onLaunch);

// Settings changed on another device → merge and re-plan the alarms.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync" || !changes.settings) return;
  const merged = await pullFromSync();
  if (!merged) return;
  await rescheduleAlarm(merged);
  await scheduleUpdateCheck(merged);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) return checkForUpdate();
  if (alarm.name !== ALARM_NAME) return;
  const cfg = await loadConfig();
  await runAutoFill(cfg);
  await rescheduleAlarm(cfg);
});

// chrome.notifications occasionally fails to fetch extension-packaged images
// ("Unable to download all specified images"); an inline data URL never does.
let iconDataUrl = null;
async function notificationIcon() {
  if (iconDataUrl) return iconDataUrl;
  try {
    const res = await fetch(chrome.runtime.getURL("assets/icons/icon128.png"));
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    iconDataUrl = `data:image/png;base64,${btoa(bin)}`;
  } catch {
    iconDataUrl = chrome.runtime.getURL("assets/icons/icon128.png");
  }
  return iconDataUrl;
}

async function notify(title, message, id) {
  const options = { type: "basic", iconUrl: await notificationIcon(), title, message };
  return id ? chrome.notifications.create(id, options) : chrome.notifications.create(options);
}

// ---------------------------------------------------------------------------
// Message router (popup/options → background)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true; // keep the channel open for the async response
});

function assertDate(s, label) {
  if (typeof s !== "string" || !DATE_RE.test(s) || Number.isNaN(Date.parse(s + "T12:00:00Z"))) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
}

function fillOptions(msg) {
  const onExisting = msg.onExisting ?? "skip";
  if (!ON_EXISTING.includes(onExisting)) throw new Error(`Invalid onExisting: ${onExisting}`);
  return { force: !!msg.force, onExisting };
}

async function handle(msg) {
  const cfg = await loadConfig();
  switch (msg.action) {
    case "testConnection": {
      const { usersId, name } = await testConnectionAndResolveUser(cfg);
      await saveConfig({ usersId, userName: name });
      return { ok: true, usersId, name };
    }
    case "fillToday": {
      const result = await fillDay(cfg, todayStr(cfg.timezone), fillOptions(msg));
      return { ok: true, result };
    }
    case "fillRange": {
      assertDate(msg.from, "From");
      assertDate(msg.to, "To");
      if (msg.from > msg.to) throw new Error("\"From\" must not be after \"To\".");
      const days = Math.round((Date.parse(msg.to) - Date.parse(msg.from)) / 86400000) + 1;
      if (days > MAX_RANGE_DAYS) throw new Error(`Range too large (max ${MAX_RANGE_DAYS} days).`);
      const results = await fillRange(cfg, msg.from, msg.to, fillOptions(msg));
      return { ok: true, results };
    }
    case "toggleSkipToday": {
      const day = todayStr(cfg.timezone);
      const skipDates = new Set(cfg.skipDates || []);
      const skippedToday = !skipDates.has(day);
      if (skippedToday) skipDates.add(day); else skipDates.delete(day);
      await saveConfig({ skipDates: [...skipDates] });
      return { ok: true, skippedToday };
    }
    case "setAutoDaily": {
      const next = await saveConfig({ autoDaily: !!msg.enabled });
      const nextRun = await rescheduleAlarm(next);
      if (next.autoDaily) await catchUpIfMissed(next);
      return { ok: true, nextRun };
    }
    case "rescheduleAlarm": {
      await scheduleUpdateCheck(cfg);
      return { ok: true, nextRun: await rescheduleAlarm(cfg) };
    }
    case "getStatus": {
      const alarm = await chrome.alarms.get(ALARM_NAME);
      const { lastAutoRun, updateInfo } = await chrome.storage.local.get(["lastAutoRun", "updateInfo"]);
      const version = chrome.runtime.getManifest().version;
      // Re-evaluate against the running version: the stored result may predate
      // an update of this very extension.
      const info = cfg.checkUpdates && updateInfo?.latest
        ? { ...updateInfo, current: version, available: compareVersions(updateInfo.latest, version) > 0 }
        : null;
      return {
        ok: true,
        nextRun: alarm ? alarm.scheduledTime : null,
        lastAutoRun: lastAutoRun || null,
        version,
        updateInfo: info,
        update: info?.available ? info : null,
      };
    }
    case "checkForUpdate": {
      if (!updateCheckConfigured()) return { ok: true, update: null, disabled: true };
      const info = await fetchLatestVersion();
      await chrome.storage.local.set({ updateInfo: info });
      return { ok: true, update: info };
    }
    case "exportConfig":
      return { ok: true, payload: await exportConfig({ includeApiKey: !!msg.includeApiKey }) };
    case "importConfig": {
      const next = await importConfig(msg.payload);
      await rescheduleAlarm(next);
      await scheduleUpdateCheck(next);
      return { ok: true };
    }
    case "listCustomers":
      return { ok: true, customers: await getCustomers(cfg) };
    case "listServices":
      return { ok: true, services: await getServices(cfg) };
    default:
      throw new Error(`Unknown action: ${msg.action}`);
  }
}
