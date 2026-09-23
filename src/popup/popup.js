// popup.js
import { loadConfig, todayStr, addDays, isWeekend } from "../lib/clockodo-api.js";
import { confirmDialog } from "../lib/dialog.js";

const $ = (id) => document.getElementById(id);

let mode = "entry";
let timezone = "Europe/Berlin";

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.classList.remove("ok", "bad", "results");
  el.classList.toggle("show", Boolean(text));
  if (kind) el.classList.add(kind);
}

// Structured fill results: a header with counts, then one compact row per day.
const STATUS_LABEL = { created: "booked", replaced: "replaced", exists: "already filled", skipped: "skipped", error: "error" };
// "Mon 14 Sep" — day-first, three-letter month regardless of the user's locale.
function fmtDay(dateStr) {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(dateStr + "T12:00:00Z"));
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function resultRow(r) {
  const quiet = r.status === "exists" || r.status === "skipped";
  const row = el("div", `res-row ${r.status}${quiet ? " quiet" : ""}`);
  row.append(el("span", "res-date", fmtDay(r.dateStr)));
  const label = r.status === "replaced" && r.replaced
    ? `replaced · ${r.replaced} removed`
    : STATUS_LABEL[r.status] || r.status;
  row.append(el("span", `pill ${r.status}`, label));

  let detail = "";
  let detailCls = "res-detail";
  if (r.status === "created" || r.status === "replaced") {
    detail = mode === "entry" ? blocksText(r.blocks) : (r.approved ? "created & approved" : "pending approval");
    detailCls += " times";
  } else if (r.status === "skipped") {
    detail = r.reason || "";
  } else if (r.status === "error") {
    detail = r.error || "Unknown error";
  }
  row.append(el("div", detailCls, detail));
  return row;
}

function showResults(results, title) {
  const box = $("status");
  box.replaceChildren();
  box.className = "status-text show results";

  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const head = el("div", "res-head");
  head.append(el("span", "res-title", title));
  const pills = el("span", "res-counts");
  for (const s of ["created", "replaced", "error", "exists", "skipped"]) {
    if (counts[s]) pills.append(el("span", `pill ${s}`, `${counts[s]} ${STATUS_LABEL[s]}`));
  }
  head.append(pills);
  box.append(head);

  const list = el("div", "res-list");
  for (const r of results) list.append(resultRow(r));
  box.append(list);
}

function setConnection(kind, label) {
  $("connDot").className = `dot ${kind}`;
  $("connLabel").textContent = label;
}

const blocksText = (blocks) => (blocks || []).map((b) => `${b.start}–${b.end}`).join(", ");

