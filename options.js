// options.js
import { loadConfig, saveConfig } from "./clockodo-api.js";

const $ = (id) => document.getElementById(id);

const fields = [
  "apiUser", "apiKey", "mode", "customersId", "servicesId",
  "block1Start", "block1End", "block2Start", "block2End", "autoTime",
];
const checkboxes = ["autoApprove", "billable", "skipWeekends", "autoDaily"];

let skipDates = [];

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

function toggleEntryFields() {
  $("entryFields").style.display = $("mode").value === "entry" ? "block" : "none";
}

let savedCustomersId = null;
let savedServicesId = null;

async function init() {
  const cfg = await loadConfig();
  for (const f of fields) $(f).value = cfg[f] ?? "";
  for (const c of checkboxes) $(c).checked = !!cfg[c];
  savedCustomersId = cfg.customersId;
  savedServicesId = cfg.servicesId;
  skipDates = [...(cfg.skipDates || [])];
  renderSkipList();
  toggleEntryFields();
}

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
  el.className = "";
  el.textContent = "Loading…";
  try {
    const [customersRes, servicesRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: "listCustomers" }),
      chrome.runtime.sendMessage({ action: "listServices" }),
    ]);
    if (!customersRes.ok) throw new Error(customersRes.error);
    if (!servicesRes.ok) throw new Error(servicesRes.error);
    fillSelect($("customersId"), customersRes.customers, savedCustomersId);
    fillSelect($("servicesId"), servicesRes.services, savedServicesId);
    el.className = "ok";
    el.textContent = `Loaded ${customersRes.customers.length} customers, ${servicesRes.services.length} services.`;
  } catch (e) {
    el.className = "bad";
    el.textContent = `✗ ${e.message}`;
  }
});

$("mode").addEventListener("change", toggleEntryFields);

$("addSkipBtn").addEventListener("click", () => {
  const v = $("skipDateInput").value;
  if (v && !skipDates.includes(v)) {
    skipDates.push(v);
    renderSkipList();
    $("skipDateInput").value = "";
  }
});

$("testBtn").addEventListener("click", async () => {
  const el = $("testResult");
  el.className = "";
  el.textContent = "Testing…";
  await saveConfig(collect());
  try {
    const res = await chrome.runtime.sendMessage({ action: "testConnection" });
    if (res.ok) {
      el.className = "ok";
      el.textContent = `✓ Connected as ${res.name} (id ${res.usersId})`;
    } else {
      el.className = "bad";
      el.textContent = `✗ ${res.error}`;
    }
  } catch (e) {
    el.className = "bad";
    el.textContent = `✗ ${e.message}`;
  }
});

function collect() {
  const patch = {};
  for (const f of fields) patch[f] = $(f).value;
  for (const c of checkboxes) patch[c] = $(c).checked;
  patch.customersId = patch.customersId ? Number(patch.customersId) : null;
  patch.servicesId = patch.servicesId ? Number(patch.servicesId) : null;
  patch.billable = $("billable").checked ? 1 : 0;
  patch.skipDates = [...skipDates];
  return patch;
}

$("saveBtn").addEventListener("click", async () => {
  await saveConfig(collect());
  await chrome.runtime.sendMessage({ action: "rescheduleAlarm" });
  const el = $("saveResult");
  el.className = "ok";
  el.textContent = "Saved.";
  setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, 2000);
});

init();
