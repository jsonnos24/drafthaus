# Drafthaus Lite — Shareable Takes Link (public "tray") — Design

**Date:** 2026-06-21
**App:** Drafthaus **Lite** (`lite-*.html` / root `index.html`) — NOT the full app (`full.html`).
**Status:** Approved design, pre-plan.
**Build base:** `lite-1.069.html` (the true latest file — includes the half-width desktop
takes panel). ⚠️ `index.html` currently == `lite-1.068.html`; `1.069` is NOT yet promoted.
Branch the new work from `lite-1.069.html` → **`lite-1.070.html`**, verify base with `md5`
before copying (base-drift trap).

---

## 1. Goal

Let a user share recorded **takes** + their **lyrics** with friends/bandmates via a single
**stable link** that requires **no account** to open. The owner maintains one persistent
"tray" of takes; adding/removing takes never changes the link. Viewers see a list of rows
(one per take): play button left of the song title, a scrubbable waveform, and an
expandable Lyrics section.

## 2. Decisions (locked)

| Question | Decision |
|---|---|
| Share scope | A **curated set** ("playlist") of takes. |
| Row unit | **One take per row** (parent song's title + lyrics; same song can appear as 2 rows for 2 takes). |
| Curate flow | **Per-take "Add to share"** drops a take into a single persistent tray. |
| Tray count | **One persistent tray per user**, one stable link. |
| Privacy | **Anyone with the link** (unguessable, not listed/indexed); **revocable** (master on/off) + **per-take removal**. |
| Freshness | **Auto-refresh while the owner is in the app** — re-snapshot lyrics/audio on app open + on lyrics edit / take trim. |
| Tray management | **Share icon in the song-list header** → "My Shared Takes" panel (list, Copy Link, per-take remove, master on/off). |
| Viewer playback | **Auto-advance** to the next take when one ends; scrub to skip around. |
| Deferred (NOT in v1) | Drag-reorder of tray rows; tap-a-chord-in-viewer-to-see-its-shape; live onSnapshot updates in the viewer. |

## 3. Data model

One new collection, `shares`. The user has exactly one doc, keyed by a random unguessable
ID (e.g. 20+ chars from a URL-safe alphabet, generated client-side).

```
shares/<randomId>
  ownerId:   <uid>                 // the sharer
  active:    true                  // master on/off (revoke = false)
  updatedAt: serverTimestamp
  takes: [                         // ordered array = the tray (add order)
    {
      takeId:     <voice_takes doc id>,
      songId:     <songs doc id>,
      songTitle:  <string snapshot>,
      lyricsDoc:  <html string snapshot>,   // parent song's lyricsDoc
      downloadUrl:<Storage public URL>,     // audio source for the viewer
      duration:   <number, seconds>,
      mimeType:   <string>,
      addedAt:    <ms epoch, client>
    }, ...
  ]
```

- Entries are **denormalized snapshots** so a viewer reads ONLY this one doc — never the
  owner's `songs` or `voice_takes` collections. Minimal privacy surface.
- **Audio:** served via each take's existing Firebase Storage **download URL** (token-public
  by design). **No Storage rule change required.**
- **Find-my-tray on load:** query `shares where ownerId == auth.uid` (owner-only `list`,
  see rules). Cache the resolved `shareId` in `localStorage` (`dh-lite-shareId`) to avoid a
  query on every boot; the query is the source of truth across devices.
- Lyrics snapshot = the **parent song's `lyricsDoc`** (Lite lyrics are per-song, not
  per-take). Two takes of one song carry the same lyrics snapshot.

### Lifecycle / staleness
- The doc is created lazily on the **first** "Add to share".
- `active:false` (revoke) keeps the doc but makes the viewer show "unavailable".
- A take is shareable only once it has a `downloadUrl` (after its background upload finishes;
  a just-recorded `_pendingLocal` take shows "uploading…" and becomes addable on completion).

## 4. Backend change (owner deploys — Claude cannot)

