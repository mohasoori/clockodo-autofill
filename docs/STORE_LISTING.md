# Chrome Web Store — publishing checklist & listing copy

Publishing gives colleagues one-click install and **real automatic updates**
(load-unpacked never updates itself). You can publish **unlisted** so only
people with the link can find it.

## One-time setup (done by the account owner)

1. Go to <https://chrome.google.com/webstore/devconsole> and register as a
   developer (one-time fee, Google account).
2. Build the zip (see `DEVELOPER.md` → Release). Make sure `manifest.json`
   has the right `version`.
3. **Add item** → upload the zip.
4. Fill in the listing (copy below), upload screenshots (1280×800 or 640×400
   PNG/JPEG — Options page, popup, Help page) and the 128×128 icon
   (`assets/icons/icon128.png`).
5. **Privacy** tab:
   - Single purpose: *Books the user's own working time in their Clockodo
     account.*
   - Permission justifications: see table in `PRIVACY.md`.
   - Data usage: declare **"Authentication information"** (email + API key)
     — stored locally, used only to authenticate with Clockodo, not sold,
     not transferred, not used for unrelated purposes.
   - Privacy policy URL: host `docs/PRIVACY.md` (e.g. the GitHub file URL or
     a page on msoori.com).
   - Remote code: **No** (all code is in the package).
6. **Distribution**: Visibility → *Unlisted* (link only) or *Public*.
7. Submit for review (typically 1–3 business days). Later versions: upload a
   new zip with a higher `version`; installed copies update automatically.

## Listing copy

**Name:** Clockodo Auto-Fill

**Summary (≤132 chars):**
Fill your daily Clockodo working times in one click, for a date range, or automatically every workday.

**Description:**

Clockodo Auto-Fill books your standard working day in Clockodo so you don't
have to do it by hand.

• One click — "Fill today" books your configured blocks.
• Date range — catch up after vacation; weekends and opted-out days are skipped.
• Automatic — runs every workday at the time you choose while Chrome is open,
  and catches up on the next launch if it was missed.
• Flexible hours — one or more working blocks per day (gaps are breaks), in
  your own timezone, DST-safe.
• Duplicate-safe — never books a day that already has working time.
• Skip days — quick "Skip today" toggle plus a list of dates to never fill.

Privacy first: everything runs in your browser. Your email and personal
Clockodo API key are stored only on your device and sent only to
my.clockodo.com through Clockodo's official REST API. No server, no
analytics, no account. Open source under the MIT license.

Setup takes a minute: paste your Clockodo API key (My area → Edit self),
test the connection, pick your customer/service and hours, save.

Not affiliated with or endorsed by Clockodo.

**Category:** Productivity · **Language:** English

**Support / homepage:** https://msoori.com · contact@msoori.com
