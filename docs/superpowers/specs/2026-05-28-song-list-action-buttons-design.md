# Song List Action Buttons — Always Visible

**Date:** 2026-05-28  
**Status:** Approved

## Problem

The three action buttons (`+ New Idea`, `↩ Open "..."`, `⚅ Roll for Inspiration`) exist in `1.291.html` inside `#v4WelcomePrompt` but never appear. Root cause: `v4ShowWelcomePrompt()` is only called during the non-fast-restore boot path and during cross-device sync events — never when navigating to the song list. Returning users always hit the fast-restore path, so the buttons are permanently invisible.

## Goal

The three buttons should always appear at the top of the song list whenever the user navigates to it, on both desktop and mobile.

## Approach

JS-only fix. No HTML or CSS changes. Add one call to `v4ShowWelcomePrompt()` in three locations in `1.291.html`:

### 1. `showList()` (~line 19347)

After the existing `renderGrid()` call:

```js
renderGrid();
if (typeof v4ShowWelcomePrompt === 'function') v4ShowWelcomePrompt();
```

Covers: every user-triggered navigation to the song list (back from song, mobile menu, header logo tap).

### 2. Fast-restore cache-hit path (~line 39900)

After `renderGrid()` in the `_cached` branch:

```js
renderGrid();
if (typeof v4ShowWelcomePrompt === 'function') v4ShowWelcomePrompt();
```

Covers: first load for returning users who have a localStorage fast-restore cache.

### 3. Fast-restore Firestore-fetch path (~line 39948)

After `renderGrid()` in the no-cache but fast-boot branch:

```js
renderGrid();
if (typeof v4ShowWelcomePrompt === 'function') v4ShowWelcomePrompt();
```

Covers: first load when no cache exists but fast-boot still bypasses the normal `loadSongsFromSheet()` flow.

## Unchanged behavior

- `openSong()` continues to hide `#v4WelcomePrompt` while a song is open — correct.
- `v4ShowWelcomePrompt()` continues to guard against unauthenticated users and users with no songs — no change needed there.
- The green "Open Recent" button (`#v4WelcomeRecentBtn`) continues to show/hide based on whether a recent song exists.
- Mobile layout (stacked column) and desktop layout (row) are unchanged — existing CSS handles both.

## Files changed

- `1.291.html` — 3 one-line additions only