The **only** backend change. Firestore rules block for `shares` — public single-doc read,
owner-only everything else. Critically, **`get` is public but `list` is not**, so the
collection cannot be enumerated.

```
match /shares/{shareId} {
  allow get:    if true;
  allow list:   if request.auth != null && request.auth.uid == resource.data.ownerId;
  allow create: if request.auth != null
                && request.auth.uid == request.resource.data.ownerId;
  allow update,
        delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
}
```

No Storage rule change. ⚠️ The implementer must surface this block to the user for manual
deployment in the Firebase console; the feature's viewer path is non-functional until it's live.

## 5. Owner-side UI

### 5.1 Add to share (take rows)
- Each take row (pinned + unpinned, in the Takes panel) gets an **"Add to share"**
  affordance near the existing per-take controls (✎ / loop / pin / trash).
- It is a **toggle**: not-in-tray → adds (`shareAddTake`); in-tray → removes
  (`shareRemoveTake`). Filled/active state indicates "this take is shared".
- Disabled with an "uploading…" hint when the take has no `downloadUrl` yet.

### 5.2 Share manager ("My Shared Takes" panel)
- A **share icon** added to the song-list header action cluster (alongside
  sign-out / export / ＋). OK'd by user to add a 4th icon.
- Opens a panel/sheet listing the tray's takes (song title + take label). Each row has a
  **remove** control. Panel header has:
  - **Copy Link** — copies `<origin>/?share=<id>` to clipboard (toast confirm). Uses the
    existing toast system.
  - **Master on/off** toggle — sets `active`. Off = link shows "unavailable"; tray contents
    preserved. On = re-enable.
- If the tray is empty / no share doc exists yet, the panel shows an empty state explaining
  how to add takes.

### 5.3 Operations (client functions)
- `shareEnsureDoc()` → returns existing `shareId` (from cache/query) or creates a new
  `shares/<randomId>` doc (`ownerId`, `active:true`, `takes:[]`).
- `shareAddTake(take)` → ensure doc, push a snapshot (dedupe by `takeId`), merge-write.
- `shareRemoveTake(takeId)` → filter out of `takes`, merge-write.
- `shareSetActive(bool)` → set `active`.
- `shareRefresh()` → for each entry still in the tray, re-snapshot `songTitle` + `lyricsDoc`
  from the current song and `downloadUrl`/`duration`/`mimeType` from the current take; write
  if changed. Debounced. Called on: app load (after songs+takes loaded), after a lyrics flush
  (P3 path), after a trim (`_wfReplaceAudio`). Drops entries whose take/song no longer exists.
- `shareLink()` → `\`${location.origin}${location.pathname}?share=${shareId}\``.

All writes are **offline-tolerant** (fire-and-forget merge, per the Lite offline lessons —
never `await` a Firestore write on a path that must work offline).

## 6. Viewer page (`?share=<id>`, no login)

### 6.1 Boot / routing
- On boot, read `?share=` from the URL. If present, **bypass the auth gate** and enter a
  read-only `body.share-view` state (mirrors the existing no-login `body.chord-preview`
  pattern: show `#app`/a viewer screen, hide landing/auth/rail/songlist/header tools).
- Fetch `shares/<id>` once (public `get`). On missing doc OR `active:false` → render
  **"This share isn't available."** with a CTA to the app.
- Static-host friendly: query param on the same `index.html`, no server routing.

### 6.2 Layout — `#shareViewer`
- Light header: Drafthaus brand + "Shared with you" + a subtle "Made with Drafthaus —
  make your own" link to the normal app (`./` without the param).
- **List of rows**, one per `takes[]` entry, in array order:
  - **Play/Pause button to the LEFT of the song title.**
  - **Song title** (+ optional small take label / duration).
  - A **scrubbable waveform / progress bar** — decode-on-first-play via the existing `_wf`
    draw, read-only (no region/loop/trim controls). Tap/drag = seek ("skip around").
  - A **"Lyrics" toggle**: expands the snapshot `lyricsDoc` **inline below the row**, pushing
    subsequent rows down; collapsing pulls them back up. Chord spans render styled
    (read-only; tap-to-show-shape is deferred).
