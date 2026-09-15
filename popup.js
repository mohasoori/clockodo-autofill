// popup.js
import { loadConfig, todayStr } from "./clockodo-api.js";

const connDot = document.getElementById("connDot");
const connLabel = document.getElementById("connLabel");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const fillTodayBtn = document.getElementById("fillTodayBtn");
const fillRangeBtn = document.getElementById("fillRangeBtn");
const autoDailyToggle = document.getElementById("autoDailyToggle");
const skipTodayToggle = document.getElementById("skipTodayToggle");
const statusEl = document.getElementById("status");
const optionsLink = document.getElementById("optionsLink");

function log(text) {
  statusEl.textContent = text;
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function describe(result) {
  switch (result.status) {
    case "created":
      return result.approved
        ? `${result.dateStr}: created & approved`
        : `${result.dateStr}: created (pending approval)`;
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

async function init() {
  const cfg = await loadConfig();
  const today = todayStr(cfg.timezone);
  fromDate.value = today;
  toDate.value = today;
  autoDailyToggle.checked = !!cfg.autoDaily;
  skipTodayToggle.checked = (cfg.skipDates || []).includes(today);

  if (!cfg.apiUser || !cfg.apiKey) {
    connDot.className = "dot bad";
    connLabel.textContent = "Not configured — open Options";
    return;
  }

  try {
    const res = await send({ action: "testConnection" });
    if (res.ok) {
      connDot.className = "dot ok";
      connLabel.textContent = res.name || cfg.apiUser;
    } else {
      connDot.className = "dot bad";
      connLabel.textContent = res.error || "Connection failed";
    }
  } catch (e) {
    connDot.className = "dot bad";
    connLabel.textContent = e.message;
  }
}

fillTodayBtn.addEventListener("click", async () => {
  fillTodayBtn.disabled = true;
  log("Filling today…");
  try {
    const res = await send({ action: "fillToday" });
    log(res.ok ? describe(res.result) : `Error: ${res.error}`);
  } catch (e) {
    log(`Error: ${e.message}`);
  } finally {
    fillTodayBtn.disabled = false;
  }
});

fillRangeBtn.addEventListener("click", async () => {
  if (!fromDate.value || !toDate.value) {
    log("Pick both dates first.");
    return;
  }
  fillRangeBtn.disabled = true;
  log("Filling range…");
  try {
    const res = await send({
      action: "fillRange",
      from: fromDate.value,
      to: toDate.value,
    });
    log(res.ok ? res.results.map(describe).join("\n") : `Error: ${res.error}`);
  } catch (e) {
    log(`Error: ${e.message}`);
  } finally {
    fillRangeBtn.disabled = false;
  }
});

autoDailyToggle.addEventListener("change", async () => {
  await send({ action: "setAutoDaily", enabled: autoDailyToggle.checked });
  log(autoDailyToggle.checked ? "Auto-fill enabled." : "Auto-fill disabled.");
});

skipTodayToggle.addEventListener("change", async () => {
  const res = await send({ action: "toggleSkipToday" });
  if (res.ok) {
    skipTodayToggle.checked = res.skippedToday;
    log(res.skippedToday ? "Today marked as skip." : "Today un-skipped.");
  }
});

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
