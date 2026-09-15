# Clockodo Auto-Fill — Developer Guide

Plain Manifest V3 Chrome extension. Vanilla JS (ES modules), no build step,
no dependencies. Clone → `chrome://extensions` → Load unpacked → hack.

---

## Layout

```
manifest.json      MV3 manifest (permissions: storage, alarms, notifications;
                   host_permissions: https://my.clockodo.com/*)
clockodo-api.js    API client + config store + date/timezone helpers (pure module)
background.js      service worker: daily alarm, catch-up, message router
popup.html/js      action popup
options.html/js    settings page
updates.js         new-version check (GITHUB_REPO constant; disabled until set)
help.html/js       illustrated end-user guide + what's new (help.js only injects the version)
theme.css          shared design tokens, light/dark
icons/             16/48/128 px
docs/              this file, USER_GUIDE.md, PDF guide
CHANGELOG.md       release notes (keep in sync with manifest version)
```

## Architecture

```
 popup.js ──┐                       ┌── chrome.alarms (daily)
 options.js ├─ chrome.runtime ──▶ background.js ─┤
            │  sendMessage         (handle())    └── chrome.notifications
            │                          │
            └───────── import ─────────┴──▶ clockodo-api.js ──▶ fetch my.clockodo.com
```

- **All network calls live in `clockodo-api.js`.** UI pages import it only for
  `loadConfig`/`saveConfig`/`todayStr`/`validateSchedule` and constants;
  anything that hits the API goes through a message to the service worker so
  behaviour is identical for the popup, options and the alarm.
- **`background.js`** owns scheduling. `rescheduleAlarm(cfg)` creates a
  **one-shot** `chrome.alarms` alarm at the next `cfg.autoTime` in
  `cfg.timezone`; `onAlarm` runs the fill and reschedules, so the wall-clock
  time survives DST changes (a fixed 24 h period would drift an hour).
  `catchUpIfMissed(cfg)` runs on `onInstalled`, `onStartup` and when auto-fill
  is enabled: if today's time already passed and today has not been handled
  successfully (`lastAutoRun.status !== "error"`), it fills now.
  `runAutoFill()` is serialised through a module-level in-flight promise so
  startup, install and a persisted alarm cannot double-book; it persists the
  result to `chrome.storage.local.lastAutoRun` and notifies only on
  `created`/`error`.
- **Messages** (`{ action, ...payload }` → `{ ok, ... }` or `{ error }`):

  | action               | payload             | returns                          |
  |----------------------|---------------------|----------------------------------|
  | `testConnection`     | —                   | `usersId`, `name` (also saved)   |
  | `fillToday`          | `force?`            | `result`                         |
  | `fillRange`          | `from`, `to`, `force?` | `results[]` (≤ 92 days)      |
  | `toggleSkipToday`    | —                   | `skippedToday`                   |
  | `setAutoDaily`       | `enabled`           | `nextRun` (ms epoch)             |
  | `rescheduleAlarm`    | —                   | `nextRun`                        |
  | `getStatus`          | —                   | `nextRun`, `lastAutoRun`         |
  | `listCustomers`      | —                   | `customers[{id,name}]`           |
  | `listServices`       | —                   | `services[{id,name}]`            |

  The listener rejects messages whose `sender.id !== chrome.runtime.id`.

## Config schema (`chrome.storage.local.config`)

See `DEFAULT_CONFIG` in `clockodo-api.js`. Notable fields:

| key            | type              | notes                                             |
|----------------|-------------------|---------------------------------------------------|
| `apiUser`      | string            | login email → `X-ClockodoApiUser`                 |
| `apiKey`       | string            | personal key → `X-ClockodoApiKey`                 |
| `usersId`      | number            | resolved via `/api/v4/users/me`                   |
| `mode`         | `"entry"`/`"worktime"` | default `entry` (see *Why entry mode*)       |
| `customersId`, `servicesId`, `billable` | number | entry mode only                    |
| `blocks`       | `{start,end}[]`   | `"HH:MM"` wall-clock in `timezone`; ordered, non-overlapping, ≤ 6. Legacy `block1Start…block2End` is migrated on load. |
| `timezone`     | IANA string       | default `Europe/Berlin`; validated with `Intl`   |
| `skipWeekends` | bool              |                                                   |
| `skipDates`    | `"YYYY-MM-DD"[]`  | never fill                                        |
| `autoDaily`, `autoTime` | bool, `"HH:MM"` |                                            |

Other storage keys: `lastAutoRun` (result + `at`), `pickLists`
(cached customers/services for the Options dropdowns).

## Clockodo API notes (things that bit us)

Base: `https://my.clockodo.com/api`. Header auth:

```
X-ClockodoApiUser: <user's login email>
X-ClockodoApiKey: <user's personal key>
X-Clockodo-External-Application: ClockodoAutoFill;contact@msoori.com
X-ClockodoEnableIsoUtcDateTimes: 1
```

`X-Clockodo-External-Application` identifies the *integration* and its
technical contact (≤ 50 chars) — it is a constant, not the end user's email.

