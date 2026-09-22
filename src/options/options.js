// options.js
import {
  loadConfig, saveConfig, validateSchedule, randomBlocks, isWeekend, todayStr, addDays,
  toMinutes, toHHMM, HHMM_RE, MAX_BLOCKS, isValidTimeZone,
} from "../lib/clockodo-api.js";
import { getActivity, clearActivity, activityToCsv, renameDevice } from "../lib/activity.js";
import { confirmDialog } from "../lib/dialog.js";

const $ = (id) => document.getElementById(id);

// apiKey is handled separately: the stored key is never written back into the DOM.
const TEXT_FIELDS = ["apiUser", "mode", "autoTime", "randomEarliestStart", "randomLatestStart"];
const CHECKBOXES = ["autoApprove", "billable", "skipWeekends", "skipHolidays", "autoDaily", "checkUpdates", "syncSettings", "syncApiKey", "rememberKey"];

let skipDates = [];
let blocks = [];
let blockRows = []; // { dur, chip } per block, in order
let savedCustomersId = null;
let savedServicesId = null;

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
const fmtDuration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};
const isValidBlock = (b) => HHMM_RE.test(b.start) && HHMM_RE.test(b.end) && b.start < b.end;

// ---------------------------------------------------------------------------
// Working blocks
// ---------------------------------------------------------------------------
function timeInput(block, key, label) {
  const wrap = document.createElement("div");
  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "time";
  input.value = block[key];
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => { block[key] = input.value; refreshBlockDerived(); });
  wrap.append(lbl, input);
  return wrap;
}

function renderTimeline() {
  const bar = $("timelineBar");
  const axis = $("timelineAxis");
  bar.innerHTML = "";
  axis.innerHTML = "";
  const valid = [...blocks.filter(isValidBlock)].sort((a, b) => a.start.localeCompare(b.start));
  if (!valid.length) return;

  // Fit the axis to the day with 1 h padding, snapped to whole hours.
  const first = toMinutes(valid[0].start);
  const last = Math.max(...valid.map((b) => toMinutes(b.end)));
  const from = Math.max(0, Math.floor(first / 60) * 60 - 60);
  const to = Math.min(24 * 60, Math.ceil(last / 60) * 60 + 60);
  const span = to - from || 1;
  const pct = (m) => ((m - from) / span) * 100;

  const segment = (cls, startMin, endMin, text, title) => {
    const seg = document.createElement("div");
    seg.className = cls;
    seg.style.left = `${pct(startMin)}%`;
    seg.style.width = `${pct(endMin) - pct(startMin)}%`;
    seg.textContent = text;
    seg.title = title;
    bar.appendChild(seg);
  };

  valid.forEach((b, i) => {
    const s = toMinutes(b.start);
    const e = toMinutes(b.end);
    segment("seg", s, e, fmtDuration(e - s), `${b.start} – ${b.end}`);
    const next = valid[i + 1];
    if (next && next.start > b.end) {
      const ns = toMinutes(next.start);
      segment("seg gap", e, ns, "break", `Break ${fmtDuration(ns - e)}`);
    }
  });

  const ticks = Math.max(1, Math.min(6, Math.round(span / 60)));
  for (let i = 0; i <= ticks; i++) {
    const t = document.createElement("span");
    t.textContent = toHHMM(from + Math.round((span * i) / ticks / 60) * 60);
    axis.appendChild(t);
  }
}

function refreshBlockDerived() {
  blocks.forEach((b, i) => {
    const { dur, chip } = blockRows[i];
    const ok = isValidBlock(b);
    dur.textContent = ok ? fmtDuration(toMinutes(b.end) - toMinutes(b.start)) : "invalid";
    dur.classList.toggle("bad", !ok);

    if (!chip) return;
    const next = blocks[i + 1];
    if (!ok || !HHMM_RE.test(next.start)) { chip.textContent = ""; return; }
    const gap = toMinutes(next.start) - toMinutes(b.end);
    chip.classList.toggle("bad", gap < 0);
    chip.textContent = gap < 0 ? "overlaps next block" : gap === 0 ? "no break" : `break ${fmtDuration(gap)}`;
  });

  const total = blocks.filter(isValidBlock)
    .reduce((sum, b) => sum + toMinutes(b.end) - toMinutes(b.start), 0);
  const badge = $("blocksTotal");
  badge.textContent = total ? `${fmtDuration(total)} / day` : "—";
  badge.classList.toggle("warn", total > 10 * 60);

  renderTimeline();
}

