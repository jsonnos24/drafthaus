# Compact take date format — design

**Date:** 2026-07-14
**App:** Drafthaus Lite (base: `lite-1.081.html`, currently promoted to `index.html`)
**Target version:** `lite-1.082.html`

## Problem

Take rows display dates in a long format — `July 14th, 2026 - 4:32pm` — which
consumes most of the take name line, especially on mobile. Renamed takes
(`Chorus idea - July 14th, 2026 - 4:32pm`) get truncated.

## Decision

Replace the date format with a compact `time - DD/MM/YY` form, **everywhere**
(mobile and desktop, all three surfaces):

- Unnamed take: `4:32pm - 14/07/26`
- Renamed take: `Chorus idea - 4:32pm - 14/07/26`

Format details:

- 12-hour time with lowercase am/pm, no leading zero on the hour, minutes
  zero-padded: `9:05am`.
- Date is day-first, all parts zero-padded, two-digit year: `03/07/26`.
- Separator between time and date is ` - ` (same dash used between a custom
  name and the date — accepted as-is).

## What changes

One formatter and its plumbing in `lite-1.082.html`:

1. **`fmtTakeDate(date)`** — rewritten to return `h:mmam - DD/MM/YY`. The
   `withYear` parameter is removed (the year is now 3 characters; no surface
   needs to hide it).
2. **`MONTHS` and `_ordinal`** — deleted (only `fmtTakeDate` used them).
3. **`takeDisplayName(t)`** — `withYear` parameter removed.
4. **Call sites updated** (three):
   - Take row `.nm` (was `takeDisplayName(t, true)`)
   - Bottom rail `railTakeName` (was `takeDisplayName(t, false)` — the rail
     previously hid the year; now shows it like everything else)
   - Share viewer take label (was `fmtTakeDate(_takeDate(take), true)`)

## What does not change

- **No data writes, no migration.** Dates are computed at render time from
  `createdAt`; nothing about the display format is persisted.
- **`_takeDate(t)` untouched** — keeps all three fallbacks (Firestore
  Timestamp, legacy number from the 1.081 sync-drain bug, `_localTs`).
- **Rename flow** — verified safe: `startRename` seeds the editor with only
  the stored `t.name` (never the rendered date string) and `commitRename`
  saves only the typed text, so the date cannot be baked into a name.
- **Sorting** — takes sort by raw `createdAt` ms, not the display string.
- Sub-line (`duration · FORMAT · size`), pinning, sharing, swipe actions.

## Known cosmetic effects (accepted)

- Desktop loses the long prose date (user chose "everywhere").
- Public `?share=` viewers see the new format.
- DD/MM/YY is day-first; US-convention readers could misread it. Accepted.

## Versioning & rollout

Standard Lite workflow: `cp lite-1.081.html lite-1.082.html` (diff the copy
against its source to confirm the base), edit `lite-1.082.html`, commit to
`main`. Push and promotion into `index.html` (the live root) only after user
confirmation — pushing deploys via GitHub Pages.

## Verification

New `_verify_lite_1082.js` (headless, playwright-core + installed Chrome, per
the existing recipe):

1. `fmtTakeDate(new Date(2026, 6, 3, 9, 5))` → `9:05am - 03/07/26` (padding on
   day/month/minutes, no padding on hour).
2. `fmtTakeDate` pm case and 12am/12pm edge: `new Date(2026, 11, 14, 0, 32)` →
   `12:32am - 14/12/26`; `12:00pm` at noon.
3. `takeDisplayName` with a custom name → `Name - 4:32pm - 14/07/26`; without
   → date only.
4. Legacy numeric `createdAt` (ms number) still formats via `_takeDate`.
5. Rendered take row `.nm`, rail `railTakeName`, and share-viewer label all
   show the new format (no `withYear` remnants, no month names anywhere).
6. Rename round-trip: startRename → type name → commit → `.nm` shows
   `Name - time - date` and the Firestore write contains only the typed name.

Then re-run the `_verify_lite_1081.js` regression suite (7/7) and the 1.080
suite (24/24 — its A3 block is timing-flaky; re-run before trusting a fail).
