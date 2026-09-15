// options.js
import {
  loadConfig,
  saveConfig,
  validateSchedule,
  HHMM_RE,
  MAX_BLOCKS,
} from "./clockodo-api.js";

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = ["apiUser", "apiKey", "mode", "autoTime"];
const CHECKBOXES = ["autoApprove", "billable", "skipWeekends", "autoDaily"];

const FALLBACK_TIMEZONES = [
  "Europe/Berlin", "Europe/London", "Europe/Paris", "Europe/Madrid", "Europe/Rome",
  "Europe/Amsterdam", "Europe/Zurich", "Europe/Vienna", "Europe/Warsaw", "Europe/Istanbul",
  "Asia/Tehran", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "Australia/Sydney", "UTC",
];

let skipDates = [];
let blocks = [];
let savedCustomersId = null;
let savedServicesId = null;

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

// ---------------------------------------------------------------------------
// Working blocks
// ---------------------------------------------------------------------------
function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const fmtDuration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};
const isValidBlock = (b) => HHMM_RE.test(b.start) && HHMM_RE.test(b.end) && b.start < b.end;

function timeInput(block, key, label, onChange) {
  const wrap = document.createElement("div");
  const lbl = document.createElement("label");
  lbl.className = "field-label";
  lbl.textContent = label;
  const input = document.createElement("input");
  input.type = "time";
  input.value = block[key];
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => { block[key] = input.value; onChange(); });
  wrap.append(lbl, input);
  return wrap;
}

function renderTimeline() {
  const bar = $("timelineBar");
  const axis = $("timelineAxis");
  bar.innerHTML = "";
  axis.innerHTML = "";
  const valid = blocks.filter(isValidBlock);
  if (!valid.length) return;

  // Fit the axis to the day with 1 h padding, snapped to whole hours.
  const first = Math.min(...valid.map((b) => minutes(b.start)));
  const last = Math.max(...valid.map((b) => minutes(b.end)));
  const from = Math.max(0, Math.floor(first / 60) * 60 - 60);
  const to = Math.min(24 * 60, Math.ceil(last / 60) * 60 + 60);
  const span = to - from || 1;
  const pct = (m) => ((m - from) / span) * 100;

  const sorted = [...valid].sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((b, i) => {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.style.left = `${pct(minutes(b.start))}%`;
    seg.style.width = `${pct(minutes(b.end)) - pct(minutes(b.start))}%`;
    seg.textContent = fmtDuration(minutes(b.end) - minutes(b.start));
    seg.title = `${b.start} – ${b.end}`;
    bar.appendChild(seg);

    const next = sorted[i + 1];
    if (next && next.start > b.end) {
      const gap = document.createElement("div");
      gap.className = "seg gap";
      gap.style.left = `${pct(minutes(b.end))}%`;
      gap.style.width = `${pct(minutes(next.start)) - pct(minutes(b.end))}%`;
      gap.textContent = "break";
      gap.title = `Break ${fmtDuration(minutes(next.start) - minutes(b.end))}`;
      bar.appendChild(gap);
    }
  });

  const ticks = Math.min(6, span / 60);
  for (let i = 0; i <= ticks; i++) {
    const t = document.createElement("span");
    const m = from + Math.round((span * i) / ticks / 60) * 60;
    t.textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;
    axis.appendChild(t);
  }
}

function renderBlocksTotal() {
  const total = blocks.filter(isValidBlock)
    .reduce((sum, b) => sum + minutes(b.end) - minutes(b.start), 0);
  const el = $("blocksTotal");
  el.textContent = total ? `${fmtDuration(total)} / day` : "—";
  el.classList.toggle("warn", total > 10 * 60);
}

function refreshBlockDerived() {
  blocks.forEach((b, i) => {
    const dur = $("blocksList").children[i * 2]?.querySelector(".dur");
    if (!dur) return;
    const ok = isValidBlock(b);
    dur.textContent = ok ? fmtDuration(minutes(b.end) - minutes(b.start)) : "invalid";
    dur.classList.toggle("bad", !ok);
  });
  renderGapChips();
  renderTimeline();
  renderBlocksTotal();
}

function renderGapChips() {
  const list = $("blocksList");
  blocks.forEach((b, i) => {
    const chip = list.children[i * 2 + 1];
    if (!chip || !chip.classList.contains("gap-chip")) return;
    const next = blocks[i + 1];
    if (!next || !isValidBlock(b) || !HHMM_RE.test(next.start)) { chip.textContent = ""; return; }
    const gap = minutes(next.start) - minutes(b.end);
    chip.classList.toggle("bad", gap < 0);
    chip.textContent = gap < 0 ? "overlaps next block" : gap === 0 ? "no break" : `break ${fmtDuration(gap)}`;
  });
}