function renderBlocks() {
  const list = $("blocksList");
  list.innerHTML = "";
  blockRows = blocks.map((block, i) => {
    const row = document.createElement("div");
    row.className = "block-row";

    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(i + 1);

    const dur = document.createElement("span");
    dur.className = "dur";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove block";
    remove.disabled = blocks.length === 1;
    remove.addEventListener("click", () => {
      blocks.splice(i, 1);
      renderBlocks();
    });

    row.append(idx, timeInput(block, "start", "Start"), timeInput(block, "end", "End"), dur, remove);
    list.appendChild(row);

    let chip = null;
    if (i < blocks.length - 1) {
      chip = document.createElement("div");
      chip.className = "gap-chip";
      list.appendChild(chip);
    }
    return { dur, chip };
  });
  $("addBlockBtn").disabled = blocks.length >= MAX_BLOCKS;
  refreshBlockDerived();
}

$("addBlockBtn").addEventListener("click", () => {
  if (blocks.length >= MAX_BLOCKS) return;
  const last = blocks[blocks.length - 1];
  // Suggest a block starting one hour after the previous one ends.
  const start = last ? Math.min(toMinutes(last.end) + 60, 22 * 60) : 9 * 60;
  const end = Math.min(start + 4 * 60, 23 * 60 + 59);
  blocks.push({ start: toHHMM(start), end: toHHMM(end) });
  renderBlocks();
});

// ---------------------------------------------------------------------------
// Schedule mode (fixed blocks vs. random start with fixed duration)
// ---------------------------------------------------------------------------
const scheduleMode = () => document.querySelector('input[name="scheduleMode"]:checked')?.value || "fixed";

function toggleScheduleFields() {
  const random = scheduleMode() === "random";
  $("fixedFields").style.display = random ? "none" : "block";
  $("randomFields").style.display = random ? "block" : "none";
  if (random) renderRandomPreview();
}
for (const r of document.querySelectorAll('input[name="scheduleMode"]')) {
  r.addEventListener("change", toggleScheduleFields);
}

function randomSettings() {
  return {
    scheduleMode: "random",
    randomTotalMinutes: (Number($("randomTotalH").value) || 0) * 60 + (Number($("randomTotalM").value) || 0),
    randomBreakMinutes: Number($("randomBreakMinutes").value) || 0,
    randomBreakJitter: Number($("randomBreakJitter").value) || 0,
    randomEarliestStart: $("randomEarliestStart").value,
    randomLatestStart: $("randomLatestStart").value,
    timezone: $("timezone").value,
  };
}

function renderRandomPreview() {
  const list = $("randomPreview");
  const badge = $("randomTotalBadge");
  list.innerHTML = "";
  const cfg = randomSettings();
  badge.textContent = cfg.randomTotalMinutes ? `${fmtDuration(cfg.randomTotalMinutes)} / day` : "—";
  badge.classList.toggle("warn", cfg.randomTotalMinutes > 10 * 60);

  const error = validateSchedule({ ...cfg, blocks: [] });
  if (error) {
    const li = document.createElement("li");
    li.className = "day";
    li.textContent = error;
    list.appendChild(li);
    return;
  }

  // Sample for the next five workdays (each click draws new values, like a real run).
  let day = todayStr(cfg.timezone);
  let shown = 0;
  while (shown < 5) {
    if (!isWeekend(day, cfg.timezone)) {
      const blocks = randomBlocks(cfg);
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.className = "day";
      label.textContent = new Date(day + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const times = document.createElement("span");
      times.textContent = blocks.map((b) => `${b.start}–${b.end}`).join("  ·  ");
      li.append(label, times);
      list.appendChild(li);
      shown++;
    }
    day = addDays(day, 1);
  }
}

$("previewRandomBtn").addEventListener("click", renderRandomPreview);
for (const id of ["randomTotalH", "randomTotalM", "randomBreakMinutes", "randomBreakJitter", "randomEarliestStart", "randomLatestStart"]) {
  $(id).addEventListener("input", renderRandomPreview);
}

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------
// The selected zone always stays in the list (own group at the top) so typing
// in the search box can never silently change the saved value.
let allZones = null;
const zoneLabel = (tz) => tz.replace(/_/g, " ");
const zoneRegion = (tz) => (tz.includes("/") ? tz.split("/")[0] : "Other");

function renderTimezones(selected, filter = "") {
  const select = $("timezone");
  const current = selected || select.value;
  if (!allZones) allZones = Intl.supportedValuesOf("timeZone");
  const q = filter.trim().toLowerCase().replace(/\s+/g, "_");
  const zones = allZones.filter((z) => z !== current && (!q || z.toLowerCase().includes(q)));

  select.innerHTML = "";
  const selectedGroup = document.createElement("optgroup");
  selectedGroup.label = "Selected";
  selectedGroup.appendChild(new Option(zoneLabel(current), current));
  select.appendChild(selectedGroup);

  const groups = new Map();
  for (const z of zones) {
    const g = zoneRegion(z);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(z);
  }
  for (const [g, list] of groups) {
    const og = document.createElement("optgroup");
    og.label = q ? `${g} (${list.length})` : g;
    for (const z of list) og.appendChild(new Option(zoneLabel(z), z));
    select.appendChild(og);
  }
  if (q && !zones.length) {
    const none = new Option("No zone matches — try a city or region", "");
    none.disabled = true;
    select.appendChild(none);
  }
  select.value = current;
  updateTzPreview();
}

function tzNamePart(tz, style, now) {
  // en-GB yields real abbreviations (CEST, BST) where en-US falls back to GMT+2.
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: style })
    .formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "";
}

