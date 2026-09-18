// activity.js — what the extension itself did (booked / replaced / already filled / skipped / failed).
// Full log in chrome.storage.local; the most recent entries are mirrored to
// chrome.storage.sync in small chunks so every device shows the same history.
//
// Entry shapes (newest first):
//   single: { id, at, kind:"day",   date, status, source, blocks, replaced, error, device, count }
//   range:  { id, at, kind:"range", from, to, date(=from), source, counts:{created,replaced,error,skipped,exists},
//             days:[{date,status,blocks,replaced,error}], device }

const LOCAL_KEY = "activity";
const DEVICE_KEY = "device";
const SYNC_PREFIX = "activity_";
const LOCAL_MAX = 1000;
const SYNC_MAX = 150;
const SYNC_CHUNK_BYTES = 7000; // Chrome Sync: 8 KB per item, 100 KB total
const DEDUPE_WINDOW_MS = 60_000;
const RANGE_DETAIL_MAX = 92;

// Everything is logged; "exists"/"skipped" are informational (nothing was written).
export const LOGGED_STATUSES = ["created", "replaced", "error", "exists", "skipped"];
export const CHANGE_STATUSES = ["created", "replaced", "error"];

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blocksText = (blocks) => (blocks || []).map((b) => `${b.start}-${b.end}`).join(",");

async function getDevice() {
  const { [DEVICE_KEY]: dev } = await chrome.storage.local.get(DEVICE_KEY);
  if (dev) return dev;
  const id = Math.random().toString(36).slice(2, 8);
  const os = /Win/.test(navigator.platform) ? "Windows" : /Mac/.test(navigator.platform) ? "Mac" : /Linux|CrOS/.test(navigator.platform) ? "Linux" : "Device";
  const created = { id, label: `${os} · ${id}` };
  await chrome.storage.local.set({ [DEVICE_KEY]: created });
  return created;
}

export async function renameDevice(label) {
  const dev = await getDevice();
  await chrome.storage.local.set({ [DEVICE_KEY]: { ...dev, label: String(label).slice(0, 40) } });
}

async function append(entry) {
  const { [LOCAL_KEY]: list = [] } = await chrome.storage.local.get(LOCAL_KEY);
  const head = list[0];
  // Collapse a burst of identical no-change results (errors, "already filled",
  // "skipped", range runs that booked nothing) into one row with a counter.
  const sameDay = head && entry.kind === "day" && head.kind === "day" && entry.status !== "created" &&
      entry.status !== "replaced" && head.status === entry.status && head.date === entry.date &&
      head.source === entry.source && head.error === entry.error;
  const sameRange = head && entry.kind === "range" && head.kind === "range" && entry.days.length === 0 &&
      head.days.length === 0 && head.from === entry.from && head.to === entry.to &&
      head.runError === entry.runError && JSON.stringify(head.counts) === JSON.stringify(entry.counts);
  if ((sameDay || sameRange) && entry.at - head.at < DEDUPE_WINDOW_MS) {
    head.count = (head.count || 1) + 1;
    head.at = entry.at;
  } else {
    list.unshift(entry);
    if (list.length > LOCAL_MAX) list.length = LOCAL_MAX;
  }
  await chrome.storage.local.set({ [LOCAL_KEY]: list });
  await pushRecentToSync(list);
  return list[0];
}

// result: the object returned by fillDay (or {dateStr,status:"error",error}); source: "manual" | "auto".
export async function logActivity(result, source) {
  if (!LOGGED_STATUSES.includes(result.status)) return null;
  const dev = await getDevice();
  return append({
    id: newId(),
    at: Date.now(),
    kind: "day",
    date: result.dateStr,
    status: result.status,
    source,
    blocks: blocksText(result.blocks),
    replaced: result.replaced || 0,
    error: result.status === "error" ? String(result.error || "").slice(0, 120) : (result.reason || ""),
    device: dev.label,
    count: 1,
  });
}