function renderBlocks() {
  const list = $("blocksList");
  list.innerHTML = "";
  blocks.forEach((block, i) => {
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

    row.append(
      idx,
      timeInput(block, "start", "Start", refreshBlockDerived),
      timeInput(block, "end", "End", refreshBlockDerived),
      dur,
      remove
    );
    list.appendChild(row);

    const chip = document.createElement("div");
    chip.className = "gap-chip";
    list.appendChild(chip);
  });
  list.lastElementChild?.remove(); // no gap chip after the final block
  $("addBlockBtn").disabled = blocks.length >= MAX_BLOCKS;
  refreshBlockDerived();
}

$("addBlockBtn").addEventListener("click", () => {
  if (blocks.length >= MAX_BLOCKS) return;
  const last = blocks[blocks.length - 1];
  // Suggest a block starting one hour after the previous one ends.
  const startMin = last ? Math.min(minutes(last.end) + 60, 22 * 60) : 9 * 60;
  const endMin = Math.min(startMin + 4 * 60, 23 * 60 + 59);
  const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  blocks.push({ start: fmt(startMin), end: fmt(endMin) });
  renderBlocks();
});

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------
function timezoneOptions() {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone");
  } catch { /* fall through */ }
  return FALLBACK_TIMEZONES;
}

function renderTimezones(selected) {
  const select = $("timezone");
  select.innerHTML = "";
  const zones = timezoneOptions();
  if (!zones.includes(selected)) zones.unshift(selected);
  for (const tz of zones) {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = tz;
    select.appendChild(opt);
  }
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
  [...skipDates].sort().forEach((d) => {
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
  });
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
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = items.length ? "Select…" : "No items found";
  select.appendChild(placeholder);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.name} (#${item.id})`;
    select.appendChild(opt);
  }
  if (savedId != null) select.value = String(savedId);
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
$("testBtn").addEventListener("click", async () => {
  const el = $("testResult");
  setStatus(el, "Testing…");
  await saveConfig({ apiUser: $("apiUser").value.trim(), apiKey: $("apiKey").value.trim() });
  try {
    const res = await chrome.runtime.sendMessage({ action: "testConnection" });
    if (res.ok) setStatus(el, `✓ Connected as ${res.name} (id ${res.usersId})`, "ok");
    else setStatus(el, `✗ ${res.error}`, "bad");
  } catch (e) {
    setStatus(el, `✗ ${e.message}`, "bad");
  }
});

// ---------------------------------------------------------------------------
// Collect + save
// ---------------------------------------------------------------------------
function collect() {
  const patch = {};
  for (const f of TEXT_FIELDS) patch[f] = $(f).value.trim();
  for (const c of CHECKBOXES) patch[c] = $(c).checked;
  patch.customersId = $("customersId").value ? Number($("customersId").value) : null;
  patch.servicesId = $("servicesId").value ? Number($("servicesId").value) : null;
  patch.billable = $("billable").checked ? 1 : 0;
  patch.blocks = blocks.map((b) => ({ start: b.start, end: b.end }));
  patch.timezone = $("timezone").value;
  patch.skipDates = [...skipDates];
  return patch;
}

$("saveBtn").addEventListener("click", async () => {
  const el = $("saveResult");
  const patch = collect();
  const scheduleError = validateSchedule(patch);
  if (scheduleError) return setStatus(el, `✗ ${scheduleError}`, "bad");
  if (!HHMM_RE.test(patch.autoTime)) return setStatus(el, "✗ Auto-fill time must be HH:MM.", "bad");
  await saveConfig(patch);
  await chrome.runtime.sendMessage({ action: "rescheduleAlarm" });
  setStatus(el, "✓ Saved", "ok");
  setTimeout(() => setStatus(el, ""), 2000);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  $("appVersion").textContent = `v${chrome.runtime.getManifest().version}`;
  const cfg = await loadConfig();
  for (const f of TEXT_FIELDS) $(f).value = cfg[f] ?? "";
  for (const c of CHECKBOXES) $(c).checked = !!cfg[c];
  savedCustomersId = cfg.customersId;
  savedServicesId = cfg.servicesId;
  skipDates = [...(cfg.skipDates || [])];
  blocks = cfg.blocks.map((b) => ({ ...b }));

  renderBlocks();
  renderTimezones(cfg.timezone);
  renderSkipList();
  toggleModeFields();

  const { pickLists } = await chrome.storage.local.get("pickLists");
  if (pickLists) {
    fillSelect($("customersId"), pickLists.customers, savedCustomersId);
    fillSelect($("servicesId"), pickLists.services, savedServicesId);
    $("loadCustomersServicesBtn").textContent = "Reload customers & services";
  }
}

init();
