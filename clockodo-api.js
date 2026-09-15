// clockodo-api.js
// Thin wrapper around the Clockodo REST API used by the extension.
// Docs: https://docs.clockodo.com/   (see also README.md "Adjusting endpoints")
//
// Auth uses a personal API key (NOT your password). Each user pastes their own
// key once in the options page. The key is stored only in chrome.storage.local
// on their own machine and is sent only to my.clockodo.com.

// ---------------------------------------------------------------------------
// Endpoint configuration — adjust here if Clockodo changes paths.
// ---------------------------------------------------------------------------
export const BASE = "https://my.clockodo.com";

const EP = {
  // v2/users was retired by Clockodo (410 Gone). v4/users/me returns the
  // authenticated user directly — no listing/pagination needed.
  me: "/api/v4/users/me",
  // Working-times change request (create + approve). Confirmed against the
  // official `clockodo` npm SDK (peerigon/clockodo): create is v2, but the
  // approve action was moved to v3.
  changeRequestCreate: "/api/v2/workTimes/changeRequests",
  changeRequestApprove: (id) => `/api/v3/workTimes/changeRequests/${id}/approve`,
  // Fallback mode: plain time entries (Zeiterfassung). Well documented, needs
  // no approval. Used when config.mode === "entry".
  entries: "/api/v2/entries",
  customers: "/api/v3/customers",
  services: "/api/v4/services",
};

// Interval type sent in a working-times change request.
// WorkTimeChangeRequestIntervalType.Add === 1 (Remove === 2) — a number, not a string.
const INTERVAL_ADD = 1;

// ---------------------------------------------------------------------------
// Config storage
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  apiUser: "",          // your Clockodo login email
  apiKey: "",           // personal API key from My area
  appName: "ClockodoAutoFill", // for X-Clockodo-External-Application
  usersId: null,        // resolved automatically from apiUser
  // "entry" is the default: this org rejects standalone working-time change
  // requests ("Work times must match the day's entries") — attendance is
  // derived from time entries, so entries must be created directly.
  mode: "entry",        // "worktime" (attendance) | "entry" (time entries)
  autoApprove: true,    // try to approve the change request immediately

  // Configurable hours (local Berlin wall-clock, 24h "HH:MM")
  block1Start: "08:30",
  block1End: "13:00",
  block2Start: "14:00",
  block2End: "17:30",
  // (The break is simply the gap between block1End and block2Start.)

  timezone: "Europe/Berlin",

  // Behaviour
  skipWeekends: true,
  skipDates: [],        // ["2026-09-18", ...] days to never fill
  autoDaily: false,     // run automatically every workday
  autoTime: "09:15",    // when the daily alarm fires (local)

  // For "entry" mode only:
  customersId: null,
  servicesId: null,
  billable: 0,
};

export async function loadConfig() {
  const stored = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config || {}) };
}

