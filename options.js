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

function renderBlocksTotal() {
  const valid = blocks.filter((b) => HHMM_RE.test(b.start) && HHMM_RE.test(b.end) && b.start < b.end);
  const total = valid.reduce((sum, b) => sum + minutes(b.end) - minutes(b.start), 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  setStatus($("blocksTotal"), total ? `Total ${h}h${m ? ` ${m}m` : ""} / day` : "");
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

    const start = document.createElement("input");
    start.type = "time";
    start.value = block.start;
    start.setAttribute("aria-label", `Block ${i + 1} start`);
    start.addEventListener("input", () => { block.start = start.value; renderBlocksTotal(); });

    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "→";

    const end = document.createElement("input");
    end.type = "time";
    end.value = block.end;
    end.setAttribute("aria-label", `Block ${i + 1} end`);
    end.addEventListener("input", () => { block.end = end.value; renderBlocksTotal(); });

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

    row.append(idx, start, sep, end, remove);
    list.appendChild(row);
  });
  $("addBlockBtn").disabled = blocks.length >= MAX_BLOCKS;
  renderBlocksTotal();
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
