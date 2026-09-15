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
  [...skipDates].sort().forEach((d) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = d;
    const btn = document.createElement("button");
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

async function init() {
  const cfg = await loadConfig();
  for (const f of fields) $(f).value = cfg[f] ?? "";
  for (const c of checkboxes) $(c).checked = !!cfg[c];
  skipDates = [...(cfg.skipDates || [])];
  renderSkipList();
  toggleEntryFields();
}

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
  $("testResult").textContent = "Testing…";
  await saveConfig(collect());
  try {
    const res = await chrome.runtime.sendMessage({ action: "testConnection" });
    $("testResult").textContent = res.ok
      ? `✓ Connected as ${res.name} (id ${res.usersId})`
      : `✗ ${res.error}`;
  } catch (e) {
    $("testResult").textContent = `✗ ${e.message}`;
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
  $("saveResult").textContent = "Saved.";
  setTimeout(() => ($("saveResult").textContent = ""), 2000);
});

init();