export async function saveConfig(patch) {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

// ---------------------------------------------------------------------------
// Low-level request
// ---------------------------------------------------------------------------
function headers(cfg) {
  return {
    "X-ClockodoApiUser": cfg.apiUser,
    "X-ClockodoApiKey": cfg.apiKey,
    "X-Clockodo-External-Application": `${cfg.appName};${cfg.apiUser}`.slice(0, 50),
    // Matches the official SDK's default: makes the API accept/return ISO-8601
    // UTC timestamps (what wallclockToUTC() produces) instead of its legacy format.
    "X-ClockodoEnableIsoUtcDateTimes": "1",
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function request(cfg, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(cfg),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = extractErrorMessage(data) || res.statusText;
    const err = new Error(`Clockodo ${res.status} on ${method} ${path}: ${msg}`);
    err.status = res.status;
    err.data = data;
    err.path = path;
    throw err;
  }
  return data;
}

// Clockodo error bodies vary by endpoint: {error: "..."},
// {error: {message: "..."}}, {message: "..."}, or {errors: [{message}, ...]}.
function extractErrorMessage(data) {
  if (!data) return null;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") {
    return data.error.message || JSON.stringify(data.error);
  }
  if (typeof data.message === "string") return data.message;
  if (Array.isArray(data.errors)) {
    return data.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
  }
  if (data.raw) return data.raw.slice(0, 300);
  return JSON.stringify(data);
}

// ---------------------------------------------------------------------------
// Timezone: Berlin wall-clock -> UTC ISO (DST-safe, independent of machine tz)
// ---------------------------------------------------------------------------
export function wallclockToUTC(dateStr, hhmm, timeZone = "Europe/Berlin") {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const asUTC = Date.UTC(Y, M - 1, D, h, m, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(asUTC));
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  const hh = map.hour === "24" ? 0 : Number(map.hour);
  const tzAsUTC = Date.UTC(+map.year, +map.month - 1, +map.day, hh, +map.minute, +map.second);
  const offset = tzAsUTC - asUTC; // how far the zone is ahead of UTC (ms)
  // Clockodo wants "Y-m-d\TH:i:s\Z" — no milliseconds.
  return new Date(asUTC - offset).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Connection test + resolve own user id
// ---------------------------------------------------------------------------
export async function testConnectionAndResolveUser(cfg) {
  const data = await request(cfg, "GET", EP.me);
  const me = data.user || data.data || data;
  if (!me || me.id == null) {
    throw new Error("Connected, but could not read your user record from the API response.");
  }
  return { usersId: me.id, name: me.name || me.email, me };
}

// ---------------------------------------------------------------------------
// Customers / services (for "entry" mode picker in Options)
// ---------------------------------------------------------------------------
async function requestAllPages(cfg, path) {
  const out = [];
  let page = 1;
  for (;;) {
    const data = await request(cfg, "GET", `${path}?page=${page}`);
    const items = data.data || data.customers || data.services || [];
    out.push(...items);
    const paging = data.paging || {};
    if (!paging.count_pages || page >= paging.count_pages) break;
    page += 1;
  }
  return out;
}

export async function getCustomers(cfg) {
  const customers = await requestAllPages(cfg, EP.customers);
  return customers
    .filter((c) => c.active !== false)
    .map((c) => ({ id: c.id, name: c.name }));
}

export async function getServices(cfg) {
  const services = await requestAllPages(cfg, EP.services);
  return services
    .filter((s) => s.active !== false)
    .map((s) => ({ id: s.id, name: s.name }));
}

// ---------------------------------------------------------------------------
// Non-business day helpers
// ---------------------------------------------------------------------------
export function isWeekend(dateStr, timeZone = "Europe/Berlin") {
  const dow = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(new Date(dateStr + "T12:00:00Z"));
  return dow === "Sat" || dow === "Sun";
}

export function shouldSkip(cfg, dateStr) {
  if (cfg.skipWeekends && isWeekend(dateStr, cfg.timezone)) return "weekend";
  if ((cfg.skipDates || []).includes(dateStr)) return "opted-out";
  return null;
}

// ---------------------------------------------------------------------------
// Check whether a working time already exists for a date (avoid duplicates)
// ---------------------------------------------------------------------------
export async function hasWorkTime(cfg, dateStr) {
  try {
    const path = `/api/v2/workTimes?users_id=${cfg.usersId}` +
      `&date_since=${dateStr}T00:00:00Z&date_until=${dateStr}T23:59:59Z`;
    const data = await request(cfg, "GET", path);
    const days = data.work_time_days || data.workTimeDays || [];
    return days.some((d) => (d.work_time_intervals || d.workTimeInterval || []).length > 0);
  } catch {
    return false; // if the check fails, let the insert proceed
  }
}

// ---------------------------------------------------------------------------
// Fill one day
// ---------------------------------------------------------------------------
export async function fillDay(cfg, dateStr, { force = false } = {}) {
  const skip = shouldSkip(cfg, dateStr);
  if (skip && !force) return { dateStr, status: "skipped", reason: skip };

  if (!force && (await hasWorkTime(cfg, dateStr))) {
    return { dateStr, status: "exists" };
  }

  if (cfg.mode === "entry") return fillDayAsEntries(cfg, dateStr);
  return fillDayAsWorkTime(cfg, dateStr);
}

async function fillDayAsWorkTime(cfg, dateStr) {
  const tz = cfg.timezone;
  const changes = [
    {
      type: INTERVAL_ADD,
      time_since: wallclockToUTC(dateStr, cfg.block1Start, tz),
      time_until: wallclockToUTC(dateStr, cfg.block1End, tz),
    },
    {
      type: INTERVAL_ADD,
      time_since: wallclockToUTC(dateStr, cfg.block2Start, tz),
      time_until: wallclockToUTC(dateStr, cfg.block2End, tz),
    },
  ];

  const created = await request(cfg, "POST", EP.changeRequestCreate, {
    date: dateStr,
    users_id: cfg.usersId,
    changes,
  });

  const id =
    (created &&
      (created.id ||
        (created.data && created.data.id) ||
        (created.work_times_change_request && created.work_times_change_request.id))) ||
    null;

  let approved = false;
  let approveError = null;
  if (cfg.autoApprove) {
    if (id == null) {
      approveError = `couldn't read change-request id from response: ${JSON.stringify(created)}`;
      console.warn("[Clockodo Auto-Fill]", approveError);
    } else {
      try {
        await request(cfg, "POST", EP.changeRequestApprove(id), {});
        approved = true;
      } catch (e) {
        // No approval rights -> request stays pending. Not fatal.
        approveError = e.message;
        console.warn("[Clockodo Auto-Fill] approve failed:", e.message);
      }
    }
  }
  return { dateStr, status: "created", approved, id, approveError };
}

async function fillDayAsEntries(cfg, dateStr) {
  const tz = cfg.timezone;
  const blocks = [
    [cfg.block1Start, cfg.block1End],
    [cfg.block2Start, cfg.block2End],
  ];
  const ids = [];
  for (const [start, end] of blocks) {
    const created = await request(cfg, "POST", EP.entries, {
      customers_id: cfg.customersId,
      services_id: cfg.servicesId,
      billable: cfg.billable,
      time_since: wallclockToUTC(dateStr, start, tz),
      time_until: wallclockToUTC(dateStr, end, tz),
    });
    ids.push((created && created.entry && created.entry.id) || null);
  }
  return { dateStr, status: "created", ids };
}

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------
export function eachDate(fromStr, toStr) {
  const out = [];
  let d = new Date(fromStr + "T12:00:00Z");
  const end = new Date(toStr + "T12:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  return out;
}

export function todayStr(timeZone = "Europe/Berlin") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

export async function fillRange(cfg, fromStr, toStr, opts = {}) {
  const results = [];
  for (const dateStr of eachDate(fromStr, toStr)) {
    try {
      results.push(await fillDay(cfg, dateStr, opts));
    } catch (e) {
      results.push({ dateStr, status: "error", error: e.message });
    }
  }
  return results;
}
