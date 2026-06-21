# Drafthaus Lite — Phase 3: Lyrics Multi-Device Reconciliation

**Date:** 2026-06-21
**App:** Drafthaus Lite. Builds `lite-1.068.html` from `lite-1.067.html`. Never touches `full.html`/`1.3xx.html`.
**Parent spec:** `2026-06-17-lite-local-first-recording-sync-design.md` (Phase 3). This refines it with the
decisions below — notably a **content-comparison + inline-append** approach that needs **no new Firestore
fields** (no `lyricsVer`/`lyricsConflict`).
**Status:** Design approved. One milestone (`lite-1.068`).

## Decisions (locked)

- **Freshen-on-return**: on tab refocus / app-foreground / reconnect, re-pull the song's lyrics (+ verify the
  takes listener is healthy + drain the outbox). Scoped to "on return," not continuous live-sync.
- **Inline-append** conflict format: on divergence, the editor becomes *your version* + a divider + *their
  version*, in the normal editor. Nothing lost; you trim by hand. No new screens, no separate conflict field.
- **Reconcile-on-reconnect** for offline lyrics: offline edits are held in a durable local pending store and
  reconciled (same inline-append) on reconnect — full offline-safe, consistent with Phase 2.
- **Scalars unchanged**: title/key/boost/tuning/tile-color/pin already update local+UI then merge-write a single
  field, so they're already offline-safe and last-write-wins per field. Phase 3 touches **lyrics only**.

## Problem

The lyrics editor is **stale by design**: `_openSongObj` loads lyrics into the `#lyricsEditor` contenteditable
**once** on open; the live `songs` listener refreshes only the song *list*, never the open editor (you can't
silently swap a contenteditable someone may be typing in). And `flushLyrics` does a **blind overwrite**
(`set({lyricsDoc}, merge)`, no conflict check). So: open a song on desktop, leave the tab, edit the lyrics on
your phone, come back and type one word → the 900ms autosave **overwrites the phone's edits with the stale
desktop version**. Today nothing catches this. (Recordings already merge by unique ID; song scalars are
independent fields — lyrics, a single shared rich-text doc, are the only thing that can truly diverge.)

## Core mechanism — `_lyricsBase` (content comparison)

Each device keeps `_lyricsBase` = the exact `lyricsDoc` content (sanitized HTML string) it **last loaded or
last successfully synced** — the common ancestor. All reconciliation reduces to two booleans:
- **I edited** = `currentEditorHtml() !== _lyricsBase`.
- **Remote moved** = `remoteLyricsDoc !== _lyricsBase`.

`_lyricsBase` is set: on `_openSongObj` (to the loaded content), after any successful lyrics write (to the
written content), and after a freshen adopt/merge (to the remote content). Comparing content (not a counter)
is robust to offline and needs no server-side version field.

`currentEditorHtml()` = `ilSanitizeDocHtml(document.getElementById('lyricsEditor').innerHTML)` (the same
normalization `flushLyrics` already uses, so comparisons are apples-to-apples).

## 1. Freshen-on-return — `liteFreshenSong()`

Triggered on `visibilitychange`→visible, `window` `focus`, and `online`. No-op unless a song is open
(`_currentSong`). Extends the existing Phase-2 visibilitychange/online handlers (which already call
`liteSyncDrain()`).

Steps:
1. **Lyrics.** Read the latest remote `lyricsDoc` for `_currentSong.id` via
   `db.collection('songs').doc(id).get()` — with persistence this returns server data when online (a genuine
   freshen) and cache when offline (a no-op, nothing fresher exists). Don't rely on the `_songs` array's
   liveness (it may not stay subscribed while a song is open). Let `remote = that doc's lyricsDoc` (treat a
   missing doc/field as `_lyricsBase`, i.e. no change). Guard the `get()` in try/catch (offline/denied → skip
   the lyrics freshen, keep the local edits).
   - `remote === _lyricsBase` → remote unchanged → nothing (any local edits will save normally).
   - `remote !== _lyricsBase` (remote moved):
     - **You haven't edited** (`currentEditorHtml() === _lyricsBase`) → **adopt silently**: set the editor to
       `remote` via the open-path machinery (`lyricsEditor.innerHTML = ilSanitizeDocHtml(remote);
       _atomizeLyricChords();`), `_lyricsBase = remote`, cancel any pending autosave. Staleness gone.
     - **You also edited** (`currentEditorHtml() !== _lyricsBase`) → **inline-append merge**: editor =
       `currentEditorHtml()` + `_lyricsDivider('another device')` + `remote`; `_atomizeLyricChords()`;
       `_lyricsBase = remote`; `toast('Merged lyrics from another device — review', 2600, true)`; schedule a
       save (so the merged doc persists as the new authoritative version).