function updateTzPreview() {
  const tz = $("timezone").value;
  if (!isValidTimeZone(tz)) return;
  const now = new Date();
  $("tzTime").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now);
  let offset = tzNamePart(tz, "longOffset", now).replace("GMT", "UTC");
  if (offset === "UTC") offset = "UTC±00:00";
  $("tzOffset").textContent = offset;
  const dayText = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(now);
  // Zones without a real abbreviation come back as "GMT+3:30", which would just repeat the pill.
  const short = tzNamePart(tz, "short", now);
  const zoneName = /^(GMT|UTC)/.test(short) ? tzNamePart(tz, "long", now) : short;
  $("tzAbbr").textContent = `${zoneName} · ${dayText}`;

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const btn = $("tzUseBrowser");
  btn.hidden = !browserTz || browserTz === tz;
  btn.textContent = "Use browser zone";
  btn.title = browserTz ? `Switch to ${zoneLabel(browserTz)}` : "";
}

$("tzSearch").addEventListener("input", () => renderTimezones($("timezone").value, $("tzSearch").value));
$("tzSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("timezone").focus(); }
});
$("timezone").addEventListener("change", updateTzPreview);
$("tzUseBrowser").addEventListener("click", () => {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!isValidTimeZone(browserTz)) return;
  renderTimezones(browserTz, $("tzSearch").value);
});
setInterval(updateTzPreview, 30_000);

// ---------------------------------------------------------------------------
// Skip dates
// ---------------------------------------------------------------------------
function renderSkipList() {
  const ul = $("skipList");
  ul.innerHTML = "";
  if (skipDates.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No opted-out dates.";
    ul.appendChild(li);
    return;
  }
  for (const d of [...skipDates].sort()) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = d;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      skipDates = skipDates.filter((x) => x !== d);
      renderSkipList();
    });
    li.append(span, btn);
    ul.appendChild(li);
  }
}

$("addSkipBtn").addEventListener("click", () => {
  const v = $("skipDateInput").value;
  if (v && !skipDates.includes(v)) {
    skipDates.push(v);
    renderSkipList();
    $("skipDateInput").value = "";
  }
});

// ---------------------------------------------------------------------------
// Mode / pick lists
// ---------------------------------------------------------------------------
function toggleModeFields() {
  const entry = $("mode").value === "entry";
  $("entryFields").style.display = entry ? "block" : "none";
  $("worktimeFields").style.display = entry ? "none" : "block";
}
$("mode").addEventListener("change", toggleModeFields);

function fillSelect(select, items, savedId) {
  select.innerHTML = "";
  select.appendChild(new Option(items.length ? "Select…" : "No items found", ""));
  for (const item of items) select.appendChild(new Option(`${item.name} (#${item.id})`, String(item.id)));
  if (savedId != null) select.value = String(savedId);
}

// A select that was never populated (or whose saved id is not in the list)
// must not overwrite the saved id with null on Save.
function selectedId(select, savedId) {
  if (select.value) return Number(select.value);
  return select.options.length > 1 ? null : savedId;
}

$("loadCustomersServicesBtn").addEventListener("click", async () => {
  const el = $("loadResult");
  setStatus(el, "Loading…");
  try {
    const [customersRes, servicesRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: "listCustomers" }),
      chrome.runtime.sendMessage({ action: "listServices" }),
    ]);
    if (!customersRes.ok) throw new Error(customersRes.error);
    if (!servicesRes.ok) throw new Error(servicesRes.error);
    fillSelect($("customersId"), customersRes.customers, savedCustomersId);
    fillSelect($("servicesId"), servicesRes.services, savedServicesId);
    await chrome.storage.local.set({
      pickLists: { customers: customersRes.customers, services: servicesRes.services },
    });
    $("loadCustomersServicesBtn").textContent = "Reload customers & services";
    setStatus(el, `✓ Loaded ${customersRes.customers.length} customers, ${servicesRes.services.length} services.`, "ok");
    refreshSetupState();
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

