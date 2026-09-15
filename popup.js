// popup.js
import { loadConfig, todayStr } from "./clockodo-api.js";

const $ = (id) => document.getElementById(id);

let mode = "entry";

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = text ? `show ${kind}` : "";
}

function describe(result) {
  switch (result.status) {
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
  if (results.some((r) => r.status === "created")) return "ok";
  return "";
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function refreshSchedule() {
  const res = await send({ action: "getStatus" });
  if (!res.ok) return;
  $("nextRun").textContent = res.nextRun ? `Next run: ${fmtTime(res.nextRun)}` : "Off";
  if (res.lastAutoRun) {
    const r = res.lastAutoRun;
    const when = new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    $("lastRun").textContent = `Last auto: ${when} · ${r.status}`;
  }
}

async function init() {
  const cfg = await loadConfig();
  mode = cfg.mode;
  const today = todayStr(cfg.timezone);
  $("fromDate").value = today;
  $("toDate").value = today;
  $("autoDailyToggle").checked = !!cfg.autoDaily;
  $("skipTodayToggle").checked = (cfg.skipDates || []).includes(today);
  refreshSchedule();

  if (!cfg.apiUser || !cfg.apiKey) {
    $("connDot").className = "dot bad";
    $("connLabel").textContent = "Not configured — open Options";
    return;
  }
  try {
    const res = await send({ action: "testConnection" });
    $("connDot").className = res.ok ? "dot ok" : "dot bad";
    $("connLabel").textContent = res.ok ? (res.name || cfg.apiUser) : (res.error || "Connection failed");
  } catch (e) {
    $("connDot").className = "dot bad";
    $("connLabel").textContent = e.message;
  }
}

$("fillTodayBtn").addEventListener("click", async () => {
  const btn = $("fillTodayBtn");
  btn.disabled = true;
  setStatus("Filling today…");
  try {
    const res = await send({ action: "fillToday" });
    if (res.ok) setStatus(describe(res.result), kindOf([res.result]));
    else setStatus(`Error: ${res.error}`, "bad");
  } catch (e) {
    setStatus(`Error: ${e.message}`, "bad");
  } finally {
    btn.disabled = false;
  }
});

$("fillRangeBtn").addEventListener("click", async () => {
  const from = $("fromDate").value;
  const to = $("toDate").value;
  if (!from || !to) return setStatus("Pick both dates first.", "bad");
  if (from > to) return setStatus("\"From\" must be before \"To\".", "bad");
  const btn = $("fillRangeBtn");
  btn.disabled = true;
  setStatus("Filling range…");
  try {
    const res = await send({ action: "fillRange", from, to });
    if (res.ok) setStatus(res.results.map(describe).join("\n"), kindOf(res.results));
    else setStatus(`Error: ${res.error}`, "bad");
  } catch (e) {
    setStatus(`Error: ${e.message}`, "bad");
  } finally {
    btn.disabled = false;
  }
});

$("autoDailyToggle").addEventListener("change", async () => {
  const enabled = $("autoDailyToggle").checked;
  await send({ action: "setAutoDaily", enabled });
  await refreshSchedule();
  setStatus(enabled ? "Auto-fill enabled. Runs at the scheduled time while Chrome is open; catches up on launch if missed." : "Auto-fill disabled.");
});

$("skipTodayToggle").addEventListener("change", async () => {
  const res = await send({ action: "toggleSkipToday" });
  if (res.ok) {
    $("skipTodayToggle").checked = res.skippedToday;
    setStatus(res.skippedToday ? "Today marked as skip." : "Today un-skipped.");
  }
});

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
