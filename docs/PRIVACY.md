# Privacy Policy — Clockodo Auto-Fill

*Last updated: 2026-09-18*

Clockodo Auto-Fill is a browser extension that books your working time in
your own Clockodo account. It is developed by Mohammad Soori
(<contact@msoori.com>) and published under the MIT license.

## What the extension stores

All data is stored **only on your device**, in the extension's local storage
inside your browser profile (`chrome.storage.local`):

| Data                         | Purpose                                              |
|------------------------------|------------------------------------------------------|
| Clockodo login email         | Sent as `X-ClockodoApiUser` to authenticate with Clockodo |
| Clockodo personal API key    | Sent as `X-ClockodoApiKey` to authenticate with Clockodo |
| Your Clockodo user id / name | Shown in the popup; used as `users_id` in requests   |
| Your settings (hours, timezone, schedule, skip dates, customer/service) | To book the right times |
| Cached customer/service list, last auto-fill result, last update check | Convenience / status display |
| Activity log (dates and times the extension booked, result, device name) | Lets you see what the extension did; synced with settings (last 150 entries) |

**Sync between your devices (optional, on by default for settings):** the
extension mirrors your *settings* (hours, schedule, skip days, timezone,
customer/service, preferences) to `chrome.storage.sync`, which Chrome stores
in **your own Google account** and delivers to other Chrome profiles you are
signed into. Google encrypts this data in transit and at rest (end-to-end if
you set a Chrome sync passphrase). The developer has no access to it. The
**API key is excluded** unless you explicitly enable *Also sync my API key*.
Both can be switched off in Options → Sync & backup; switching off removes
the synced copy.

**Export / Import:** you can download your settings as a JSON file (with the
API key only if you tick the box) and import it elsewhere. The file is
written to your device only.

The Options page never displays the stored API key again (only its last
four characters). Uninstalling the extension deletes the local copy; the
synced copy is removed when you turn sync off or when Chrome Sync is cleared.

**Sign out vs. delete:** *Sign out* only disconnects — your email and key
stay saved. *Delete login data* permanently removes email, key, user id,
customer/service and the activity log from this device (and from synced
settings, if the key was synced). Turning off *Remember my API key* keeps
the key only for the current browser session (`chrome.storage.session`) —
never written to disk or synced; it is gone once Chrome closes.

Note that `chrome.storage.local` is protected by your operating-system
account, not encrypted separately by the extension — anyone with full access
to your logged-in user profile could read it, as with any browser data. Use
OS login protection and disk encryption, and revoke the key in Clockodo if a
device is lost.

## Where data is sent

- **`https://my.clockodo.com`** — the only service the extension talks to
  for its function. Requests use Clockodo's official public REST API and
  carry your email and API key so Clockodo can authenticate you. What is
  sent: the working times you configured, and read-only queries for your
  user record, customers, services and existing working times.
- **`https://raw.githubusercontent.com`** (optional, on by default, can be
  disabled in Options → Updates) — once a day the extension downloads the
  public `manifest.json` of this project to see whether a newer version
  exists. This request contains **no personal data**; it is an anonymous
  download of a public file. Users who install from the Chrome Web Store
  receive updates automatically and may turn this off.

No other servers are contacted. The developer operates **no backend**, has
no access to your data, and receives no telemetry, analytics, or crash
reports.

## What the extension does not do

- It does not read or modify any website you visit (no content scripts).
- It does not access browsing history, cookies, bookmarks or tabs, other
  than opening the download page when you click an update notification.
- It does not sell, share or transfer any data to third parties.

## Permissions explained

| Permission        | Why                                                        |
|-------------------|------------------------------------------------------------|
| `storage`         | Save your settings and API key locally, and sync settings between your own devices via Chrome Sync |
| `alarms`          | Run the daily auto-fill and the daily update check         |
| `notifications`   | Tell you when a day was booked, failed, or an update exists |
| `https://my.clockodo.com/*` | Call the Clockodo API                            |

## Security

Your API key is a Clockodo *personal API key*, not your password. You can
revoke it at any time in Clockodo (**My area → Edit self**), which
immediately disables the extension's access. The source code is public, so
you can verify every request the extension makes.

## Contact

Questions about this policy: <contact@msoori.com> · <https://msoori.com>
