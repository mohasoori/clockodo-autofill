# Clockodo Auto-Fill

**Version 1.1.0** · [What's new](CHANGELOG.md) · MIT

A small Chrome extension (Manifest V3) that fills your daily working times in
[Clockodo](https://my.clockodo.com) — in one click, for a whole date range, or
automatically every workday.

Built for teams where everyone has to log the same standard day and nobody
enjoys doing it by hand. No server, no shared credentials: each user connects
with their **own** personal Clockodo API key, stored only in their browser.

## Features

- **Fill today** — one click from the popup.
- **Fill a date range** — e.g. after vacation; skips weekends and opted-out days.
- **Auto-fill every workday** — runs at a time you choose while Chrome is open,
  and catches up on next launch if that time already passed.
- **Skip days** — quick "Skip today" toggle plus a managed list of dates to never fill.
- **Configurable hours** — one or more working blocks per day (gaps = breaks),
  in any IANA timezone, DST-safe.
- **Duplicate-safe** — never books a day that already has working time.
- Light/dark theme, in-app illustrated guide (`help.html`).

## Compatibility

Works wherever Google Chrome runs — **Windows, macOS, Linux, ChromeOS** — and
in other Chromium browsers (Edge, Brave, Opera, Vivaldi) via the same
*Load unpacked* steps. Not available for Firefox or Safari.

## Install (load unpacked)

1. Download the latest release zip (or clone this repo) and unzip it to a
   folder you will keep.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the folder.
5. Pin the icon from the puzzle-piece menu.

## Setup (once per user)

1. In Clockodo, open **My area → Edit self**
   (<https://my.clockodo.com/en/users/editself>) and copy your **API key**.
   This is not your password.
2. Click the extension icon → **Options**.
3. Enter your login email + API key → **Test connection** → green check.
4. Under **What to book**, click **Load customers & services** and pick the
   customer/service your team uses for regular work.
5. Adjust hours and schedule if needed → **Save**.

The full illustrated walkthrough is in the extension itself: popup → **Help**.
Also available as [docs/USER_GUIDE.md](docs/USER_GUIDE.md) and a printable
[PDF](docs/Clockodo-Auto-Fill-Guide.pdf). Developers: see
[docs/DEVELOPER.md](docs/DEVELOPER.md).

## How it works

Clockodo's public REST API is called directly from the extension using header
auth (`X-ClockodoApiUser`, `X-ClockodoApiKey`, `X-Clockodo-External-Application`).

Attendance in Clockodo is derived from **time entries**, so the extension
creates two entries per day (`POST /api/v2/entries`) with your chosen customer
and service. A legacy "working-time change request" mode is kept as an option
for accounts that have a standalone timetable.

Everything runs client-side. Requests go from your browser to
`https://my.clockodo.com` and nowhere else.

## Security & privacy

- **Official API only** — every call goes through Clockodo's documented public
  REST API at `https://my.clockodo.com/api`. No scraping, no website automation.
- **Your data stays on your machine** — email, API key and settings are kept in
  the extension's local storage in your own Chrome profile. Nothing is synced,
  uploaded or shared. There is no server, no account, no analytics.
- **Single destination for your data** — credentials are only ever sent to
  `my.clockodo.com` (the only `host_permissions` entry), and only when you
  trigger a fill or the scheduled fill runs.
- **Optional update check** — once a day it downloads the public
  `manifest.json` from this repository to detect a newer release (no personal
  data in that request). Off switch in Options → Updates. Full policy:
  [docs/PRIVACY.md](docs/PRIVACY.md).
- **API key, not password** — regenerate the key in Clockodo any time to revoke
  access.
- **Nothing outside Chrome** — no cron job or background service; the daily fill
  is a Chrome alarm that runs while Chrome is open and catches up on next launch.
- **Everyone uses their own key** — the shared files contain no credentials.
- **Open source, MIT** — read exactly what is sent; uninstalling removes all data.

## Sharing with your team

- **Zip:** send the folder as a zip; each person loads it unpacked and enters
  their own API key.
- **Chrome Web Store (unlisted):** one-time developer registration, upload as
  an unlisted item, share the link — colleagues get automatic updates.
  Checklist and ready-made listing text: [docs/STORE_LISTING.md](docs/STORE_LISTING.md).
- **New-version notice:** load-unpacked installs don't auto-update, so the
  extension checks GitHub daily and shows a banner/notification with the
  download link when a newer version exists.
- **Managed Chrome:** IT can force-install via Google Admin if your org allows it.

## Project layout

```
manifest.json      MV3 manifest
clockodo-api.js    API client, config store, timezone/date helpers
background.js      service worker: daily alarm, catch-up, message router
popup.html/js      one-click today, range fill, toggles
options.html/js    account, booking target, hours, schedule, skip days
help.html/js       illustrated setup guide + what's new
updates.js         daily new-version check against the GitHub repo
theme.css          shared design tokens (light/dark)
icons/             16/48/128 px icons
docs/              user guide (md + pdf), developer guide, privacy policy, store listing
CHANGELOG.md       release notes
```

No build step, no dependencies — plain HTML/CSS/JS.

## License

MIT — see [LICENSE](LICENSE). Free to use, modify and share.

## Author

**Mohammad Soori** — <https://msoori.com> · <contact@msoori.com>

Clockodo is a trademark of its respective owner. This is an independent,
unofficial tool and is not affiliated with Clockodo.
