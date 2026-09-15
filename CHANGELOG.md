# Changelog

All notable changes to Clockodo Auto-Fill. Versions follow
[Semantic Versioning](https://semver.org/); the current version is the
`version` field in `manifest.json` and is shown in Options and the Help page.

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
- Duplicate check fails closed on network errors (no accidental double booking).
- 30 s request timeout; schedule validated on Save and before every fill.
- `rel="noopener noreferrer"` on external links.

## [1.0.0] — 2026-09-15

- Initial release: one-click today, date-range fill, scheduled daily fill,
  per-day opt-out, fixed morning/afternoon blocks, duplicate protection.