// ---------------------------------------------------------------------------
// Setup state (which cards still need the user's attention)
// ---------------------------------------------------------------------------
async function refreshSetupState() {
  const cfg = await loadConfig();
  const keyPresent = Boolean(cfg.apiKey) || Boolean($("apiKey").value.trim());
  const accountOk = Boolean($("apiUser").value.trim()) && keyPresent && Number.isInteger(cfg.usersId);
  const entryMode = $("mode").value === "entry";
  const bookingOk = !entryMode || (Boolean($("customersId").value) && Boolean($("servicesId").value));

  const mark = (card, badge, ok, todoText) => {
    card.classList.toggle("needs-setup", !ok);
    badge.className = `setup-badge ${ok ? "ok" : "todo"}`;
    badge.textContent = ok ? "Ready ✓" : todoText;
  };
  mark($("accountCard"), $("accountBadge"), accountOk,
    !$("apiUser").value.trim() || !keyPresent ? "Not set up" : "Not logged in");
  mark($("bookingCard"), $("bookingBadge"), bookingOk, "Pick customer & service");
  document.querySelector('.tab[data-tab="account"]').classList.toggle("attention", !(accountOk && bookingOk));

  const loggedIn = Boolean(cfg.usersId);
  $("testBtn").hidden = loggedIn;
  $("signOutBtn").hidden = !loggedIn;
  $("deleteLoginBtn").hidden = !loggedIn;
}

$("signOutBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Sign out?",
    message: "Disconnects this device and switches off auto-fill. Your email and API key stay saved — sign back in any time with Log in.",
    confirmText: "Sign out",
  });
  if (!ok) return;
  const res = await chrome.runtime.sendMessage({ action: "signOut" });
  if (!res.ok) return setStatus($("testResult"), `✗ ${res.error}`, "bad");
  location.reload();
});

