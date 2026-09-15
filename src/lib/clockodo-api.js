// clockodo-api.js
// Thin wrapper around the Clockodo REST API used by the extension.
// Docs: https://docs.clockodo.com/
//
// Auth uses a personal API key (NOT your password). Each user pastes their own
// key once in the options page. The key is stored only in chrome.storage.local
// on their own machine and is sent only to my.clockodo.com.

// ---------------------------------------------------------------------------
// Endpoint configuration — adjust here if Clockodo changes paths.
// Versions verified against the official `clockodo` npm SDK (peerigon/clockodo).
// ---------------------------------------------------------------------------
export const BASE = "https://my.clockodo.com";

// Clockodo requires "<application>;<technical contact email>" on every request.
// This identifies the integration, not the end user.
const EXTERNAL_APPLICATION = "ClockodoAutoFill;contact@msoori.com";

const EP = {
  me: "/api/v4/users/me", // v2/users is 410 Gone
  workTimes: "/api/v2/workTimes",
  changeRequestCreate: "/api/v2/workTimes/changeRequests",
  changeRequestApprove: (id) => `/api/v3/workTimes/changeRequests/${id}/approve`, // v3, not v2
  entries: "/api/v2/entries",
  entry: (id) => `/api/v2/entries/${id}`,
  customers: "/api/v3/customers",
  services: "/api/v4/services",
};

// WorkTimeChangeRequestIntervalType.Add === 1 (Remove === 2) — a number, not a string.
const INTERVAL_ADD = 1;

// ---------------------------------------------------------------------------
// Config storage
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  apiUser: "",          // Clockodo login email
  apiKey: "",           // personal API key from My area
  usersId: null,        // resolved via /users/me
  userName: "",         // display name cached from /users/me
  // "entry" is the default: accounts that derive attendance from time entries
  // reject standalone working-time change requests.
  mode: "entry",        // "entry" (time entries) | "worktime" (change request)
  autoApprove: true,    // worktime mode: try to approve the change request immediately

  // "fixed": book `blocks` as configured. "random": per day, pick a start time
  // inside [randomEarliestStart, randomLatestStart] and book exactly
  // randomTotalMinutes of work, split around a break of randomBreakMinutes
  // (± randomBreakJitter; 0 = one block). Every run draws fresh values.
  scheduleMode: "fixed",
  blocks: [{ start: "09:00", end: "17:00" }], // fixed mode, user's timezone, 24h "HH:MM"
  randomTotalMinutes: 480,
  randomBreakMinutes: 60,
  randomBreakJitter: 10,
  randomEarliestStart: "08:00",
  randomLatestStart: "09:30",
  timezone: "Europe/Berlin", // IANA zone used for blocks, autoTime, "today" and weekends

  skipWeekends: true,
  skipDates: [],        // ["2026-09-18", ...] days to never fill
  autoDaily: false,     // run automatically every workday
  autoTime: "09:15",    // when the daily alarm fires (in `timezone`)
  checkUpdates: true,   // daily "new version" check against the public GitHub repo

  // entry mode only
  customersId: null,
  servicesId: null,
  billable: 0,
};

export async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...migrateStoredConfig(config || {}) };
}

// 1.0.x stored two fixed blocks as block1Start/End + block2Start/End.
// Must run on the raw stored object, before defaults are merged in.
function migrateStoredConfig(stored) {
  const { block1Start, block1End, block2Start, block2End, appName, ...rest } = stored;
  if (!Array.isArray(rest.blocks) || rest.blocks.length === 0) {
    const legacy = [[block1Start, block1End], [block2Start, block2End]]
      .filter(([s, e]) => s && e)
      .map(([start, end]) => ({ start, end }));
    if (legacy.length) rest.blocks = legacy;
  }
  return rest;
}

export async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------
const REQUEST_TIMEOUT_MS = 30000;

