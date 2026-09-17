// options.js
import {
  loadConfig, saveConfig, validateSchedule, randomBlocks, isWeekend, todayStr, addDays,
  toMinutes, toHHMM, HHMM_RE, MAX_BLOCKS,
} from "../lib/clockodo-api.js";

const $ = (id) => document.getElementById(id);

// apiKey is handled separately: the stored key is never written back into the DOM.
const TEXT_FIELDS = ["apiUser", "mode", "autoTime", "randomEarliestStart", "randomLatestStart"];
const CHECKBOXES = ["autoApprove", "billable", "skipWeekends", "autoDaily", "checkUpdates", "syncSettings", "syncApiKey"];

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
function renderTimezones(selected) {
  const select = $("timezone");
  select.innerHTML = "";
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(selected)) zones.unshift(selected);
  for (const tz of zones) select.appendChild(new Option(tz, tz));
  select.value = selected;
}

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
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

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
  const patch = { apiUser: $("apiUser").value.trim() };
  const key = $("apiKey").value.trim();
  if (key) patch.apiKey = key;
  return patch;
}

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
});

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
// Sync & backup
// ---------------------------------------------------------------------------
function refreshSyncToggles() {
  const on = $("syncSettings").checked;
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
  refreshSyncToggles();

  if (pickLists) {
    fillSelect($("customersId"), pickLists.customers, savedCustomersId);
    fillSelect($("servicesId"), pickLists.services, savedServicesId);
    $("loadCustomersServicesBtn").textContent = "Reload customers & services";
  }
}

init();
