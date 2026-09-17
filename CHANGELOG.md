# Changelog

All notable changes to Clockodo Auto-Fill. Versions follow
[Semantic Versioning](https://semver.org/); the current version is the
`version` field in `manifest.json` and is shown in Options and the Help page.

## [1.3.8] — 2026-09-17

### Changed
- Releases are now automated: pushing a `v*` tag builds the package,
  publishes the GitHub release and uploads to the Chrome Web Store.
  No functional changes.

## [1.3.7] — 2026-09-17

### Security
- Options never writes the stored API key back into the page. The field
  shows only `Saved · ends in …xxxx`; typing a new key replaces it, leaving
  it empty keeps the current one. (Switching the input to `type=text` in
  DevTools therefore reveals nothing.)

### Changed
- Now available on the Chrome Web Store — the recommended install with
  automatic updates. README, guide and listing updated.
- Help page links to the GitHub repository, latest release, issues and the
  privacy policy.

## [1.3.6] — 2026-09-16

### Changed
- Popup: compact footer (`v1.3.6 · up to date`); the last automatic run is
  shown under the Auto-fill toggle (`Next run … · last: Sep 16 ✓`).
- Installs from the Chrome Web Store skip the GitHub update check — Chrome
  updates them itself. Options → Updates says so.

### Fixed
- Notification icon is embedded as a data URL, so image loading can never
  fail.

## [1.3.5] — 2026-09-16

### Fixed
- Notification icons are resolved with `chrome.runtime.getURL`, removing the
  "Unable to download all specified images" error that could appear in the
  extension's error log.

## [1.3.4] — 2026-09-15

### Fixed
- Manifest description shortened to fit the Chrome Web Store's 132-character
  limit (upload was rejected).

## [1.3.3] — 2026-09-15

### Changed
- Popup: *Fill range* uses a secondary (soft accent) button style so it is
  visually distinct from *Fill today*.

## [1.3.2] — 2026-09-15

### Added
- Quick range buttons in the popup — **This week / Last week / This month**
  — set both dates at once and show how many workdays that covers.
- The range status now states the exact range being booked
  (`Filling 2026-09-15 → 2026-09-19…`) and the summary repeats it, so a
  date picker that didn't register is obvious.

## [1.3.1] — 2026-09-15

### Changed
- Random mode draws **fresh values on every fill** (start, break length,
  morning/afternoon split 35–65 %) instead of reproducing the same times per
  date; running *Replace* re-rolls a day. New **Break ± variation** setting
  (default ±10 min).
- Range results start with a summary line, e.g. `5 days: 4 replaced · 1 skipped`.

## [1.3.0] — 2026-09-15

### Added
- **Random start, fixed duration** schedule mode (Options → Working hours).
  Set the exact daily total (e.g. 8 h 23 min), an optional break, and a
  start window (e.g. 07:30–09:30). Each day gets a different start time
  inside the window; the end follows from the duration. Live preview of the
  next five workdays. The existing fixed-blocks mode is unchanged and remains
  the default.
- Popup results now list the booked times (e.g. `08:13–12:52, 13:52–17:36`).

## [1.2.2] — 2026-09-15

### Fixed
- After updating the extension itself, the popup could still claim the
  now-installed version was "available": the stored update-check result is
  now re-evaluated against the running version.

## [1.2.1] — 2026-09-15

### Added
- Popup footer shows the installed version and the result of the last update
  check ("up to date (checked Sep 15)" or "update X.Y.Z available").

## [1.2.0] — 2026-09-15

### Added
- **Conflict handling** — the popup has "If a day already has any time
  entry": *Skip that day* (default) or *Replace* (delete all of that day's
  entries and book your blocks; asks for confirmation). Applies to *Fill
  today* and *Fill range*. Use Replace to clean up accidental duplicates.
- **Update notice** — daily check of the public GitHub `manifest.json`; a
  notification and a popup banner link to the download page when a newer
  version exists. Opt-out in Options → Updates; Web Store installs don't
  need it.
- **Security & privacy** section in the guide, README and user guide;
  `docs/PRIVACY.md` (privacy policy) and `docs/STORE_LISTING.md` (Chrome Web
  Store checklist + listing text).

### Changed
- Repository layout: source under `src/` (background, lib, popup, options,
  help, styles), icons under `assets/`, release script in `scripts/`.
  `manifest.json` stays at the root. No functional change.

### Fixed
- **Duplicate check was silently broken**: `/workTimes` rejects ISO
  timestamps (`Wrong date format`), and the old code swallowed the error and
  booked anyway. In time-entry mode the check now looks at your actual time
  entries for the day; in change-request mode it uses plain dates. Any error
  aborts instead of booking.
- Legacy 1.0.x hours (two fixed blocks) are migrated correctly.
- Daily alarm is a one-shot rescheduled after every run, so the wall-clock
  time survives DST changes; startup, install and alarm runs are serialised
  so they cannot double-book; a failed run no longer blocks same-day catch-up.
- Entry mode is transactional per day: if a later block fails, entries
  already created that day are removed again.
- Timezone math near DST transitions and for UTC+13/+14 zones.
- Options Save no longer clears a saved customer/service when the pick list
  isn't loaded; Options mirrors auto-fill/skip changes made from the popup.
- Popup toggles surface errors and revert instead of reporting success.
- `X-Clockodo-External-Application` is a constant integration identifier
  instead of the user's (possibly truncated) email.
- Range fill fetches existing bookings with one request for the whole range.

## [1.1.0] — 2026-09-15

### Added
- **Flexible working blocks** — one block by default; add up to six per day.
  Gaps between blocks are breaks. Live day timeline, per-block duration,
  break chips and a daily total in Options.
- **Configurable timezone** — pick any IANA zone. Block times, the auto-fill
  time, "today", weekend detection and the duplicate check all use it.
- **Auto-fill catch-up** — if the scheduled time already passed (Chrome was
  closed, or auto-fill was enabled late), it runs once on launch/enable.
  Popup shows *Next run* and the last automatic result.
- **Customer & service picker** — loads real lists from Clockodo; lists are
  cached so Options always shows them.
- **Illustrated guide** (`help.html`), Markdown user guide, printable PDF,
  developer guide, MIT license.

### Changed
- Default booking mode is **Time entries**: accounts that derive attendance
  from entries reject standalone working-time change requests
  (`Work times must match the day's entries`).
- Options and popup redesigned (shared `theme.css`, cards, toggles, dark mode,
  sticky Save bar). New icon.
- Status messages are colour-coded (green success, red error) and show the
  real API message.

### Fixed
- `/api/v2/users` is retired by Clockodo (410) — the extension now resolves
  the user via `/api/v4/users/me`.
- Change-request approval endpoint moved to v3; interval `type` must be the
  number `1`, not `"add"`.
- Timestamps must not carry milliseconds; `X-ClockodoEnableIsoUtcDateTimes`
  header is now sent.
- Removed `default_locale` from the manifest, which blocked *Load unpacked*.

### Security / robustness
- Message listener accepts only messages from the extension itself.
- Range fill validates dates and is capped at 92 days.
- 30 s request timeout; schedule validated on Save and before every fill.
- `rel="noopener noreferrer"` on external links.

## [1.0.0] — 2026-09-15

- Initial release: one-click today, date-range fill, scheduled daily fill,
  per-day opt-out, fixed morning/afternoon blocks, duplicate protection.