- Decode lazily (on first play of a row) to avoid decoding every take up front.

### 6.3 Playback
- One shared audio engine (reuse the Lite player). Starting a row stops any other.
- **Auto-advance:** on a take's `ended`, start the next row's take; stop after the last.
- Scrubbing seeks within the current take.

### 6.4 What the viewer never gets
- No auth, no editing, no access to the owner's `songs`/`voice_takes`/other shares, no
  enumeration of `shares`. Only the single doc by exact ID + the token-public audio URLs it
  references.

## 7. Edge cases

- **Revoked** (`active:false`) → "unavailable".
- **Take removed from tray** after viewer loaded → still plays in that already-loaded session
  (one-time fetch); gone on reload. (Live onSnapshot is a deferred enhancement.)
- **Underlying take/song deleted** → `shareRefresh()` drops the stale entry next time the
  owner is active; a viewer who loads before that gets a failed audio fetch on that row →
  show a per-row "unavailable" state, keep the rest playable.
- **Local-only / pending-upload take** → not addable until `downloadUrl` exists.
- **Guest (anonymous) owner** → can create/maintain a share like any user; standard guest
  data caveats apply (device-bound, orphan-on-replace per the 1.048 note). The share doc and
  its audio URLs keep working as long as the doc/files exist.
- **Empty tray** → manager shows empty state; `?share` link to an empty/active tray shows a
  friendly "nothing shared yet" instead of an error.
- **No Lite Storage-cap impact** — share docs are tiny text; audio is already counted at
  record time.

## 8. Non-goals (v1)
- Multiple named shares (one persistent tray only).
- Drag-reorder of tray rows.
- Tap-a-chord-in-viewer-to-open-its-fretboard.
- Live (onSnapshot) viewer updates.
- Viewer comments / reactions / download.
- Per-take expiry.

## 9. Testing

**Headless** (`_verify_lite_1070.js`, Lite conventions — real HTTP, installed Chrome,
COMPUTED visibility not just classes):
- `shareEnsureDoc` creates a doc with `ownerId`/`active:true`/`takes:[]`; second call reuses.
- `shareAddTake` pushes a correct snapshot; dedupes by `takeId`; `shareRemoveTake` removes.
- `shareSetActive(false)` flips `active`.
- `shareRefresh` updates a changed lyrics/title snapshot and drops a missing take.
- **Viewer with NO auth**: stub a public `shares/<id>` get → rows render (play-left-of-title,
  waveform host, Lyrics toggle); revoked/missing → "unavailable"; lyrics expand pushes
  siblings down; auto-advance wiring fires next take on `ended`.
- Access shape: confirm the viewer path reads only the single share doc (no `voice_takes`/
  `songs`/`list` queries) — assert via stubbed `db` method spies.
- No-harm regression: existing songlist/record/lyrics/chord/export paths unaffected
  (carry forward prior suite where practical).

⚠️ Headless cannot fully exercise: real cross-device link open, real Storage-URL audio
playback + waveform decode of a real recording, or the Firestore rules themselves (rules
need a real deploy + a real unauthenticated client).

**On-device sign-off (post-deploy QA):**
- Deploy the rules block.
- Add takes → Copy Link → open on a **second device / incognito (no login)**: rows render,
  audio plays, waveform scrub works, Lyrics expand/collapse, auto-advance.
- Edit lyrics / trim a take in the app → reload the link → viewer shows the update.
- Revoke → link shows "unavailable"; re-enable → works again.
- Remove one take → it disappears from the link on reload.

## 10. Versioning / ship
- Build on `lite-1.069.html` → `lite-1.070.html` (md5-verify base first; diff the fresh copy).
- Commit to `main`; push deploys via GitHub Pages.
- Promote into `index.html` (root) only after on-device sign-off.
- Update memory `drafthaus-lite.md` with the 1.070 entry + the rules-deploy note.
