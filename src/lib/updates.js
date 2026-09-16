// updates.js — optional "new version available" check against the public GitHub repo.
// Load-unpacked extensions never auto-update, so this is how users learn about a
// new release. It fetches ONE public file (manifest.json of the default branch),
// sends no data, and can be switched off in Options.

// Set to "owner/repo" of the GitHub repository. Leave as is to disable the check.
export const GITHUB_REPO = "mohasoori/clockodo-autofill";
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;

// Chrome adds `update_url` to the manifest of Web Store installs — those
// receive updates from the store, so the GitHub check is unnecessary there.
export const installedFromStore = () => Boolean(chrome.runtime.getManifest().update_url);
export const updateCheckConfigured = () => !GITHUB_REPO.startsWith("OWNER/") && !installedFromStore();

// Returns 1 if a > b, -1 if a < b, 0 if equal. Accepts "1.2.3" style versions.
export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Resolves to { latest, current, available, checkedAt, url } or null when disabled.
export async function fetchLatestVersion() {
  if (!updateCheckConfigured()) return null;
  const current = chrome.runtime.getManifest().version;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const { version } = await res.json();
    if (typeof version !== "string") throw new Error("No version in remote manifest");
    return {
      latest: version,
      current,
      available: compareVersions(version, current) > 0,
      checkedAt: Date.now(),
      url: RELEASES_URL,
    };
  } finally {
    clearTimeout(timer);
  }
}
