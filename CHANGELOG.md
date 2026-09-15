# Changelog

All notable changes to Clockodo Auto-Fill. Versions follow
[Semantic Versioning](https://semver.org/); the current version is the
`version` field in `manifest.json` and is shown in Options and the Help page.

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
