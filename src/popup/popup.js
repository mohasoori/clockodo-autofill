// popup.js
import { loadConfig, todayStr } from "../lib/clockodo-api.js";

const $ = (id) => document.getElementById(id);

let mode = "entry";

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.classList.remove("ok", "bad");
  el.classList.toggle("show", Boolean(text));
  if (kind) el.classList.add(kind);
}

function setConnection(kind, label) {
  $("connDot").className = `dot ${kind}`;
  $("connLabel").textContent = label;
}

function describe(result) {
  switch (result.status) {
    case "replaced":
      return `${result.dateStr}: replaced (${result.replaced} old entr${result.replaced === 1 ? "y" : "ies"} removed)`;
    case "created":
      if (mode === "entry") return `${result.dateStr}: time entries created`;
      return result.approved
        ? `${result.dateStr}: created & approved`
        : `${result.dateStr}: created (pending approval${result.approveError ? " — " + result.approveError : ""})`;
    case "exists":
      return `${result.dateStr}: already filled`;
    case "skipped":
      return `${result.dateStr}: skipped (${result.reason})`;
    case "error":
      return `${result.dateStr}: error — ${result.error}`;
    default:
      return `${result.dateStr}: ${result.status}`;
  }
}

function kindOf(results) {
  if (results.some((r) => r.status === "error")) return "bad";
  if (results.some((r) => r.status === "created" || r.status === "replaced")) return "ok";
  return "";
}

// Returns the chosen existing-day policy, or null if the user cancelled the
// destructive confirmation.
function existingPolicy(scopeText) {
  const onExisting = $("onExisting").value;
  if (onExisting === "replace") {
    const ok = window.confirm(
      `Replace mode deletes ALL of your existing time entries on every already-filled day ${scopeText} ` +
      "and books your configured blocks instead.\n\nThis cannot be undone. Continue?"
    );
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
  $("nextRun").textContent = res.nextRun ? `Next run: ${fmtTime(res.nextRun)}` : "Off";
  if (res.lastAutoRun) {
    const when = new Date(res.lastAutoRun.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    $("lastRun").textContent = `Last auto: ${when} · ${res.lastAutoRun.status}`;
  }
  const versionEl = $("versionInfo");
  versionEl.className = "";
  if (res.update) {
    versionEl.textContent = `v${res.version} · update ${res.update.latest} available`;
    versionEl.className = "warn";
  } else if (res.updateInfo?.checkedAt) {
    const checked = new Date(res.updateInfo.checkedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    versionEl.textContent = `v${res.version} · up to date (checked ${checked})`;
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

async function init() {
  const cfg = await loadConfig();
  mode = cfg.mode;
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
  const onExisting = existingPolicy("(today)");
  if (!onExisting) return;
  const res = await run($("fillTodayBtn"), "Filling today…", () => send({ action: "fillToday", onExisting }));
  if (res) setStatus(describe(res.result), kindOf([res.result]));
});

$("fillRangeBtn").addEventListener("click", async () => {
  const from = $("fromDate").value;
  const to = $("toDate").value;
  if (!from || !to) return setStatus("Pick both dates first.", "bad");
  if (from > to) return setStatus("\"From\" must be before \"To\".", "bad");
  const onExisting = existingPolicy(`between ${from} and ${to}`);
  if (!onExisting) return;
  const res = await run($("fillRangeBtn"), "Filling range…", () => send({ action: "fillRange", from, to, onExisting }));
  if (res) setStatus(res.results.map(describe).join("\n"), kindOf(res.results));
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

init();