2. **Takes.** Ensure the takes listener is healthy — if it isn't currently subscribed for `_currentSong.id`,
   `startTakesListener(_currentSong.id)` (reinforces the 1.067 re-subscribe fix; a backgrounded tab whose
   connection dropped re-syncs its take list on return).
3. **Drain.** `liteSyncDrain()` + `liteLyricsDrain()` (below) — flush queued take uploads and pending offline
   lyrics edits.

`_lyricsDivider(srcLabel)` returns a sentinel block, e.g.
`'<div class="lyr-merge-divider">—— Also edited on ' + srcLabel + ' ——</div>'`, styled muted/centered. It is
ordinary editor content the user can delete; on save it is sanitized like any block (it must survive
`ilSanitizeDocHtml`, so use an allowed tag/class).

## 2. Save guard — reworked `flushLyrics`

`flushLyrics` fires on the existing 900ms `onLyricsInput` debounce (and `blur`). New behavior:

- **Online:** write via a Firestore **transaction** so the read-compare-write is atomic against concurrent
  remote edits:
  ```
  runTransaction(tx):
    serverDoc = (tx.get(ref)).lyricsDoc
    if serverDoc === _lyricsBase:        # nobody else changed it
        result = currentEditorHtml()
    else:                                 # remote moved since our base → merge, don't overwrite
        result = currentEditorHtml() + divider + serverDoc
    tx.set(ref, {lyricsDoc: result, lyricsDocInit: true, updatedAt: Date.now()}, {merge:true})
    return {result, merged: serverDoc !== _lyricsBase}
  ```
  After commit: `_lyricsBase = result`. If `merged`, update the editor to `result` + `_atomizeLyricChords()` +
  the "Merged…" toast (this is the two-tabs-editing-at-once case).
- **Offline:** do **not** issue a blind Firestore write (it would queue and clobber on flush). Instead persist a
  pending-lyrics edit and let reconnect reconcile (below). The editor + `_currentSong.lyricsDoc` already hold
  the content for the session.

The existing blank-guard (`_ilCommitDoc` refuses to commit an empty doc over a non-empty one) is preserved as
the first check in both paths.

## 3. Offline lyrics — pending store + `liteLyricsDrain()`

A durable local store so offline lyric edits survive reload and reconcile correctly on reconnect.

- **IndexedDB store `pendingLyrics`** (in the existing `dh-lite-audio` DB; bump version + additive
  `createObjectStore('pendingLyrics', {keyPath:'songId'})`; mirror the in-memory fallback the 1.067 fix added —
  a `_memPendingLyrics` Map when IndexedDB is unavailable). Entry: `{songId, lyricsDoc, base, editedAt}` where
  `base` is the `_lyricsBase` the edit was made against. Helpers `dhPendingLyricsPut/Get/All/Delete`.
- **Offline `flushLyrics`** writes `{songId, lyricsDoc: currentEditorHtml(), base: _lyricsBase, editedAt: now}`
  to `pendingLyrics` (one entry per song; a later offline edit overwrites it).
- **`liteLyricsDrain()`** (run on `online`/foreground/boot alongside `liteSyncDrain`, single-flight): for each
  pending entry, while online —
  - read the remote `lyricsDoc`.
  - `remote === entry.base` → write `entry.lyricsDoc` (no conflict).
  - else → write `entry.lyricsDoc + divider + remote` (inline-append).
  - the write itself uses the same online transaction as the save guard (so a change landing *during* the drain
    is also caught); on success delete the pending entry and, **if this song is open**, refresh the editor to the
    written result + `_lyricsBase = result` + the "Merged…" toast when it merged.
- On `_openSongObj`, if a `pendingLyrics` entry exists for the song, the editor is seeded from it (so an offline
  edit reopened-offline shows your in-progress version, not the last-synced one).

## Data model changes