// Returns the chosen existing-day policy, or null if the user cancelled the
// destructive confirmation.
async function existingPolicy(scopeText) {
  const onExisting = $("onExisting").value;
  if (onExisting === "replace") {
    const ok = await confirmDialog({
      title: "Replace existing entries?",
      message: `On every already-filled day ${scopeText}, all of your time entries will be deleted and your configured blocks booked instead.`,
      details: ["Affects only days that already have entries", "Cannot be undone"],
      confirmText: "Replace",
      danger: true,
    });
    if (!ok) return null;
  }
  return onExisting;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

async function refreshSchedule() {
  const res = await send({ action: "getStatus" });
  if (!res.ok) return;
  const parts = [res.nextRun ? `Next run: ${fmtTime(res.nextRun)}` : "Off"];
  if (res.lastAutoRun) {
    const when = new Date(res.lastAutoRun.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const mark = { created: "✓", replaced: "✓", exists: "✓", skipped: "–", error: "✗" }[res.lastAutoRun.status] || "";
    parts.push(`last: ${when} ${mark}`);
  }
  $("nextRun").textContent = parts.join(" · ");

  const versionEl = $("versionInfo");
  versionEl.className = "";
  if (res.update) {
    versionEl.textContent = `v${res.version} · update ${res.update.latest} available`;
    versionEl.className = "warn";
  } else if (res.updateInfo?.checkedAt) {
    versionEl.textContent = `v${res.version} · up to date`;
    versionEl.className = "ok";
  } else {
    versionEl.textContent = `v${res.version}`;
  }

  const banner = $("updateBanner");
  if (res.update) {
    $("updateText").textContent = `Version ${res.update.latest} is available (you have ${res.version}).`;
    banner.href = res.update.url;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// Runs an action, surfaces {error} responses, and lets the caller revert UI state.
async function run(btn, pending, fn) {
  if (btn) btn.disabled = true;
  setStatus(pending);
  try {
    const res = await fn();
    if (!res.ok) throw new Error(res.error || "Unknown error");
    return res;
  } catch (e) {
    setStatus(`Error: ${e.message}`, "bad");
    return null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Monday-based week containing `dateStr`.
function weekBounds(dateStr) {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay(); // 0 = Sun
  const monday = addDays(dateStr, dow === 0 ? -6 : 1 - dow);
  return [monday, addDays(monday, 6)];
}

function quickRange(kind) {
  const today = todayStr(timezone);
  if (kind === "thisWeek") return weekBounds(today);
  if (kind === "lastWeek") return weekBounds(addDays(today, -7));
  if (kind === "thisMonth") {
    const first = today.slice(0, 8) + "01";
    let last = first;
    while (addDays(last, 1).slice(0, 7) === today.slice(0, 7)) last = addDays(last, 1);
    return [first, last];
  }
  return [today, today];
}

for (const btn of document.querySelectorAll("[data-range]")) {
  btn.addEventListener("click", () => {
    const [from, to] = quickRange(btn.dataset.range);
    $("fromDate").value = from;
    $("toDate").value = to;
    const workdays = countWorkdays(from, to);
    setStatus(`Range set: ${from} → ${to} (${workdays} workday${workdays === 1 ? "" : "s"}). Click "Fill range" to book.`);
  });
}

function countWorkdays(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d, timezone)) n++;
  return n;
}

async function init() {
  const cfg = await loadConfig();
  mode = cfg.mode;
  timezone = cfg.timezone;
  $("autoDailyToggle").checked = !!cfg.autoDaily;

  let today;
  try {
    today = todayStr(cfg.timezone);
  } catch {
    setConnection("bad", `Unknown timezone "${cfg.timezone}" — fix it in Options`);
    return;
  }
  $("fromDate").value = today;
  $("toDate").value = today;
  $("skipTodayToggle").checked = (cfg.skipDates || []).includes(today);
  refreshSchedule();

  if (!cfg.apiUser || !cfg.apiKey) {
    setConnection("bad", "Not configured — open Options");
    return;
  }
  // Show the cached identity immediately; verify in the background.
  if (cfg.usersId) setConnection("", cfg.userName || cfg.apiUser);
  try {
    const res = await send({ action: "testConnection" });
    if (res.ok) setConnection("ok", res.name || cfg.apiUser);
    else setConnection("bad", res.error || "Connection failed");
  } catch (e) {
    setConnection("bad", e.message);
  }
}

$("fillTodayBtn").addEventListener("click", async () => {
  const onExisting = await existingPolicy("(today)");
  if (!onExisting) return;
  const res = await run($("fillTodayBtn"), "Filling today…", () => send({ action: "fillToday", onExisting }));
  if (res) showResults([res.result], "Today");
});

$("fillRangeBtn").addEventListener("click", async () => {
  const from = $("fromDate").value;
  const to = $("toDate").value;
  if (!from || !to) return setStatus("Pick both dates first.", "bad");
  if (from > to) return setStatus("\"From\" must be before \"To\".", "bad");
  const onExisting = await existingPolicy(`between ${from} and ${to}`);
  if (!onExisting) return;
  const res = await run($("fillRangeBtn"), `Filling ${from} → ${to}…`, () => send({ action: "fillRange", from, to, onExisting }));
  if (res) {
    const n = res.results.length;
    showResults(res.results, `${fmtDay(from)} → ${fmtDay(to)} · ${n} day${n === 1 ? "" : "s"}`);
  }
});

$("onExisting").addEventListener("change", () => {
  $("onExisting").classList.toggle("danger", $("onExisting").value === "replace");
});

$("autoDailyToggle").addEventListener("change", async () => {
  const toggle = $("autoDailyToggle");
  const enabled = toggle.checked;
  const res = await run(null, enabled ? "Enabling auto-fill…" : "Disabling auto-fill…",
    () => send({ action: "setAutoDaily", enabled }));
  if (!res) { toggle.checked = !enabled; return; }
  await refreshSchedule();
  setStatus(enabled
    ? "Auto-fill enabled. Runs at the scheduled time while Chrome is open; catches up on launch if missed."
    : "Auto-fill disabled.");
});

$("skipTodayToggle").addEventListener("change", async () => {
  const toggle = $("skipTodayToggle");
  const wanted = toggle.checked;
  const res = await run(null, "Updating…", () => send({ action: "toggleSkipToday" }));
  if (!res) { toggle.checked = !wanted; return; }
  toggle.checked = res.skippedToday;
  setStatus(res.skippedToday ? "Today marked as skip." : "Today un-skipped.");
});

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

$("activityLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#activity") });
});

init();