| Purpose                     | Endpoint                                         | Version |
|-----------------------------|--------------------------------------------------|---------|
| current user                | `GET  /api/v4/users/me`                          | v4 (`/v2/users` is **410 Gone**) |
| customers / services        | `GET  /api/v3/customers`, `GET /api/v4/services` | paginated: `?page=`, `paging.count_pages` |
| existing working time (dup check) | `GET /api/v2/workTimes?users_id&date_since&date_until` | v2 |
| create entry (entry mode)   | `POST /api/v2/entries`                           | v2 |
| change request (worktime)   | `POST /api/v2/workTimes/changeRequests`          | v2 |
| approve change request      | `POST /api/v3/workTimes/changeRequests/{id}/approve` | **v3**, not v2 |

Gotchas:

- Timestamps must be `YYYY-MM-DDTHH:MM:SSZ` — **no milliseconds**.
  `wallclockToUTC()` strips them. Always send the ISO header above.
- Change-request interval `type` is **numeric**: `1` = add, `2` = remove.
- **Why entry mode:** on accounts where attendance is derived from time
  entries, a standalone change request fails with
  `Work times must match the day's entries`. Creating entries is the path that
  works there, so `mode` defaults to `entry`.
- Error bodies vary (`{error}`, `{error:{message}}`, `{message}`, `{errors:[]}`);
  `extractErrorMessage()` normalises them.
- Endpoint versions were verified against the official `clockodo` npm SDK
  (peerigon/clockodo). When something starts returning 410/404, check that
  package's `dist/clockodo.js` for the current path.

## Timezone

`wallclockToUTC(dateStr, "HH:MM", cfg.timezone)` converts a wall-clock time in
the configured IANA zone to UTC using `Intl.DateTimeFormat`, so it is
DST-correct and independent of the machine's timezone. `todayStr()` and
`isWeekend()` likewise evaluate in `cfg.timezone`, not the local zone. The
Options page lists zones via `Intl.supportedValuesOf("timeZone")`.

## Safety properties worth keeping

- Duplicate protection: `fillDay()` checks existing working time first
  (`getFilledDays()` — one request for a whole range, `hasWorkTime()` for a
  single day) and **fails closed** — on any error or unexpected response
  shape nothing is inserted.
- Entry mode is transactional per day: if a later block's POST fails, the
  entries already created for that day are deleted again
  (`rollbackEntries`), so a day is never left half-booked.
- Config migration (`migrateStoredConfig`) runs on the raw stored object
  *before* defaults are merged, otherwise the non-empty default `blocks`
  would mask legacy `block1…/block2…` fields.
- `fillRange` is capped at 92 days and validates `YYYY-MM-DD`.
- Schedule (blocks + timezone) is validated (`validateSchedule`) both on Save
  and before every fill.
- Requests time out after 30 s (`AbortController`).
- All UI text is set via `textContent`; no `innerHTML` with dynamic data.
- No content scripts, no `externally_connectable`, host permission only for
  `my.clockodo.com`.

## Update check

Load-unpacked installs never auto-update, so `updates.js` fetches the public
`manifest.json` from `https://raw.githubusercontent.com/<GITHUB_REPO>/main/`
once a day (`clockodo-update-check` alarm) and compares versions. On a newer
version it shows a notification (click → releases page) and the popup shows a
banner. `GITHUB_REPO` must be set to `owner/repo`; while it still reads
`OWNER/REPO` the feature is inert. raw.githubusercontent.com serves
`Access-Control-Allow-Origin: *`, so no extra host permission is needed.
Users can disable it (`cfg.checkUpdates`). Web Store installs get real
auto-updates and don't need this.

## Local development

1. Edit files. 2. `chrome://extensions` → ⟳ on the card. 3. Re-open popup/options.

- Service-worker logs: extension card → **Inspect views: service worker**.
- Popup/options logs: right-click → Inspect.
- Alarms: `chrome.alarms.getAll(console.log)` in the service-worker console.
- To test catch-up: set `autoTime` in the past, toggle auto-fill off/on.

## Release

```powershell
Compress-Archive -Path manifest.json,clockodo-api.js,background.js,popup.html,popup.js,options.html,options.js,help.html,theme.css,README.md,LICENSE,icons -DestinationPath clockodo-autofill.zip -Force
```

Release checklist:

1. Bump `version` in `manifest.json` (SemVer). It is displayed in Options and
   Help via `chrome.runtime.getManifest().version`.
2. Add a section to `CHANGELOG.md` and update the "What's new" card in
   `help.html` (plus the version mentions in `README.md` / `docs/USER_GUIDE.md`).
3. Regenerate the PDF guide:
   `chrome --headless --print-to-pdf=docs/Clockodo-Auto-Fill-Guide.pdf file:///…/help.html`
4. Build the zip (above), tag `vX.Y.Z`, attach the zip to the GitHub release.
`.crx` packaging is deliberately not used: Chrome on Windows/macOS refuses
non-Web-Store `.crx` installs, so the only working distribution channels are
load-unpacked zips or the Chrome Web Store.

## Contributing

Issues and PRs welcome. Keep it dependency-free and readable; match the
existing style (no build step, ES modules, `theme.css` tokens for any UI).

Maintainer: Mohammad Soori — <contact@msoori.com> · <https://msoori.com>
