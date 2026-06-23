# Drafthaus Lite — Multiple Named Share Trays + Drag-Reorder + Live Viewer — Design

**Date:** 2026-06-23
**App:** Drafthaus **Lite** (`lite-*.html` / root `index.html`) — NOT the full app (`full.html`).
**Status:** Approved design, pre-plan.
**Build base:** `lite-1.070.html` (currently == `index.html` == `drafthaus.ca`, md5
`ebb5f00bb16b8e736ab752e2adac2ae6`). Branch → **`lite-1.071.html`**; md5-verify base before
copying (base-drift trap). Promote into `index.html` after on-device sign-off.

Extends the shipped single-tray share feature
(`docs/superpowers/specs/2026-06-21-lite-share-takes-link-design.md`).

---

## 1. Goal

Three extensions to the public share feature:
1. **Multiple named share trays** per user (e.g. "Band demos", "Mix feedback"), each with its
   own stable `?share=<id>` link.
2. **Drag-reorder** of takes within a tray (the order viewers see).
3. **Live viewer** — open share pages update in place via `onSnapshot` (add/remove/reorder/
   revoke) without a reload and without interrupting the listener's playback.

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Trays per user | **Many** named `shares` docs (was exactly one). |
| Add-to-tray UX | Per-take share icon opens a **tray picker** popover: a checklist of trays (✓ = take is in it, tap toggles) + **"+ New tray…"**. A take may be in **multiple** trays. Icon is "filled" when the take is in ≥1 tray. |
| Manager | **Two-level**: tray **list** (name, take-count, on/off toggle, **Copy Link** icon, "+ New tray") → tray **detail** (drag-reorder takes + remove, Copy Link, Rename, Delete, on/off, back). |
| Copy Link placement | **On each tray-list row AND inside tray detail** (copy-to-clipboard + toast; not the native share sheet). |
| Ordering | `takes[]` array order **is** the order; drag-reorder rewrites the array. No new field. |
| Existing tray migration | Nameless doc → displays as default **"Shared takes"**; **link unchanged**; `name` written on first edit. Non-destructive. |
| Live viewer | `onSnapshot` replaces the one-time `get`; re-render preserves the playing take + position + displayed lyrics. `active:false`/deleted → "unavailable" + stop playback. |
| Header | Viewer header shows the tray `name` alongside "Shared with you". |
| Deferred (NOT built) | Tap-a-chord-in-viewer; native share sheet for links; per-tray cover art; viewer comments. |

## 3. Data model

Same `shares` collection, now **many docs per owner**, each gaining `name`:

```
shares/<randomId>
  ownerId:  <uid>
  name:     <string>           // NEW. Missing on legacy doc → display "Shared takes".
  active:   true               // per-tray revoke
  updatedAt
  takes: [ {takeId,songId,songTitle,lyricsDoc,downloadUrl,duration,mimeType,addedAt}, … ]
```

- **Discovery:** `shares where ownerId == uid` returns **all** the owner's trays (the owner-only
  `list` rule already permits this; public still gets a single doc by id). No localStorage
  single-id cache anymore — load the list into memory `_shareTrays`.
- **Order:** `takes[]` order is canonical; reorder = rewrite array; viewer renders in order
  (already does).
- **Membership:** a `takeId` may appear in several trays' `takes[]`.
- **No Firestore rule change** — the existing `shares` rules
  (`docs/superpowers/specs/2026-06-21-lite-share-firestore-rules.md`) already cover
  per-doc owner writes + public `get` / owner `list`. `name` is just another owner-written field.

## 4. Owner state & functions (replaces the single-tray block)

Replace `_shareId/_shareTakes/_shareActive` (single) with:

```
let _shareTrays = [];        // [{ id, name, active, takes:[…] }, …] — all of the owner's trays
let _shareTraysLoaded = false;
let _shareUnsub = null;      // snapshot listener on the owner's shares query (live manager)
let _shareOpenTrayId = null; // which tray's detail is showing (null = tray-list view)
```

Functions (top-level `function` decls so they're on `window`, per project convention):
- `shareLoadTrays()` → `onSnapshot(db.collection('shares').where('ownerId','==',uid))` → fill
  `_shareTrays` (sorted by name, legacy `name` → "Shared takes"), re-render manager + take icons.
  Single-flight; called on manager open + app-load (debounced).
- `shareCreateTray(name)` → `Promise<id>` — new doc `{ownerId, name, active:true, takes:[], updatedAt}`.
- `shareRenameTray(id, name)`, `shareDeleteTray(id)` (`.delete()`), `shareSetTrayActive(id, bool)`.
- `shareAddTakeToTray(id, take)` (dedupe by takeId; guard `take.downloadUrl`),
  `shareRemoveTakeFromTray(id, takeId)`.
- `shareReorderTray(id, fromIdx, toIdx)` → splice + write `takes`.
- `_shareWriteTray(id, fields)` → fire-and-forget `.set(fields,{merge:true}).catch()` (offline-safe).
- `shareTraysFor(takeId)` → `[trayId…]` the take is in. `shareIsShared(takeId)` → `shareTraysFor(takeId).length>0`.
- `shareTrayLink(id)` → `<origin><pathname>?share=<id>`; `shareCopyTrayLink(id)` → clipboard + toast.

`shareRefresh()` iterates **every** tray's `takes[]` (re-snapshot title/lyrics from `_songs`,
audio from loaded `_takes`), writing changed trays. Wired as today (app-load / lyrics-flush / trim).