$("deleteLoginBtn").addEventListener("click", async () => {
  const cfg = await loadConfig();
  const ok = await confirmDialog({
    title: "Delete login data?",
    message: `This permanently deletes your saved login (${cfg.apiUser || "email"}), the API key, your Clockodo user id and the selected customer/service from this device. Working hours, schedule and other preferences are kept.`,
    details: [
      "Auto-fill is switched off until you sign in again",
      "The activity log is cleared, on this device and every synced device",
      cfg.syncApiKey ? "The key is also removed from your synced settings" : "Other synced devices keep their own login",
      "To fully revoke access, also regenerate the key in Clockodo → My area → Edit self",
    ],
    confirmText: "Delete login data",
    danger: true,
  });
  if (!ok) return;
  const res = await chrome.runtime.sendMessage({ action: "deleteLoginData" });
  if (!res.ok) return setStatus($("testResult"), `✗ ${res.error}`, "bad");
  activityCache = [];
  location.reload();
});
for (const id of ["apiUser", "apiKey", "mode", "customersId", "servicesId"]) {
  $(id).addEventListener("input", refreshSetupState);
  $(id).addEventListener("change", refreshSetupState);
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------
// The saved key is shown only as a masked hint; the field stays empty until the
// user types a replacement, so nothing sensitive sits in the page.
function showKeyState(cfg) {
  const input = $("apiKey");
  input.value = "";
  if (cfg.apiKey) {
    const tail = cfg.apiKey.slice(-4);
    input.placeholder = `Saved · ends in …${tail} — type a new key to replace it`;
    $("apiKeyHint").textContent = "A key is stored on this device. Leave the field empty to keep it.";
  } else {
    input.placeholder = "Paste from My area → Edit self";
    $("apiKeyHint").textContent = "";
  }
}

function credentialPatch() {
  const patch = { apiUser: $("apiUser").value.trim(), rememberKey: $("rememberKey").checked };
  const key = $("apiKey").value.trim();
  if (key) patch.apiKey = key;
  return patch;
}

function refreshRememberHint() {
  const on = $("rememberKey").checked;
  $("rememberHint").textContent = on
    ? ""
    : "Off: the key is kept only until Chrome closes. Auto-fill will pause after a restart until you enter the key again; the key is never synced.";
  $("syncApiKey").disabled = !on || !$("syncSettings").checked;
  if (!on) $("syncApiKey").checked = false;
}
$("rememberKey").addEventListener("change", refreshRememberHint);

$("testBtn").addEventListener("click", async () => {
  const el = $("testResult");
  setStatus(el, "Testing…");
  const next = await saveConfig(credentialPatch());
  showKeyState(next);
  try {
    const res = await chrome.runtime.sendMessage({ action: "testConnection" });
    if (res.ok) setStatus(el, `✓ Connected as ${res.name} (id ${res.usersId})`, "ok");
    else setStatus(el, `✗ ${res.error}`, "bad");
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
  refreshSetupState();
  loadHolidayInfo();
});

// ---------------------------------------------------------------------------
// Public holidays (read from the user's Clockodo holiday calendar)
// ---------------------------------------------------------------------------
const fmtHolidayDate = (dateStr) =>
  new Date(dateStr + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

// Fills both the Schedule-tab hint and the Account-card summary line.
async function loadHolidayInfo() {
  const el = $("holidayInfo");
  const acct = $("accountInfo");
  const regionEl = $("acctRegion");
  const noteEl = $("acctRegionNote");
  const cfg = await loadConfig();
  el.classList.remove("bad");
  const setRegion = (text, missing, note) => {
    regionEl.textContent = text;
    regionEl.className = `pill ${missing ? "missing" : "region"}`;
    noteEl.textContent = note;
  };

  if (!cfg.usersId) {
    el.textContent = "Log in first — the calendar comes from your Clockodo account.";
    acct.hidden = true;
    return;
  }
  acct.hidden = false;
  $("acctWho").textContent = `${cfg.userName || cfg.apiUser} · id ${cfg.usersId}`;
  el.textContent = "Loading your Clockodo holiday calendar…";
  setRegion("loading…", false, "");

  const res = await chrome.runtime.sendMessage({ action: "holidayCalendar" });
  if (!res.ok) {
    el.textContent = `Could not load the calendar: ${res.error}`;
    el.classList.add("bad");
    setRegion("unavailable", true, res.error);
    return;
  }
  const cal = res.calendar;
  if (!cal.assigned) {
    el.textContent = "No holiday calendar is assigned to you in Clockodo — ask your admin, otherwise nothing is skipped.";
    el.classList.add("bad");
    setRegion("not assigned", true, "ask your Clockodo admin to assign one");
    return;
  }
  const region = cal.groupName || `calendar #${cal.groupId}`;
  const countText = `${cal.count} holiday${cal.count === 1 ? "" : "s"} in ${cal.year}`;

  el.replaceChildren();
  const chip = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; return s; };
  el.append(chip("pill region", region), chip("", countText));
  if (cal.next) {
    const next = chip("pill next", "Next: ");
    const b = document.createElement("b");
    b.textContent = `${cal.next.name} · ${fmtHolidayDate(cal.next.date)}`;
    next.append(b);
    el.append(chip("sep", "·"), next);
  }
  setRegion(region, false, `${countText} · set by your Clockodo admin`);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const TAB_KEY = "clockodo-options-tab";

function showTab(name) {
  let found = false;
  for (const panel of document.querySelectorAll(".tab-panel")) {
    const on = panel.dataset.tab === name;
    panel.classList.toggle("active", on);
    found ||= on;
  }
  if (!found) return showTab("account");
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", String(on));
  }
  try { localStorage.setItem(TAB_KEY, name); } catch { /* ignore */ }
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
}

// Tab that contains a given element (used to jump to validation errors).
const tabOf = (el) => el.closest(".tab-panel")?.dataset.tab || "account";

let initialTab = "account";
try { initialTab = localStorage.getItem(TAB_KEY) || "account"; } catch { /* ignore */ }
if (location.hash) initialTab = location.hash.slice(1);
showTab(initialTab);

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
let activityCache = [];

const fmtLogged = (ts) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
const SOURCE_LABEL = { manual: "Fill today", range: "Fill range", auto: "Auto-fill" };

function activityMonths(entries) {
  const set = new Set(entries.map((e) => e.date.slice(0, 7)));
  return [...set].sort().reverse();
}

function renderActivityMonths() {
  const sel = $("activityMonth");
  const prev = sel.value;
  sel.innerHTML = "";
  sel.appendChild(new Option("All time", "all"));
  for (const m of activityMonths(activityCache)) {
    const label = new Date(m + "-15T12:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric" });
    sel.appendChild(new Option(label, m));
  }
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : (sel.options[1]?.value || "all");
}

const fmtBlocks = (s) => (s || "").split(",").filter(Boolean).join("  ·  ").replace(/-/g, "–");
const fmtShortDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function pill(cls, text) {
  const el = document.createElement("span");
  el.className = `pill ${cls}`;
  el.textContent = text;
  return el;
}

function td(content, cls) {
  const cell = document.createElement("td");
  if (cls) cell.className = cls;
  if (content instanceof Node) cell.appendChild(content); else cell.textContent = content ?? "";
  return cell;
}

// Collapsed full-width detail row with a toggle button; returns the toggle.
function errorDetail(tbody, text) {
  const detail = document.createElement("tr");
  detail.className = "detail-row"; detail.hidden = true;
  const cell = td(null); cell.colSpan = 6;
  const list = document.createElement("div"); list.className = "detail-list";
  const line = document.createElement("div"); line.className = "detail-line";
  line.append(Object.assign(document.createElement("span"), { textContent: text, className: "d-err" }));
  list.appendChild(line); cell.appendChild(list); detail.appendChild(cell);
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.className = "expander"; toggle.textContent = "▸ details";
  toggle.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    toggle.textContent = detail.hidden ? "▸ details" : "▾ details";
  });
  return { toggle, detail };
}

