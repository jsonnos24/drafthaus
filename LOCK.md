# LOCK.md — Protected Code Sections

These sections are marked with `/* @lock:start */` and `/* @lock:end */` tags in the codebase.
**Do NOT modify code inside lock boundaries.** Work around them with CSS overrides, wrapper logic, or new code outside the locked region.

## Locked Sections (1.215)

| # | Section | Scope |
|---|---------|-------|
| 1 | Dropdown System | `position:fixed + getBoundingClientRect()` pattern (line 9) |
| 2 | Subscription / Tier Logic | Lines 17646–17737 |
| 3 | Song Manager | Lines 18293–20154 |
| 4 | Sequencer Scheduler | Lines 21744–34608 |
| 5 | Piano Sampler | Lines 22386–22612 |
| 6 | MIDI Input | Lines 22614–23224 |
| 7 | Sequencer Grid Rendering | Lines 23806–29480 |
| 8 | UCB — Unified Control Bar | Lines 31410–32372 |
| 9 | Auth Lifecycle | Lines 35705–35929 |
| 10 | Firestore Sync / State Persistence | Lines 37561–38229 |
| 11 | Collaboration / Sharing | Lines 38694–39038 |
| 12 | Export / Bounce Engine | Lines 39886–40819 |
| 13 | Chord Resolution | Lines 40616–40634 |
| 14 | Loop Station | Lines 46489–48158 |
| 15 | Mixer / Master Output | Lines 51198–52810 |
| 16 | 4-Track Recorder Core | Lines 54301–58037 |
| 17 | Waveform Rendering | Lines 57647–59818 |
| 18 | 4-Track UI / Strip Sync | Lines 58952–61816 |
| 19 | Piano Roll | Lines 64123–67493 |
| 20 | Unified Timeline Engine | Lines 67847–68717 |

## Rules

- Never edit code between `@lock:start` and `@lock:end` tags
- Control locked UI via CSS classes/overrides applied from OUTSIDE the lock
- New features that interact with locked systems must use their public APIs / helper functions only
- If a lock must be broken, get explicit approval first and document why
