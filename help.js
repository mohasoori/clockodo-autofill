// help.js — fills in the running version (works only when opened as an extension page).
const el = document.getElementById("appVersion");
if (el && typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
  el.textContent = `v${chrome.runtime.getManifest().version}`;
}
