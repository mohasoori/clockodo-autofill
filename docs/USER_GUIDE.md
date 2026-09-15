# Clockodo Auto-Fill — User Guide

*For version 1.2.0 — see [CHANGELOG.md](../CHANGELOG.md) for what's new.*

Fill your daily Clockodo working times in one click, for a date range, or
automatically every workday. Each person uses their **own** Clockodo API key;
nothing is shared and nothing leaves your browser except requests to
`my.clockodo.com`.

> The same guide with illustrations is built into the extension:
> click the icon → **Help**. A printable copy is in
> [`Clockodo-Auto-Fill-Guide.pdf`](Clockodo-Auto-Fill-Guide.pdf).

---

## 1. Install

1. Unzip the release (or clone the repository) to a folder you will **keep** —
   Chrome loads the extension from there.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder.
5. Pin the icon via the puzzle-piece menu.

## 2. Get your personal API key

1. Sign in to Clockodo and open **My area → Edit self**
   (<https://my.clockodo.com/en/users/editself>).
2. Find the **API key** section and copy the key (generate one if empty).

This is **not** your password. The key is stored only in your browser's local
extension storage and is sent only to `my.clockodo.com`.

## 3. Connect

1. Click the extension icon → **Options**.
2. Enter your Clockodo login email and paste the API key.
3. Click **Test connection** — you should see your name with a green check.
4. Press **Save** in the top bar.

## 4. Choose customer & service

Clockodo derives attendance from **time entries**, so each booked block needs a
customer and a service.

1. Under **What to book**, keep mode = *Time entries*.
2. Click **Load customers & services** (the lists are remembered afterwards).
3. Pick the customer and service your team uses for regular work.
4. Leave *billable* off unless told otherwise. **Save**.

Not sure which to pick? Open any existing entry in Clockodo and use the same
customer/service shown there.

## 5. Working hours & timezone

You start with one block (default 09:00 – 17:00). Click **+ Add block** to
split the day; the gap between blocks is your break. Example:

| Block | Time          |
|-------|---------------|
| 1     | 08:30 – 13:00 |
| —     | break         |
| 2     | 14:00 – 17:30 |

The total per day is shown under the list. Choose your **Timezone** below the
blocks — all times are wall-clock in that zone and DST-aware.
Keep **Skip weekends** on unless you work weekends.

## 6. Automatic daily fill

- In **Schedule**, set the time (default 09:15) and enable
  **Auto-fill every workday**, then Save — or toggle **Auto-fill daily** in the popup.
- At that time, while Chrome is running, today is filled unless it is a
  weekend, an opted-out day, or already filled.
- If Chrome was closed at that time, it **catches up** on the next launch
  (once per day). Turning the toggle off/on after the time has passed also
  triggers an immediate catch-up.
- You get a notification only when something was created or failed.
- The popup shows **Next run** and the result of the last automatic run.

## 7. Day-to-day use (popup)

| Control            | What it does                                                    |
|--------------------|-----------------------------------------------------------------|
| **Fill today**     | Books today. Shows *created*, *already filled*, or *skipped*.   |
| **Fill range**     | Books every workday between From and To (max 92 days).          |
| **If a day already has any time entry** | *Skip that day* (default) never touches existing bookings. *Replace* deletes all entries on those days and books your blocks — confirmation required; use it to clean up duplicates. |
| **Auto-fill daily**| Enables/disables the schedule; shows next run.                  |
| **Skip today**     | Marks today as a day that must never be filled.                 |
| Green/red dot      | Whether the API key currently works.                            |

Manage the full list of skipped dates (holidays, sick days) in
**Options → Days to never fill**.

---

## Security & privacy — in plain words

- **Official API only.** The extension talks to Clockodo exclusively through
  its documented public REST API (`https://my.clockodo.com/api`) — the same
  one Clockodo's own integrations use. No scraping, no website automation,
  no hidden endpoints.
- **Your data stays on your computer.** Email, API key and settings live in
  the extension's local storage inside *your* Chrome profile. Never synced,
  uploaded or shared. There is no server behind this extension, no account,
  no analytics, no crash reporting.
- **Only one destination for your data.** Every request carrying your
  credentials goes to `my.clockodo.com`, and only when you click Fill / Test /
  Load or the scheduled fill runs. The extension has no permission for any
  other website.
- **Optional update check.** Once a day it downloads one public file (the
  project's `manifest.json` on GitHub) to see whether a newer version exists.
  That request contains no personal data. Turn it off in Options → Updates.
  If a new version exists you get a notification and a banner in the popup
  with the download link.
- **API key, not password.** You never enter your Clockodo password. The
  personal API key can be regenerated in Clockodo at any time, which
  instantly invalidates the old one.
- **Nothing runs without Chrome.** No background service, no cron job on your
  machine. The daily auto-fill is a Chrome alarm: it fires only while Chrome
  is running and catches up on the next launch if missed.
- **Everyone uses their own key.** Colleagues each enter their own
  credentials; nothing about your account is inside the shared files.
- **Open source (MIT).** Every line is readable in the repository. Uninstalling
  the extension deletes all stored data.

---

## FAQ & troubleshooting

**"Not configured — open Options"**
Email or API key missing. Do steps 2–3.

**"Entry mode needs a customer and a service"**
Do step 4: load the lists, select both, Save.

**"Work times must match the day's entries"**
You are in *Working-time change request* mode, but your Clockodo derives
attendance from entries. Switch mode to *Time entries*.

**"already filled" but I see nothing in Clockodo**
The extension found an existing time entry for that date (any entry counts,
even a different customer or a short one). Check the day in Clockodo; if it
should be your standard day, run again with *Replace*.

**I ended up with duplicate entries**
Select From/To covering those days, set "If a day already has any time entry"
to *Replace*, click **Fill range**, confirm. Each day is cleared and booked
exactly once.

**Auto-fill didn't run at the set time**
Chrome must be running. It catches up on next launch; toggling the switch also
triggers a catch-up when the time has passed.

**Can I change the hours later?**
Yes — Options → Working hours → Save. Future fills use the new times; existing
entries are not modified.

**Is anything sent anywhere besides Clockodo?**
No. There is no server, analytics, or shared storage. Requests go from your
browser straight to `my.clockodo.com` with your own API key.

---

Made by **Mohammad Soori** — <https://msoori.com> · <contact@msoori.com> — MIT License.
