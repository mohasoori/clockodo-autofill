// help.js — fills in the running version (only when opened as an extension page).
if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
  const version = chrome.runtime.getManifest().version;
  for (const el of document.querySelectorAll("[data-version]")) {
    el.textContent = el.dataset.version === "prefix" ? `v${version}` : version;
  }
}
