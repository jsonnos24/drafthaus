# Fix: saved takes show current time instead of creation time (Lite)

**Date:** 2026-07-14 · **App:** Drafthaus Lite · **Base:** `lite-1.080.html` (== `index.html`, md5-confirmed) · **Target:** `lite-1.081.html`

## Bug

Every take's displayed name (e.g. "Jul 14th - 3:42pm") silently updates to the
current time on every render, instead of showing when the take was recorded.
Present since lite-1.066 (P2 offline/outbox), when the sync drain became the
universal upload path.

## Root cause (three lines conspiring)

1. `uploadTake` writes the take doc with `createdAt: serverTimestamp()` — correct.
2. `liteSyncDrain`'s post-upload patch (the non-`replace` branch) includes
   `createdAt: job.createdAt`, where the outbox job's `createdAt` is `Date.now()`
   — a raw millisecond number meant only for job-queue ordering. The
   `set(..., {merge:true})` clobbers the Firestore Timestamp with that number.
3. `_takeDate(t)` only recognizes Timestamps (`.toDate` check); a plain number
   falls through to `new Date(t._localTs || Date.now())`, and `_localTs` is never
   set anywhere → renders "now" every time.

No data was lost: the clobbering number was captured at record time, so each
take's true creation time is still in Firestore, just as a number. Sorting
(`_ms`) already handles numbers.

## Fix (Option A — approved)

Two surgical edits in `lite-1.081.html`:

1. **`_takeDate`** — accept numeric `createdAt`:
   `typeof t.createdAt === 'number' → new Date(t.createdAt)`, keeping the
   existing Timestamp branch and final fallback. Fixes display for **all
   existing takes** with no migration.
2. **`liteSyncDrain` upload patch** — drop `createdAt` from the non-`replace`
   patch object so future takes keep their server Timestamp (the doc-first
   write already set it).

Out of scope (rejected/YAGNI): lazy migration of numeric values back to
Timestamps (numbers render and sort fine); the brief "now" shown while a
pending serverTimestamp is null (it is correct at that moment).

## Verification

Headless (playwright-core + installed Chrome, per the Lite verify recipe):
- `_takeDate({createdAt: <number>})` returns that instant, not now (assert a
  fixed past timestamp formats to its own date/time and is stable across two
  calls ~1s apart).
- Record a take (stubbed media), drain the outbox, assert the Firestore doc
  patch sent by the drain contains no `createdAt` key.
- Regression: run the lite-1.080 verify suite (24/24) against 1.081.

Then the usual flow: push `lite-1.081.html`, promote into `index.html` on user
confirmation, curl-md5 confirm both URLs.