## 5. Owner UI

### 5.1 Per-take tray picker
- The take row's `.take-share` button now calls `openTrayPicker(takeId, btnEl)` instead of a
  direct toggle. It renders a popover (`#trayPicker`, position:fixed near the button):
  one row per tray with a ✓ when `shareTraysFor(takeId)` includes it (tap → add/remove via
  `shareAddTakeToTray`/`shareRemoveTakeFromTray`), plus **"+ New tray…"** (prompt name →
  `shareCreateTray` → add). Closes on outside-tap / Esc.
- `.take-share` "filled" state = `shareIsShared(takeId)` (in ≥1 tray) — unchanged rule, new source.

### 5.2 Manager (`#sharePanel`, two-level)
- **Tray-list view** (`_shareOpenTrayId === null`): "+ New tray" header; one row per `_shareTrays`
  entry: name, take-count, **Copy Link** icon (`shareCopyTrayLink(id)`), on/off toggle
  (`shareSetTrayActive`). Tap a row (not the icons) → opens detail. Empty state when no trays.
- **Tray-detail view** (`_shareOpenTrayId === id`): back arrow → list; editable name (Rename),
  Copy Link, Delete (confirm), on/off; then the tray's takes as drag-reorderable rows
  (`.sm-row` + a drag handle + Remove).
- `renderShareManager()` branches on `_shareOpenTrayId`. `openShareManager()` loads trays and
  shows the list; `openTrayDetail(id)`/`shareBackToList()` switch views.

### 5.3 Drag-reorder
- Reuse the project's pointer-drag idiom (the pinned-rows engine: a `.drag-handle`, pointer
  move tracking, drop → commit). On drop, compute from/to and call `shareReorderTray(id, from, to)`.
  Keep it self-contained to the tray-detail list; touch + mouse (the iOS touch-drag gotcha:
  the draggable needs `touch-action:none` / `user-select:none`, per memory
  `drafthaus-ios-touch-drag-gotcha`).

## 6. Viewer (live)

- `shareViewLoad(id)` switches from `.get()` to `.onSnapshot()`:
  - First snapshot missing / `active:false` → `shareViewUnavailable()`.
  - Subsequent snapshots: if it becomes missing/`active:false` → unavailable + `svStop()`.
  - Otherwise call a new `shareViewApply(d)` that **diffs** rather than blindly re-rendering:
    rebuild `_svTakes` from `d.takes`, re-render the song list, but **preserve** `_svIdx`
    (playing), `_svSource`/playhead (don't restart audio), and `_svLyricsIdx` (displayed lyrics)
    by matching on `takeId`. If the playing/lyrics take vanished, keep the current audio playing
    to its end (buffer already loaded) and leave lyrics until the next user action.
  - Header shows `d.name || 'Shared takes'`.
- Unsubscribe on page hide is unnecessary (single page); keep the listener for the session.

## 7. Edge cases
- **Empty tray link** → viewer shows the friendly "nothing shared yet" (existing path).
- **Take removed while playing** → audio continues from its loaded buffer; the row disappears
  from the list on the live update; lyrics persist (per the shipped persist-past-stop behavior).
- **Tray deleted while viewing** → snapshot returns not-exists → unavailable + stop.
- **Legacy nameless tray** → shows "Shared takes" everywhere until renamed.
- **Guest owner** → same as today (anonymous uid owns the docs; standard guest caveats).
- **Many trays** → list scrolls; no cap (a `log`-free soft reality: typical users have a few).

## 8. Non-goals (v1)
Native share-sheet for links; tap-a-chord-in-viewer; per-tray artwork/description; reordering
*trays* (only takes within a tray); analytics.

## 9. Testing (`_verify_lite_1071.js`, Lite conventions — real HTTP, COMPUTED visibility)
- **Model:** `shareCreateTray` makes a named doc; `shareLoadTrays` lists multiple; legacy
  nameless doc → "Shared takes"; `shareTraysFor`/`shareIsShared` across multiple trays.
- **Tray ops:** rename, delete, set-active, add/remove take to a *specific* tray, take in two
  trays at once (toggle one, other unaffected).
- **Reorder:** `shareReorderTray` rewrites `takes[]` order; viewer renders the new order.
- **Picker:** `openTrayPicker` lists trays w/ correct ✓; toggling calls add/remove; "+ New tray".
- **Manager two-level:** list ↔ detail switch; Copy Link on a list row copies that tray's URL;
  COMPUTED-visible panel.
- **Viewer live:** stub an `onSnapshot` that emits a second snapshot → list re-renders, and a
  "playing" take (`_svIdx` set) is **preserved** (not reset) across the update; `active:false`
  second snapshot → unavailable + playback stopped.
- **Migration:** a nameless tray doc keeps its link (`shareTrayLink(id)` unchanged) and renders
  "Shared takes".
- **No-harm:** owner record/lyrics/chord/export paths unaffected; viewer still reads only `shares`.

## 10. Ship
Build on `lite-1.070.html` → `lite-1.071.html` (md5-verify base; diff the copy). Headless-verify;
commit to `main`; push (Pages deploy, user-gated). Promote into `index.html` after on-device
sign-off; update memory `drafthaus-lite.md` + `MEMORY.md`.