// One entry for a whole "Fill range" run, with per-day detail for days that changed or failed.
// runError: the run aborted before booking anything (e.g. not configured) — no per-day detail.
export async function logRangeActivity(from, to, results, source = "range", runError = null) {
  const dev = await getDevice();
  if (runError) {
    return append({ id: newId(), at: Date.now(), kind: "range", from, to, date: from, source,
      counts: { created: 0, replaced: 0, error: 0, skipped: 0, exists: 0 }, days: [],
      runError: String(runError).slice(0, 160), device: dev.label, count: 1 });
  }
  const counts = { created: 0, replaced: 0, error: 0, skipped: 0, exists: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const days = results
    .filter((r) => CHANGE_STATUSES.includes(r.status))
    .slice(0, RANGE_DETAIL_MAX)
    .map((r) => ({
      date: r.dateStr,
      status: r.status,
      blocks: blocksText(r.blocks),
      replaced: r.replaced || 0,
      error: r.status === "error" ? String(r.error || "").slice(0, 60) : "",
    }));
  return append({ id: newId(), at: Date.now(), kind: "range", from, to, date: from, source, counts, days, runError: null, device: dev.label, count: 1 });
}

async function pushRecentToSync(list) {
  try {
    const recent = list.slice(0, SYNC_MAX);
    const chunks = [];
    let cur = [];
    for (const e of recent) {
      if (JSON.stringify(e).length > SYNC_CHUNK_BYTES) continue; // never fits; keep it local only
      cur.push(e);
      if (JSON.stringify(cur).length > SYNC_CHUNK_BYTES) { cur.pop(); chunks.push(cur); cur = [e]; }
    }
    if (cur.length) chunks.push(cur);
    const payload = {};
    chunks.forEach((c, i) => { payload[`${SYNC_PREFIX}${i}`] = c; });
    const existing = Object.keys(await chrome.storage.sync.get(null)).filter((k) => k.startsWith(SYNC_PREFIX));
    const stale = existing.filter((k) => !(k in payload));
    if (Object.keys(payload).length) await chrome.storage.sync.set(payload);
    if (stale.length) await chrome.storage.sync.remove(stale);
  } catch (e) {
    console.warn("[Clockodo Auto-Fill] activity sync failed:", e.message);
  }
}

// Local + synced entries, de-duplicated by id, newest first.
export async function getActivity() {
  const { [LOCAL_KEY]: local = [] } = await chrome.storage.local.get(LOCAL_KEY);
  const all = await chrome.storage.sync.get(null);
  const synced = Object.keys(all).filter((k) => k.startsWith(SYNC_PREFIX)).flatMap((k) => all[k] || []);
  const byId = new Map();
  for (const e of [...synced, ...local]) if (e && e.id) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

export async function clearActivity() {
  await chrome.storage.local.remove(LOCAL_KEY);
  const all = await chrome.storage.sync.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(SYNC_PREFIX));
  if (keys.length) await chrome.storage.sync.remove(keys);
}

// Flat CSV (one row per affected day; range runs carry range_from/range_to). UTF-8 BOM for Excel.
export function activityToCsv(entries) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["logged_utc", "logged_local", "work_date", "status", "source", "range_from", "range_to", "blocks", "replaced", "note", "repeats", "device"];
  const local = (ms) => {
    const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const rows = [];
  for (const e of entries) {
    const at = new Date(e.at).toISOString(), lt = local(e.at), n = e.count || 1;
    if (e.kind === "range") {
      if (e.runError) { rows.push([at, lt, "", "run failed", e.source, e.from, e.to, "", 0, e.runError, n, e.device]); continue; }
      for (const d of e.days) rows.push([at, lt, d.date, d.status, e.source, e.from, e.to, d.blocks, d.replaced, d.error, 1, e.device]);
      if (!e.days.length) rows.push([at, lt, "", "no changes", e.source, e.from, e.to, "", 0, `${e.counts.skipped} skipped, ${e.counts.exists} already filled`, n, e.device]);
    } else {
      rows.push([at, lt, e.date, e.status, e.source, "", "", e.blocks, e.replaced, e.error, n, e.device]);
    }
  }
  return "﻿" + [head.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