// Days affected by an entry (a range expands to its detail days).
const entryDays = (e) => (e.kind === "range" ? e.days : [e]);
const entryHasError = (e) => (e.kind === "range" ? Boolean(e.runError) || e.counts.error > 0 : e.status === "error");
const entryInMonth = (e, month) =>
  month === "all" || (e.kind === "range" ? (e.from.slice(0, 7) <= month && month <= e.to.slice(0, 7)) : e.date.startsWith(month));

function renderActivity() {
  const month = $("activityMonth").value;
  const errorsOnly = $("activityErrorsOnly").checked;
  const rows = activityCache.filter((e) => entryInMonth(e, month) && (!errorsOnly || entryHasError(e)));

  const okDays = rows.flatMap(entryDays).filter((d) => (d.status === "created" || d.status === "replaced") && (month === "all" || d.date.startsWith(month)));
  const days = new Set(okDays.map((d) => d.date)).size;
  const entries = okDays.reduce((n, d) => n + (d.blocks ? d.blocks.split(",").length : 0), 0);
  const errors = rows.reduce((n, e) => n + (e.kind === "range" ? (e.runError ? 1 : e.counts.error) : e.status === "error" ? (e.count || 1) : 0), 0);
  const stats = $("activityStats");
  stats.innerHTML = "";
  for (const [text, cls] of [[`${days} day${days === 1 ? "" : "s"} booked`, ""], [`${entries} entr${entries === 1 ? "y" : "ies"} created`, ""], [`${errors} error${errors === 1 ? "" : "s"}`, errors ? "bad" : ""]]) {
    const c = document.createElement("span"); c.className = `chip ${cls}`; c.textContent = text; stats.appendChild(c);
  }

  const tbody = $("activityRows");
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const cell = td("Nothing logged yet.", "empty"); cell.colSpan = 6;
    tr.appendChild(cell); tbody.appendChild(tr);
    return;
  }

  for (const e of rows) {
    const tr = document.createElement("tr");
    const src = pill("src", SOURCE_LABEL[e.source] || e.source);

    if (e.kind === "range") {
      const c = e.counts;
      const total = Math.round((Date.parse(e.to + "T12:00:00Z") - Date.parse(e.from + "T12:00:00Z")) / 86400000) + 1;
      if (e.runError) {
        const { toggle, detail } = errorDetail(tbody, e.runError);
        tr.className = "range-row";
        const failed = pill("error", "run failed");
        if ((e.count || 1) > 1) failed.textContent += ` ×${e.count}`;
        tr.append(
          td(`${fmtShortDay(e.from)} → ${fmtShortDay(e.to)}  (${total} day${total === 1 ? "" : "s"})`),
          td(failed),
          td(toggle),
          td(src),
          td(fmtLogged(e.at)),
          td(e.device || "")
        );
        tbody.append(tr, detail);
        continue;
      }
      const summary = document.createElement("span");
      summary.className = "range-summary";
      for (const [k, cls] of [["created", "created"], ["replaced", "replaced"], ["error", "error"], ["skipped", "skipped"], ["exists", "exists"]]) {
        if (c[k]) summary.appendChild(pill(cls, `${c[k]} ${k === "exists" ? "already filled" : k}`));
      }
      const changed = e.days.length > 0;
      let timesCell;
      let toggle = null;
      if (changed) {
        toggle = document.createElement("button");
        toggle.type = "button"; toggle.className = "expander";
        toggle.textContent = `▸ ${e.days.length} day${e.days.length === 1 ? "" : "s"}`;
        timesCell = td(toggle);
      } else {
        timesCell = td("nothing booked", "times muted");
      }

      if ((e.count || 1) > 1) summary.appendChild(pill("src", `×${e.count}`));
      tr.className = changed ? "range-row" : "range-row quiet-row";
      tr.append(
        td(`${fmtShortDay(e.from)} → ${fmtShortDay(e.to)}  (${total} day${total === 1 ? "" : "s"})`),
        td(summary),
        timesCell,
        td(src),
        td(fmtLogged(e.at)),
        td(e.device || "")
      );
      tbody.appendChild(tr);
      if (!changed) continue;

      const detail = document.createElement("tr");
      detail.className = "detail-row"; detail.hidden = true;
      const cell = td(null); cell.colSpan = 6;
      const list = document.createElement("div"); list.className = "detail-list";
      for (const d of e.days) {
        const line = document.createElement("div"); line.className = "detail-line";
        line.append(
          Object.assign(document.createElement("span"), { textContent: fmtDay(d.date), className: "d-day" }),
          pill(d.status, d.status === "replaced" ? `replaced (${d.replaced} removed)` : d.status),
          Object.assign(document.createElement("span"), { textContent: d.status === "error" ? d.error : fmtBlocks(d.blocks), className: d.status === "error" ? "d-err" : "d-times" })
        );
        list.appendChild(line);
      }
      cell.appendChild(list); detail.appendChild(cell); tbody.appendChild(detail);
      toggle.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        toggle.textContent = `${detail.hidden ? "▸" : "▾"} ${e.days.length} day${e.days.length === 1 ? "" : "s"}`;
      });
      continue;
    }

    const STATUS_LABEL = { exists: "already filled", skipped: `skipped${e.error ? ` (${e.error})` : ""}`, replaced: `replaced (${e.replaced} removed)` };
    const status = pill(e.status, STATUS_LABEL[e.status] || e.status);
    if ((e.count || 1) > 1) status.textContent += ` ×${e.count}`;
    const nothing = e.status !== "created" && e.status !== "replaced";
    if (nothing) tr.className = "quiet-row";
    let timesCell;
    let detail = null;
    if (e.status === "error") {
      ({ toggle: timesCell, detail } = errorDetail(tbody, e.error));
      timesCell = td(timesCell);
    } else {
      timesCell = td(nothing ? "nothing booked" : fmtBlocks(e.blocks), nothing ? "times muted" : "times");
    }
    tr.append(td(fmtDay(e.date)), td(status), timesCell, td(src), td(fmtLogged(e.at)), td(e.device || ""));
    tbody.appendChild(tr);
    if (detail) tbody.appendChild(detail);
  }
}