- **No new Firestore fields.** Reconciliation is content-comparison; the merge lives inline in `lyricsDoc`.
  (`lyricsDoc`/`lyricsDocInit`/`updatedAt` are the only song fields written, exactly as today.)
- **IndexedDB:** one new additive store `pendingLyrics` (+ `_memPendingLyrics` fallback). Strictly additive
  upgrade — never touches `takeBlobs`/`outbox`.
- **Device-local (in-memory):** `_lyricsBase`, plus the freshen handler wiring.

## Data-safety invariants (hard) + no-harm

1. **Lyrics are never silently overwritten.** Every write path compares against `_lyricsBase`/server and
   inline-appends on divergence — there is no code path that replaces a non-empty remote doc with a stale local
   one. The blank-guard is preserved.
2. **Single-device behavior is unchanged.** With one device (or no concurrent edits), `remote === _lyricsBase`
   always holds → normal edit/save, no merges, no dividers — identical to 1.067.
3. **Scalars untouched & already safe.** title/key/boost/tuning/tile-color/pin keep their current
   local-update-then-merge-write pattern (offline-safe, per-field LWW). Phase 3 does not modify them. (Noted
   wrinkle, not a change: an offline rename keeps its offline `updatedAt`, so it may not re-sort to the top of
   the list on reconnect — cosmetic.)
4. **Existing songs/takes unaffected.** A song never edited on a second device behaves exactly as before; the
   `pendingLyrics` store only holds entries this device created offline. Additive DB upgrade.
5. **Recordings unchanged.** Phase 3 touches only the lyrics path; the take outbox/drain from Phase 2 are
   untouched (freshen merely also calls the existing `liteSyncDrain`).
6. All Firestore writes additive + `{merge:true}`; `index.html`/`full.html` untouched; `lite-1.068.html` is a
   clean file-copy snapshot (revert-safe).

**Mandatory no-harm regression:** open a song with existing lyrics + takes on a single device, edit and save
lyrics normally, and assert: no divider is ever inserted, `lyricsDoc` round-trips exactly the edited content,
`_lyricsBase` tracks it, takes are untouched, and the song scalars (rename/key) still write a single merged
field. (i.e. the common path is byte-for-byte the 1.067 experience.)

## Testing (headless `_verify_lite_1068.js`)

- **Freshen adopt:** open song; set `_lyricsBase` and editor to "A"; simulate remote = "B"; call
  `liteFreshenSong()` → editor becomes "B", `_lyricsBase`="B", no divider.
- **Freshen merge:** editor = "A+local" (≠ base "A"); remote = "B"; freshen → editor === "A+local" + divider +
  "B"; `_lyricsBase`="B"; toast fired.
- **Save guard, no conflict:** base==="A", editor="A2", stub transaction with serverDoc==="A" → writes "A2",
  no divider, `_lyricsBase`="A2".
- **Save guard, conflict:** base==="A", editor="A2", serverDoc==="B" → writes "A2"+divider+"B"; editor updated;
  toast.
- **Offline edit → pending store:** force offline; edit lyrics; assert a `pendingLyrics` entry exists and **no**
  Firestore write was issued.
- **Reconcile on reconnect:** pending entry {lyricsDoc:"A2", base:"A"}; remote="B"; `liteLyricsDrain()` →
  writes "A2"+divider+"B"; entry cleared. And the no-conflict variant (remote==="A") → writes "A2" clean.
- **IndexedDB-unavailable:** `pendingLyrics` falls back to `_memPendingLyrics` (record offline still
  reconciles for the session) — mirrors the 1.067 fallback.
- **No-harm / single-device:** normal edit+save inserts no divider; rename offline writes only `title` (merge),
  doesn't clobber lyrics.
- **Real-offline integration** (`ctx.setOffline`, real Firebase, like the 1.067 Bug-B test): edit lyrics
  offline on a song, change the same song's lyrics from a second writer, reconnect → the merged doc contains
  both sides.

Caveats needing on-device sign-off (headless can't reproduce): real two-device timing, iOS Safari visibility/
focus events, the merge UX feeling natural on a phone.

## Versioning & revert safety

File-copy snapshot: confirm `md5 lite-1.067.html` first, `cp` → `lite-1.068.html`, diff the copy. Promote into
`index.html` only after on-device sign-off. Prior numbered files stay frozen → any regression is a one-line
revert.