function headers(cfg) {
  return {
    "X-ClockodoApiUser": cfg.apiUser,
    "X-ClockodoApiKey": cfg.apiKey,
    "X-Clockodo-External-Application": EXTERNAL_APPLICATION,
    // Makes the API accept/return ISO-8601 UTC timestamps (what wallclockToUTC produces).
    "X-ClockodoEnableIsoUtcDateTimes": "1",
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function request(cfg, method, path, body) {
  if (!cfg.apiUser || !cfg.apiKey) {
    throw new Error("Not configured: enter your Clockodo email and API key in Options.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: headers(cfg),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Clockodo request timed out." : `Network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Clockodo ${res.status} on ${method} ${path}: ${extractErrorMessage(data) || res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Clockodo error bodies vary by endpoint: {error: "..."},
// {error: {message: "..."}}, {message: "..."}, or {errors: [{message}, ...]}.
function extractErrorMessage(data) {
  if (!data) return null;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") return data.error.message || JSON.stringify(data.error);
  if (typeof data.message === "string") return data.message;
  if (Array.isArray(data.errors)) return data.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
  if (data.raw) return data.raw.slice(0, 300);
  return JSON.stringify(data);
}

// ---------------------------------------------------------------------------
// Dates & timezones (all DST-safe, independent of the machine's zone)
// ---------------------------------------------------------------------------
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatterCache = new Map();
function zoneFormatter(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  try { zoneFormatter(tz); return true; } catch { return false; }
}

function zoneParts(ms, timeZone) {
  const map = {};
  for (const p of zoneFormatter(timeZone).formatToParts(new Date(ms))) map[p.type] = p.value;
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return {
    weekday: map.weekday,
    // The zone's wall clock at `ms`, re-read as if it were UTC.
    asUTC: Date.UTC(+map.year, +map.month - 1, +map.day, hour, +map.minute, +map.second),
  };
}

// Wall-clock "HH:MM" on `dateStr` in `timeZone` → "YYYY-MM-DDTHH:MM:SSZ".
// Two passes so the offset is sampled at the target instant, which matters
// within a few hours of a DST transition.
export function wallclockToUTC(dateStr, hhmm, timeZone = "Europe/Berlin") {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const wall = Date.UTC(Y, M - 1, D, h, m, 0);
  let guess = wall - (zoneParts(wall, timeZone).asUTC - wall);
  guess = wall - (zoneParts(guess, timeZone).asUTC - guess);
  // Clockodo wants "Y-m-d\TH:i:s\Z" — no milliseconds.
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function todayStr(timeZone = "Europe/Berlin") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()); // en-CA gives YYYY-MM-DD
}

export function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + "T12:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

export function eachDate(fromStr, toStr) {
  const out = [];
  for (let d = fromStr; d <= toStr; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isWeekend(dateStr, timeZone = "Europe/Berlin") {
  // Probe local noon of that date so the weekday is right in every zone.
  const noon = Date.parse(wallclockToUTC(dateStr, "12:00", timeZone));
  const { weekday } = zoneParts(noon, timeZone);
  return weekday === "Sat" || weekday === "Sun";
}

export function shouldSkip(cfg, dateStr) {
  if (cfg.skipWeekends && isWeekend(dateStr, cfg.timezone)) return "weekend";
  if ((cfg.skipDates || []).includes(dateStr)) return "opted-out";
  return null;
}

export const MAX_BLOCKS = 6;
export const SCHEDULE_MODES = ["fixed", "random"];
const MAX_TOTAL_MINUTES = 16 * 60;
const MAX_BREAK_MINUTES = 4 * 60;

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

// Returns an error message, or null when the schedule is usable.
export function validateSchedule(cfg) {
  if (!isValidTimeZone(cfg.timezone)) return `Unknown timezone "${cfg.timezone}".`;
  if (!SCHEDULE_MODES.includes(cfg.scheduleMode)) return `Unknown schedule mode "${cfg.scheduleMode}".`;
  return cfg.scheduleMode === "random" ? validateRandomSchedule(cfg) : validateFixedBlocks(cfg.blocks);
}

function validateRandomSchedule(cfg) {
  const total = cfg.randomTotalMinutes;
  const brk = cfg.randomBreakMinutes;
  if (!Number.isInteger(total) || total < 1 || total > MAX_TOTAL_MINUTES) {
    return `Total work time must be between 1 minute and ${MAX_TOTAL_MINUTES / 60} hours.`;
  }
  if (!Number.isInteger(brk) || brk < 0 || brk > MAX_BREAK_MINUTES) {
    return `Break must be between 0 and ${MAX_BREAK_MINUTES / 60} hours.`;
  }
  const jitter = cfg.randomBreakJitter ?? 0;
  if (!Number.isInteger(jitter) || jitter < 0 || jitter > 120) {
    return "Break variation must be between 0 and 120 minutes.";
  }
  if (brk > 0 && jitter >= brk) return "Break variation must be smaller than the break itself.";
  if (!HHMM_RE.test(cfg.randomEarliestStart || "") || !HHMM_RE.test(cfg.randomLatestStart || "")) {
    return "Start window times must be HH:MM.";
  }
  const earliest = toMinutes(cfg.randomEarliestStart);
  const latest = toMinutes(cfg.randomLatestStart);
  if (earliest > latest) return "Earliest start must not be after latest start.";
  if (latest + total + brk + jitter > 24 * 60) {
    return `Latest start ${cfg.randomLatestStart} + ${toHHMM(total + brk + jitter)} of work and break runs past midnight.`;
  }
  return null;
}

function validateFixedBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "Add at least one working block.";
  if (blocks.length > MAX_BLOCKS) return `At most ${MAX_BLOCKS} blocks per day.`;
  for (let i = 0; i < blocks.length; i++) {
    const { start, end } = blocks[i] || {};
    if (!HHMM_RE.test(start || "") || !HHMM_RE.test(end || "")) return `Block ${i + 1}: times must be HH:MM.`;
    if (start >= end) return `Block ${i + 1}: start must be before end.`;
    if (i > 0 && blocks[i - 1].end > start) {
      return `Block ${i + 1} overlaps block ${i}. Blocks must be in order and not overlap.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Blocks for a given day (fixed, or generated for random mode)
// ---------------------------------------------------------------------------
// Uniform integer in [min, max].
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Fresh random values on every call: start inside the window, exact total,
// break = base ± jitter, morning share 35–65 % of the total.
export function randomBlocks(cfg) {
  const earliest = toMinutes(cfg.randomEarliestStart);
  const latest = toMinutes(cfg.randomLatestStart);
  const total = cfg.randomTotalMinutes;
  const jitter = cfg.randomBreakJitter ?? 0;
  const brk = cfg.randomBreakMinutes > 0
    ? Math.max(1, cfg.randomBreakMinutes + randInt(-jitter, jitter))
    : 0;

  const start = randInt(earliest, latest);
  if (brk === 0 || total < 2) {
    return [{ start: toHHMM(start), end: toHHMM(start + total) }];
  }
  const morning = Math.min(total - 1, Math.max(1, Math.round(total * (0.35 + Math.random() * 0.30))));
  const afternoonStart = start + morning + brk;
  return [
    { start: toHHMM(start), end: toHHMM(start + morning) },
    { start: toHHMM(afternoonStart), end: toHHMM(afternoonStart + (total - morning)) },
  ];
}

export function blocksForDay(cfg) {
  return cfg.scheduleMode === "random" ? randomBlocks(cfg) : cfg.blocks;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export async function testConnectionAndResolveUser(cfg) {
  const data = await request(cfg, "GET", EP.me);
  const me = data.user || data.data || data;
  const usersId = Number(me && me.id);
  if (!Number.isInteger(usersId)) {
    throw new Error("Connected, but could not read your user record from the API response.");
  }
  return { usersId, name: me.name || me.email || cfg.apiUser };
}

// ---------------------------------------------------------------------------
// Customers / services (entry-mode picker in Options)
// ---------------------------------------------------------------------------
async function requestAllPages(cfg, path, listKey) {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await request(cfg, "GET", `${path}?page=${page}`);
    const items = data[listKey] || data.data;
    if (!Array.isArray(items)) throw new Error(`Unexpected response from ${path}: no "${listKey}" list.`);
    out.push(...items);
    const pages = data.paging && data.paging.count_pages;
    if (!pages || page >= pages) return out;
  }
}

const activeNamed = (items) =>
  items.filter((x) => x.active !== false).map((x) => ({ id: x.id, name: x.name }));

export async function getCustomers(cfg) {
  return activeNamed(await requestAllPages(cfg, EP.customers, "customers"));
}

export async function getServices(cfg) {
  return activeNamed(await requestAllPages(cfg, EP.services, "services"));
}

// ---------------------------------------------------------------------------
// Existing bookings (duplicate protection / replace)
// ---------------------------------------------------------------------------
// All of these throw (fail closed) on any error or unexpected shape — better
// to abort than to double-book.

// Local calendar date of an ISO timestamp, in cfg.timezone.
function localDateOf(iso, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso));
}

// Entry mode: the user's time entries in [fromStr, toStr] → Map<date, entryId[]>.
export async function getExistingEntries(cfg, fromStr, toStr) {
  const since = wallclockToUTC(fromStr, "00:00", cfg.timezone);
  const until = wallclockToUTC(toStr, "23:59", cfg.timezone);
  const path = `${EP.entries}?time_since=${encodeURIComponent(since)}&time_until=${encodeURIComponent(until)}` +
    `&filter[users_id]=${encodeURIComponent(cfg.usersId)}`;
  const byDate = new Map();
  for (let page = 1; ; page++) {
    const data = await request(cfg, "GET", `${path}&page=${page}`);
    if (!Array.isArray(data.entries)) throw new Error("Unexpected response from entries: no entries list.");
    for (const e of data.entries) {
      if (!e.time_since) continue;
      const day = localDateOf(e.time_since, cfg.timezone);
      if (!byDate.has(day)) byDate.set(day, []);
      byDate.get(day).push(e.id);
    }
    const pages = data.paging && data.paging.count_pages;
    if (!pages || page >= pages) return byDate;
  }
}

// Worktime mode: dates in [fromStr, toStr] that already have working time.
async function getFilledWorkTimeDays(cfg, fromStr, toStr) {
  // workTimes takes plain calendar dates (YYYY-MM-DD), not timestamps.
  const path = `${EP.workTimes}?users_id=${encodeURIComponent(cfg.usersId)}` +
    `&date_since=${fromStr}&date_until=${toStr}`;
  const filled = new Set();
  for (let page = 1; ; page++) {
    const data = await request(cfg, "GET", `${path}&page=${page}`);
    if (!Array.isArray(data.work_time_days)) throw new Error("Unexpected response from workTimes: no work_time_days.");
    for (const d of data.work_time_days) {
      if (Array.isArray(d.work_time_intervals) && d.work_time_intervals.length > 0) filled.add(d.date);
    }
    const pages = data.paging && data.paging.count_pages;
    if (!pages || page >= pages) return filled;
  }
}

// Map<date, entryId[]> of what already exists. In worktime mode the id lists
// are empty (nothing we could delete), only the keys matter.
export async function getExisting(cfg, fromStr, toStr) {
  if (cfg.mode === "entry") return getExistingEntries(cfg, fromStr, toStr);
  const filled = await getFilledWorkTimeDays(cfg, fromStr, toStr);
  return new Map([...filled].map((d) => [d, []]));
}

export async function hasWorkTime(cfg, dateStr) {
  return (await getExisting(cfg, dateStr, dateStr)).has(dateStr);
}

async function deleteEntries(cfg, ids) {
  for (const id of ids) await request(cfg, "DELETE", EP.entry(id));
}

// ---------------------------------------------------------------------------
// Fill one day
// ---------------------------------------------------------------------------
export function assertFillable(cfg) {
  if (!Number.isInteger(cfg.usersId)) {
    throw new Error("User not resolved yet — run \"Test connection\" in Options.");
  }
  const scheduleError = validateSchedule(cfg);
  if (scheduleError) throw new Error(scheduleError);
  if (cfg.mode === "entry" && (!Number.isInteger(cfg.customersId) || !Number.isInteger(cfg.servicesId))) {
    throw new Error(
      "Entry mode needs a customer and a service. Open Options → What to book → " +
        "\"Load customers & services\", pick both, then Save."
    );
  }
}

export const ON_EXISTING = ["skip", "replace"];

// opts.onExisting: "skip" (default) → report "exists"; "replace" → delete that
//   day's existing time entries (entry mode only) and book again.
// opts.force: ignore weekend/opt-out rules and the existing check entirely.
// opts.existing: optional Map<date, entryId[]> already fetched by the caller (range fills).
export async function fillDay(cfg, dateStr, { force = false, onExisting = "skip", existing = null } = {}) {
  assertFillable(cfg);

  const skip = shouldSkip(cfg, dateStr);
  if (skip && !force) return { dateStr, status: "skipped", reason: skip };

  let replaced = 0;
  if (!force) {
    const found = existing || (await getExisting(cfg, dateStr, dateStr));
    if (found.has(dateStr)) {
      const ids = found.get(dateStr);
      if (onExisting !== "replace") return { dateStr, status: "exists" };
      if (cfg.mode !== "entry") {
        throw new Error("Replace is only available in time-entry mode; working-time change requests cannot be removed here.");
      }
      await deleteEntries(cfg, ids);
      replaced = ids.length;
    }
  }

  const blocks = blocksForDay(cfg);
  const result = cfg.mode === "entry"
    ? await fillDayAsEntries(cfg, dateStr, blocks)
    : await fillDayAsWorkTime(cfg, dateStr, blocks);
  result.blocks = blocks;
  return replaced ? { ...result, status: "replaced", replaced } : result;
}

async function fillDayAsWorkTime(cfg, dateStr, blocks) {
  const changes = blocks.map(({ start, end }) => ({
    type: INTERVAL_ADD,
    time_since: wallclockToUTC(dateStr, start, cfg.timezone),
    time_until: wallclockToUTC(dateStr, end, cfg.timezone),
  }));

  const created = await request(cfg, "POST", EP.changeRequestCreate, {
    date: dateStr,
    users_id: cfg.usersId,
    changes,
  });
  const cr = created && (created.work_times_change_request || created.data || created);
  const id = cr && cr.id != null ? cr.id : null;

  let approved = false;
  let approveError = null;
  if (cfg.autoApprove) {
    if (id == null) {
      approveError = "could not read the change-request id from the response";
    } else {
      try {
        await request(cfg, "POST", EP.changeRequestApprove(id), {});
        approved = true;
      } catch (e) {
        approveError = e.message; // no approval rights → request stays pending; not fatal
      }
    }
  }
  return { dateStr, status: "created", approved, id, approveError };
}

// Creates one entry per block. If a later block fails, already-created entries
// are deleted again so the day is never left half-booked (which the duplicate
// check would otherwise report as "already filled").
async function fillDayAsEntries(cfg, dateStr, blocks) {
  const ids = [];
  try {
    for (const { start, end } of blocks) {
      const created = await request(cfg, "POST", EP.entries, {
        customers_id: cfg.customersId,
        services_id: cfg.servicesId,
        billable: cfg.billable,
        time_since: wallclockToUTC(dateStr, start, cfg.timezone),
        time_until: wallclockToUTC(dateStr, end, cfg.timezone),
      });
      const id = created && created.entry && created.entry.id;
      if (id == null) throw new Error("Entry created but the response had no id; cannot continue safely.");
      ids.push(id);
    }
  } catch (e) {
    const rolledBack = await rollbackEntries(cfg, ids);
    if (ids.length && !rolledBack) {
      e.message += ` — ${ids.length} block(s) were created before the failure and could NOT be removed; check ${dateStr} in Clockodo.`;
    } else if (ids.length) {
      e.message += ` — the ${ids.length} block(s) created before the failure were removed again.`;
    }
    throw e;
  }
  return { dateStr, status: "created", ids };
}

async function rollbackEntries(cfg, ids) {
  let ok = true;
  for (const id of ids) {
    try { await request(cfg, "DELETE", EP.entry(id)); } catch { ok = false; }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Range fill
// ---------------------------------------------------------------------------
export async function fillRange(cfg, fromStr, toStr, { force = false, onExisting = "skip" } = {}) {
  assertFillable(cfg);
  const dates = eachDate(fromStr, toStr);
  const existing = force ? null : await getExisting(cfg, fromStr, toStr);
  const results = [];
  for (const dateStr of dates) {
    try {
      results.push(await fillDay(cfg, dateStr, { force, onExisting, existing }));
    } catch (e) {
      results.push({ dateStr, status: "error", error: e.message });
    }
  }
  return results;
}
