# Clockodo Auto-Fill

Chrome extension (Manifest V3) that fills your daily Clockodo working times —
one click, a date range, or automatically every workday. Uses each user's own
personal Clockodo API key; no password ever stored or shared.

## Install (load unpacked)

1. Unzip `clockodo-autofill.zip` (or clone this folder) somewhere permanent —
   Chrome loads it from disk, don't delete it afterwards.
2. Go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**, select this folder.
5. Pin the extension (puzzle-piece icon → pin) for easy access.

## First-time setup (each user does this once)

1. Open Clockodo → **My area → Edit self**
   (https://my.clockodo.com/en/users/editself) and copy your **personal API key**.
   This is *not* your login password.
2. Click the extension icon → **Options…**.
3. Enter your Clockodo login email and the API key.
4. Click **Test connection** — should show a green check with your name.
5. Set your work hours (block 1 / break / block 2), weekend-skip, and — if you
   want it automatic — enable **Auto-fill every workday at HH:MM**.
6. Click **Save**.

## Using it

- **Popup → Fill today**: fills today, unless already filled or opted out.
- **Popup → Fill range**: pick from/to dates, fills every workday in between
  (skips weekends and opt-out dates automatically).
- **Skip today** toggle: adds/removes today from the opt-out list.
- **Auto-fill daily** toggle: schedules a `chrome.alarms` job. It only fires
  while Chrome is running — if your laptop was off at the scheduled time, it
  fires next time Chrome starts. Not real cron; acceptable for this use case.
- **Options → Opt-out dates**: add/remove specific dates that should never be
  auto-filled (holidays, sick days, etc).

## ⚠️ Verify the API endpoint before relying on this

The public Clockodo docs describe attendance edits as a **work-times change
request** (`POST /api/v2/workTimes/changeRequests`, then
`POST .../{id}/approve`), which is what `clockodo-api.js` calls by default.
The exact path is **not 100% confirmed** from public docs alone. Before
trusting the daily auto-fill:

1. Open Clockodo's Timetable page in a normal browser tab.
2. Open DevTools → **Network**, filter to `Fetch/XHR`.
3. Manually add one working-time block for a day with no entries yet.
4. Look at the request that fires: note its **URL** and **JSON body shape**.
5. If it differs from `EP.changeRequestCreate` / `EP.changeRequestApprove` in
   [clockodo-api.js](clockodo-api.js), update those two constants and the
   `changes` payload field names in `fillDayAsWorkTime()` to match exactly.
6. If your organization actually uses plain time entries (Zeiterfassung)
   instead of a timetable/attendance concept, switch **Options → Mode** to
   "Time entries" and fill in your Customer ID / Service ID — that path
   (`POST /api/v2/entries`) is fully documented and needs no approval step.

Do this once; after that the same shape is stable for everyone using the
extension.

## How auth works

- `X-ClockodoApiUser`: your login email
- `X-ClockodoApiKey`: your personal API key (from step 1 above)
- `X-Clockodo-External-Application`: `"ClockodoAutoFill;you@company.com"`
- All requests go straight from your browser to `https://my.clockodo.com` —
  nothing is sent anywhere else. The key lives only in `chrome.storage.local`
  on your machine.

## Distributing to colleagues

- **Simplest:** zip this folder (exclude `PROMPT.md`) as `clockodo-autofill.zip`,
  send it. Each person unzips and does **Load unpacked** as above, then enters
  their *own* email + API key.
- **Chrome Web Store (unlisted):** pay the one-time $5 developer registration,
  upload as an **unlisted** item, share the store link — colleagues install
  normally, updates auto-push.
- **Google Workspace admin (force-install):** if your org's Chrome policy
  allows it, IT can push the extension to everyone automatically via the
  Google Admin console.

No matter the distribution method, no shared secrets are involved — everyone
authenticates with their own Clockodo API key.

## File layout

```
manifest.json       MV3 manifest
clockodo-api.js      API client, config store, timezone/date helpers
background.js        service worker: alarm scheduling + message router
popup.html/js        one-click today / range fill / toggles
options.html/js      account setup, hours, schedule, opt-out dates
icons/               16/48/128 px icons
```