async function loadActivity() {
  activityCache = await getActivity();
  renderActivityMonths();
  renderActivity();
}

$("activityMonth").addEventListener("change", renderActivity);
$("activityErrorsOnly").addEventListener("change", renderActivity);

$("activityCsvBtn").addEventListener("click", () => {
  const blob = new Blob([activityToCsv(activityCache)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `clockodo-autofill-activity-${todayStr()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$("activityClearBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Clear the activity log?",
    message: "The log is removed on this device and on every device you sync with.",
    details: ["Your Clockodo entries are not affected"],
    confirmText: "Clear log",
    danger: true,
  });
  if (!ok) return;
  await clearActivity();
  await loadActivity();
});

$("deviceLabelBtn").addEventListener("click", async () => {
  const label = $("deviceLabel").value.trim();
  if (!label) return;
  await renameDevice(label);
  setStatus($("deviceLabelResult"), "✓ Renamed (applies to new entries)", "ok");
  setTimeout(() => setStatus($("deviceLabelResult"), ""), 2000);
});

// Refresh when a run finishes on this or another device.
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && changes.activity) || (area === "sync" && Object.keys(changes).some((k) => k.startsWith("activity_")))) {
    loadActivity();
  }
});

// ---------------------------------------------------------------------------
// Sync & backup
// ---------------------------------------------------------------------------
function refreshSyncToggles() {
  const on = $("syncSettings").checked && $("rememberKey").checked;
  $("syncApiKey").disabled = !on;
  if (!on) $("syncApiKey").checked = false;
}
$("syncSettings").addEventListener("change", refreshSyncToggles);

$("exportBtn").addEventListener("click", async () => {
  const el = $("backupResult");
  setStatus(el, "Preparing…");
  try {
    const res = await chrome.runtime.sendMessage({ action: "exportConfig", includeApiKey: $("exportWithKey").checked });
    if (!res.ok) throw new Error(res.error);
    const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clockodo-autofill-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(el, $("exportWithKey").checked ? "✓ Exported (includes your API key — keep the file private)." : "✓ Exported (without API key).", "ok");
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const el = $("backupResult");
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  setStatus(el, "Importing…");
  try {
    const payload = JSON.parse(await file.text());
    const res = await chrome.runtime.sendMessage({ action: "importConfig", payload });
    if (!res.ok) throw new Error(res.error);
    setStatus(el, "✓ Imported — reloading…", "ok");
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------
$("checkUpdateBtn").addEventListener("click", async () => {
  const el = $("updateResult");
  setStatus(el, "Checking…");
  try {
    const res = await chrome.runtime.sendMessage({ action: "checkForUpdate" });
    if (!res.ok) throw new Error(res.error);
    if (res.disabled) return setStatus(el, "Installed from the Chrome Web Store — Chrome updates it automatically.");
    if (res.update.available) {
      el.textContent = "";
      const a = document.createElement("a");
      a.href = res.update.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `Version ${res.update.latest} is available — open download page`;
      el.append(a);
      el.classList.remove("bad");
      el.classList.add("ok");
    } else {
      setStatus(el, `✓ You have the latest version (${res.update.current}).`, "ok");
    }
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

// ---------------------------------------------------------------------------
// Collect + save
// ---------------------------------------------------------------------------
function collect() {
  const patch = credentialPatch();
  for (const f of TEXT_FIELDS) patch[f] = $(f).value.trim();
  for (const c of CHECKBOXES) patch[c] = $(c).checked;
  patch.customersId = selectedId($("customersId"), savedCustomersId);
  patch.servicesId = selectedId($("servicesId"), savedServicesId);
  patch.billable = $("billable").checked ? 1 : 0;
  patch.blocks = blocks.map((b) => ({ start: b.start, end: b.end }));
  Object.assign(patch, randomSettings(), { scheduleMode: scheduleMode() });
  patch.timezone = $("timezone").value;
  patch.skipDates = [...skipDates];
  return patch;
}

$("saveBtn").addEventListener("click", async () => {
  const el = $("saveResult");
  const patch = collect();
  const scheduleError = validateSchedule(patch);
  if (scheduleError) { showTab("schedule"); return setStatus(el, `✗ ${scheduleError}`, "bad"); }
  if (!HHMM_RE.test(patch.autoTime)) { showTab(tabOf($("autoTime"))); return setStatus(el, "✗ Auto-fill time must be HH:MM.", "bad"); }
  const next = await saveConfig(patch);
  showKeyState(next);
  const res = await chrome.runtime.sendMessage({ action: "rescheduleAlarm" });
  if (!res.ok) return setStatus(el, `✗ Saved, but scheduling failed: ${res.error}`, "bad");
  savedCustomersId = patch.customersId;
  savedServicesId = patch.servicesId;
  refreshSetupState();
  setStatus(el, "✓ Saved", "ok");
  setTimeout(() => setStatus(el, ""), 2000);
});

// Keep the two settings the popup can change in sync while this page is open,
// so a later Save here doesn't clobber them.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.config || !changes.config.newValue) return;
  const cfg = changes.config.newValue;
  $("autoDaily").checked = !!cfg.autoDaily;
  const incoming = cfg.skipDates || [];
  if (incoming.join() !== [...skipDates].sort().join()) {
    skipDates = [...incoming];
    renderSkipList();
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  $("appVersion").textContent = `v${chrome.runtime.getManifest().version}`;
  const [cfg, { pickLists }] = await Promise.all([loadConfig(), chrome.storage.local.get("pickLists")]);

  for (const f of TEXT_FIELDS) $(f).value = cfg[f] ?? "";
  for (const c of CHECKBOXES) $(c).checked = !!cfg[c];
  showKeyState(cfg);
  savedCustomersId = cfg.customersId;
  savedServicesId = cfg.servicesId;
  skipDates = [...(cfg.skipDates || [])];
  blocks = cfg.blocks.map((b) => ({ ...b }));

  const modeRadio = document.querySelector(`input[name="scheduleMode"][value="${cfg.scheduleMode}"]`)
    || document.querySelector('input[name="scheduleMode"][value="fixed"]');
  modeRadio.checked = true;
  $("randomTotalH").value = Math.floor(cfg.randomTotalMinutes / 60);
  $("randomTotalM").value = cfg.randomTotalMinutes % 60;
  $("randomBreakMinutes").value = cfg.randomBreakMinutes;
  $("randomBreakJitter").value = cfg.randomBreakJitter ?? 0;

  renderBlocks();
  renderTimezones(cfg.timezone);
  toggleScheduleFields();
  renderSkipList();
  toggleModeFields();
  refreshRememberHint();
  refreshSyncToggles();
  loadActivity();
  loadHolidayInfo();
  chrome.storage.local.get("device").then(({ device }) => { $("deviceLabel").value = device?.label || ""; });

  if (pickLists) {
    fillSelect($("customersId"), pickLists.customers, savedCustomersId);
    fillSelect($("servicesId"), pickLists.services, savedServicesId);
    $("loadCustomersServicesBtn").textContent = "Reload customers & services";
  }
  refreshSetupState();
}

init();
