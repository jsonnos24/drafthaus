# Drafthaus Lite — Storage Caps + WAV→mp3 Edit-Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-account audio-storage caps to Drafthaus Lite (admin ∞ / registered 120 MB / guest 10 MB) and switch waveform edit-saves from WAV to mp3 to shrink the worst-case storage path.

**Architecture:** All app changes land in the single file `index.html`. Storage usage is tracked as an in-memory running total (`_liteUsageBytes`), seeded on song-list entry by a single indexed query (`voice_takes where userId == uid`, summing a new per-take `bytes` field), and adjusted incrementally on upload / delete / edit-save. Enforcement is client-side (same model as full.html's quota) at record-start and edit-save. A `bytes` field is written on every new take; legacy takes are backfilled from Storage metadata during recompute. mp3 edit-save reuses the existing lamejs `_encodeMp3` via a new lamejs-only loader.

**Tech Stack:** Vanilla JS, Firebase (Auth anonymous + Firestore `voice_takes` + Cloud Storage), lamejs (already bundled for export), `playwright-core` + installed Chrome for headless verification.

---

## File Structure

- **Modify** `index.html` — the only app file. Touch points:
  - `~705-748` auth/uid helpers → add tier constants + `liteStorageCap()` + usage state + recompute/update helpers.
  - `uploadTake` (`~1718`) → write `bytes`, bump running total.
  - `deleteTake` (`~1437`) → decrement running total.
  - `_wfReplaceAudio` (`~1623`) → WAV→mp3 + edit-save delta + gate.
  - `_ensureExportLibs` area (`~2498`) → add `_ensureMp3Lib()`.
  - `uploadTake` record-start caller / `uploadTake` head → enforcement gate.
  - song-list title (`~563`) + a render hook → usage meter UI + messaging.
  - song-list entry / auth state → `liteUsageRecompute()` seed.
- **Create** `_verify_lite_caps.js` — headless verification (playwright-core + installed Chrome), following the existing `_verify_lite_*.js` convention.

> Line numbers drift in this 6k-line file — re-locate by the quoted strings/function names given in each task, not by line number.

---

### Task 1: Tier constants, cap resolver, and usage state

**Files:**
- Modify: `index.html` — immediately after `function _isGuestNow() {...}` (the line containing `function _isGuestNow() { return !!(auth.currentUser && auth.currentUser.isAnonymous); }`).

- [ ] **Step 1: Add the constants, resolver, and state**

Insert directly after the `_isGuestNow` line:

```js
// ── Lite storage caps (audio bytes only) ────────────────────────────
// Admin = unlimited; registered = 120 MB; anonymous guest = 10 MB.
const LITE_ADMIN_UID  = 'FMskbD7caYYHdpnHRT4Vw41vqNf2';
const LITE_CAP_GUEST  = 10  * 1024 * 1024;   // 10 MB
const LITE_CAP_REG    = 120 * 1024 * 1024;   // 120 MB ≈ 2h+ webm/opus
function liteStorageCap() {
  const u = auth.currentUser;
  if (!u) return 0;                            // signed out → cannot store
  if (u.uid === LITE_ADMIN_UID) return Infinity;
  if (u.isAnonymous) return LITE_CAP_GUEST;
  return LITE_CAP_REG;
}
// Running total of the current user's stored audio bytes (in-memory; seeded by
// liteUsageRecompute() on song-list entry, adjusted incrementally on mutations).
let _liteUsageBytes = 0;
function liteUsageOver()  { return _liteUsageBytes >= liteStorageCap(); }
function _liteAddBytes(n) { _liteUsageBytes = Math.max(0, _liteUsageBytes + (n || 0)); liteRenderMeter(); }
```

- [ ] **Step 2: Add a no-op meter stub so references resolve (real UI in Task 6)**

Insert immediately after the block above:

```js
// Replaced with the real renderer in Task 6; stub keeps early callers safe.
function liteRenderMeter() { /* meter UI added in Task 6 */ }
```

- [ ] **Step 3: Verify it parses and the resolver is correct**

Create `_verify_lite_caps.js` (full harness; reused/extended by later tasks):

```js
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file://' + process.cwd() + '/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.addInitScript(() => localStorage.setItem('drafthaus-eula-accepted', '1'));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof liteStorageCap === 'function', { timeout: 8000 });

  const r = await page.evaluate(() => {
    const out = {};
    // stub auth.currentUser for each tier
    const mk = u => { window.auth = window.auth || {}; auth.currentUser = u; return liteStorageCap(); };
    out.signedOut  = mk(null);
    out.guest      = mk({ uid: 'g1', isAnonymous: true });
    out.registered = mk({ uid: 'r1', isAnonymous: false });
    out.admin      = mk({ uid: 'FMskbD7caYYHdpnHRT4Vw41vqNf2', isAnonymous: false });
    return out;
  });
  const expect = { signedOut: 0, guest: 10*1024*1024, registered: 120*1024*1024, admin: null /*Infinity*/ };
  const ok =
    r.signedOut === expect.signedOut &&
    r.guest === expect.guest &&
    r.registered === expect.registered &&
    r.admin === null; // Infinity serializes to null over evaluate
  console.log('TASK1', JSON.stringify(r), 'pageerrors=', errs.length);
  if (!ok || errs.length) { console.error('TASK1 FAIL', errs); process.exit(1); }
  console.log('TASK1 PASS');
  await browser.close();
})();
```

Run: `node _verify_lite_caps.js`
Expected: `TASK1 PASS` (Infinity serializes to `null` through `evaluate`, hence the `=== null` check).

- [ ] **Step 4: Commit**

```bash
git add index.html _verify_lite_caps.js
git commit -m "feat(lite): storage-cap tiers + cap resolver + usage state"
```

---

### Task 2: Recompute/seed usage from the user's takes (with legacy backfill)

**Files:**
- Modify: `index.html` — after the usage helpers from Task 1.

- [ ] **Step 1: Add `liteUsageRecompute()`**

Insert after `_liteAddBytes`:

```js
// Authoritative seed: sum bytes of all the current user's takes. Backfills the
// `bytes` field for legacy takes from Storage metadata (one-time, lazy).
async function liteUsageRecompute() {
  const u = uid();
  if (!u) { _liteUsageBytes = 0; liteRenderMeter(); return 0; }
  try {
    const snap = await db.collection('voice_takes').where('userId', '==', u).get();
    let total = 0;
    const backfills = [];
    snap.forEach(d => {
      const t = d.data();
      if (typeof t.bytes === 'number') { total += t.bytes; return; }
      if (t.storagePath) backfills.push({ id: d.id, path: t.storagePath });
    });
    // Backfill missing byte counts from Storage metadata (legacy takes only).
    for (const b of backfills) {
      try {
        const md = await firebase.storage().ref(b.path).getMetadata();
        const sz = md && md.size ? Number(md.size) : 0;
        total += sz;
        db.collection('voice_takes').doc(b.id).set({ bytes: sz }, { merge: true }).catch(() => {});
      } catch (e) { /* file gone / no perms — count as 0 */ }
    }
    _liteUsageBytes = total;
  } catch (e) { console.warn('[caps] recompute', e); }
  liteRenderMeter();
  return _liteUsageBytes;
}
```

- [ ] **Step 2: Verify recompute sums a stubbed query**

Append to `_verify_lite_caps.js` before `await browser.close();`:

```js
  const r2 = await page.evaluate(async () => {
    window.auth.currentUser = { uid: 'r1', isAnonymous: false };
    // stub db.collection('voice_takes').where(...).get()
    window.db = {
      collection: () => ({
        where: () => ({ get: async () => ({
          forEach: cb => {
            cb({ id: 'a', data: () => ({ bytes: 5*1024*1024 }) });
            cb({ id: 'b', data: () => ({ bytes: 7*1024*1024 }) });
          }
        }) })
      })
    };
    await liteUsageRecompute();
    return _liteUsageBytes;
  });
  if (r2 !== 12*1024*1024) { console.error('TASK2 FAIL', r2); process.exit(1); }
  console.log('TASK2 PASS', r2);
```

Run: `node _verify_lite_caps.js`
Expected: `TASK1 PASS` then `TASK2 PASS 12582912`.

- [ ] **Step 3: Commit**

```bash
git add index.html _verify_lite_caps.js
git commit -m "feat(lite): recompute storage usage from takes + legacy byte backfill"
```

---

### Task 3: Record `bytes` on upload and increment the running total

**Files:**
- Modify: `index.html` — `uploadTake(blob, mime, dur)` (find `async function uploadTake(blob, mime, dur) {`).

- [ ] **Step 1: Add the `bytes` field and increment**

In `uploadTake`, change the `db.collection('voice_takes').add({...})` object to include `bytes`, and bump the total after a successful add. Replace:

```js
    await db.collection('voice_takes').add({
      songId: song.id, userId: uid(), filename: fname, storagePath: path,
      downloadUrl: url, duration: Math.round(dur), mimeType: mime, trackNum: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    db.collection('songs').doc(song.id).set({ updatedAt: Date.now() }, { merge: true }).catch(() => {});
    _selectNewest = true;
    toast('Take saved ✓');
```

with:

```js
    await db.collection('voice_takes').add({
      songId: song.id, userId: uid(), filename: fname, storagePath: path,
      downloadUrl: url, duration: Math.round(dur), mimeType: mime, trackNum: 0,
      bytes: blob.size,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    _liteAddBytes(blob.size);
    db.collection('songs').doc(song.id).set({ updatedAt: Date.now() }, { merge: true }).catch(() => {});
    _selectNewest = true;
    toast('Take saved ✓');
```

- [ ] **Step 2: Verify the field/increment wiring by source check**

Run: `grep -n "bytes: blob.size" index.html && grep -n "_liteAddBytes(blob.size)" index.html`
Expected: both lines present inside `uploadTake`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(lite): persist take bytes + increment usage on upload"
```

---

### Task 4: Decrement the running total on delete

**Files:**
- Modify: `index.html` — `deleteTake(id, ev)` (find `async function deleteTake(id, ev) {`).

- [ ] **Step 1: Decrement after a successful delete**

Replace the `try { ... }` body of `deleteTake`:

```js
  try {
    if (t.storagePath) firebase.storage().ref(t.storagePath).delete().catch(() => {});
    await db.collection('voice_takes').doc(id).delete();
    toast('Take deleted');
  } catch (e) { toast('Delete failed'); }
```

with:

```js
  try {
    if (t.storagePath) firebase.storage().ref(t.storagePath).delete().catch(() => {});
    await db.collection('voice_takes').doc(id).delete();
    if (typeof t.bytes === 'number') _liteAddBytes(-t.bytes);
    toast('Take deleted');
  } catch (e) { toast('Delete failed'); }
```

- [ ] **Step 2: Verify by source check**

Run: `grep -n "_liteAddBytes(-t.bytes)" index.html`
Expected: one match inside `deleteTake`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(lite): decrement usage when a take is deleted"
```

---

### Task 5: WAV→mp3 edit-save (with lamejs-only loader + delta accounting + gate)

**Files:**
- Modify: `index.html` — add `_ensureMp3Lib()` after `_ensureExportLibs` (find `async function _ensureExportLibs() {`), and rewrite `_wfReplaceAudio` (find `async function _wfReplaceAudio(buffer, undoBuffer, msg) {`).

- [ ] **Step 1: Add a lamejs-only loader (avoid pulling jszip/jspdf on every edit)**

Insert immediately after the closing `}` of `_ensureExportLibs`:

```js
// Load only the mp3 encoder (lamejs) — used by waveform edit-save.
async function _ensureMp3Lib() {
  await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js');
  if (!(window.lamejs && window.lamejs.Mp3Encoder)) throw new Error('mp3 encoder unavailable');
}
```

- [ ] **Step 2: Rewrite `_wfReplaceAudio` to encode mp3, account the delta, and gate**

Replace the entire body of `_wfReplaceAudio` (the `try { ... } catch (e) {...}` and the lines before it down to the function close) with:

```js
async function _wfReplaceAudio(buffer, undoBuffer, msg) {
  const take = _takes.find(t => t.id === _wf.takeId); if (!take || !uid()) { toast('Not signed in'); return false; }
  stopPlayback(); toast(msg + '…', 1500);
  try {
    await _ensureMp3Lib();
    const blob = _encodeMp3(buffer);
    const oldBytes = (typeof take.bytes === 'number') ? take.bytes : 0;
    // Gate: block only if this edit would push the user over their cap.
    if (_liteUsageBytes - oldBytes + blob.size > liteStorageCap()) {
      toast(liteCapMessage()); return false;
    }
    const fname = 'take_' + Date.now() + '.mp3', path = 'voice_takes/' + take.songId + '/' + fname;
    const snap = await firebase.storage().ref(path).put(blob, { contentType: 'audio/mp3' });
    const url = await snap.ref.getDownloadURL();
    const oldPath = take.storagePath;
    await db.collection('voice_takes').doc(take.id).set({ downloadUrl: url, storagePath: path, duration: Math.round(buffer.duration), mimeType: 'audio/mp3', bytes: blob.size }, { merge: true });
    if (oldPath && oldPath !== path) firebase.storage().ref(oldPath).delete().catch(() => {});
    take.bytes = blob.size; take.storagePath = path; take.mimeType = 'audio/mp3';
    _liteAddBytes(blob.size - oldBytes);
    _bufCache[take.id] = { buffer, normGain: (_bufCache[take.id] && _bufCache[take.id].normGain) || 1 };
    _wf.buffer = buffer; _wf.dur = buffer.duration; _wf.peaks = _computePeaks(buffer, 1400); _wf.sel = null; _wf.loopSel = false; _wf.playhead = 0; _wf.undo = undoBuffer ? { buffer: undoBuffer } : null;
    wfRender(); toast(msg + ' ✓'); return true;
  } catch (e) { console.warn('[wf] replace', e); toast(msg + ' failed — check connection'); return false; }
}
```

> `liteCapMessage()` is defined in Task 6. If implementing Task 5 before Task 6, add a temporary `function liteCapMessage(){ return 'Storage full'; }` and remove it when Task 6 lands.

- [ ] **Step 3: Verify by source check**

Run: `grep -n "_encodeMp3(buffer)" index.html && grep -n "contentType: 'audio/mp3'" index.html && grep -n "_ensureMp3Lib" index.html`
Expected: `_encodeMp3(buffer)` appears in `_wfReplaceAudio` (plus its definition), `audio/mp3` content type present, and `_ensureMp3Lib` defined + called.

- [ ] **Step 4: Confirm no WAV path remains in edit-save**

Run: `grep -n "_encodeWav" index.html`
Expected: only the `function _encodeWav(buffer) {` definition remains (now unused — leave it; harmless). No call inside `_wfReplaceAudio`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(lite): edit-save encodes mp3 (was WAV) + cap-gated delta accounting"
```

---

### Task 6: Usage meter UI + at-cap messaging

**Files:**
- Modify: `index.html` — song-list title markup (`~563`), the stub `liteRenderMeter()` from Task 1, and add `liteCapMessage()`.

- [ ] **Step 1: Add a meter element to the song-list title**

In the `<div class="lg-title">` block, inside the `<span class="lg-head">Songs ...</span>`, add a meter span right after the `guest-tag` span's closing `</span>` and before `</span>` of `lg-head`. Replace:

```html
<span class="lg-head">Songs <span class="guest-tag">Guest · <button class="guest-signin" onclick="openLogin()">Sign in to save</button></span></span>
```

with:

```html
<span class="lg-head">Songs <span class="guest-tag">Guest · <button class="guest-signin" onclick="openLogin()">Sign in to save</button></span><span id="liteMeter" class="lite-meter" style="display:none;"></span></span>
```

- [ ] **Step 2: Add meter styling**

Add next to the existing `.guest-tag` CSS rule (search `.guest-tag {`):

```css
.lite-meter { margin-left: 10px; font-size: 11px; font-weight: 700; color: var(--faint, #888); white-space: nowrap; }
.lite-meter.over { color: #e0564b; }
.lite-meter .lite-meter-cta { color: var(--tint); font-weight: 700; background: none; border: none; cursor: pointer; padding: 0 0 0 6px; font: inherit; }
```

- [ ] **Step 3: Replace the meter stub + add the message helper**

Replace the Task 1 stub `function liteRenderMeter() { /* meter UI added in Task 6 */ }` with:

```js
function _liteFmtMB(b) { return (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0); }
function liteCapMessage() {
  return (auth.currentUser && auth.currentUser.isAnonymous)
    ? 'Storage full (10 MB) — sign in for 120 MB'
    : 'Storage full — delete takes to free space';
}
function liteRenderMeter() {
  const el = document.getElementById('liteMeter'); if (!el) return;
  const cap = liteStorageCap();
  if (!auth.currentUser || cap === Infinity) { el.style.display = 'none'; return; } // admin/signed-out → no meter
  el.style.display = '';
  const over = _liteUsageBytes >= cap;
  el.classList.toggle('over', over);
  const used = _liteFmtMB(_liteUsageBytes), total = _liteFmtMB(cap);
  if (over && auth.currentUser.isAnonymous) {
    el.innerHTML = `${used}/${total} MB <button class="lite-meter-cta" onclick="openLogin()">Sign in → 120 MB</button>`;
  } else {
    el.textContent = `${used} / ${total} MB`;
  }
}
```

- [ ] **Step 4: Verify meter renders per tier**

Append to `_verify_lite_caps.js` before `await browser.close();`:

```js
  const r6 = await page.evaluate(() => {
    const set = (u, used) => { window.auth.currentUser = u; window._liteUsageBytes = used; liteRenderMeter(); const el = document.getElementById('liteMeter'); return { disp: el.style.display, txt: el.textContent, over: el.classList.contains('over') }; };
    return {
      admin: set({ uid: 'FMskbD7caYYHdpnHRT4Vw41vqNf2', isAnonymous: false }, 999*1024*1024),
      regUnder: set({ uid: 'r1', isAnonymous: false }, 30*1024*1024),
      guestOver: set({ uid: 'g1', isAnonymous: true }, 11*1024*1024),
    };
  });
  const ok6 = r6.admin.disp === 'none'
    && r6.regUnder.disp === '' && r6.regUnder.txt.indexOf('30 / 120 MB') !== -1 && !r6.regUnder.over
    && r6.guestOver.over === true && r6.guestOver.txt.indexOf('Sign in') !== -1;
  if (!ok6) { console.error('TASK6 FAIL', JSON.stringify(r6)); process.exit(1); }
  console.log('TASK6 PASS', JSON.stringify(r6));
```

Run: `node _verify_lite_caps.js`
Expected: `TASK6 PASS ...` (admin hidden, registered shows `30 / 120 MB` not over, guest-over shows the CTA + `over` class).

- [ ] **Step 5: Commit**

```bash
git add index.html _verify_lite_caps.js
git commit -m "feat(lite): storage usage meter + at-cap messaging"
```

---

### Task 7: Enforce the cap at record-start

**Files:**
- Modify: `index.html` — `uploadTake(blob, mime, dur)` head (the simplest single chokepoint both record paths flow through).

- [ ] **Step 1: Block over-cap saves at the top of `uploadTake`**

In `uploadTake`, after the `if (!song || !uid()) { toast('Not signed in'); return; }` line, add a cap gate. Replace:

```js
async function uploadTake(blob, mime, dur) {
  const song = _currentSong;
  if (!song || !uid()) { toast('Not signed in'); return; }
  toast('Saving take…', 1500);
```

with:

```js
async function uploadTake(blob, mime, dur) {
  const song = _currentSong;
  if (!song || !uid()) { toast('Not signed in'); return; }
  if (liteUsageOver()) { toast(liteCapMessage(), 3200); return; }
  toast('Saving take…', 1500);
```

> Gating at `uploadTake` (post-recording) means an in-progress recording is always allowed to finish; the *next* save is blocked once over cap. This is the agreed behavior (no mid-recording hard cut).

- [ ] **Step 2: Verify the gate blocks an over-cap save**

Append to `_verify_lite_caps.js` before `await browser.close();`:

```js
  const r7 = await page.evaluate(async () => {
    window.auth.currentUser = { uid: 'g1', isAnonymous: true }; // 10 MB cap
    window._currentSong = { id: 's1' };
    window._liteUsageBytes = 11 * 1024 * 1024; // over
    let toasted = '';
    window.toast = (m) => { toasted = m; };
    let added = false;
    window.db = { collection: () => ({ add: async () => { added = true; }, doc: () => ({ set: async () => {} }) }) };
    await uploadTake({ size: 500000 }, 'audio/webm', 5);
    return { added, toasted };
  });
  if (r7.added || r7.toasted.indexOf('Storage full') === -1) { console.error('TASK7 FAIL', JSON.stringify(r7)); process.exit(1); }
  console.log('TASK7 PASS', JSON.stringify(r7));
```

Run: `node _verify_lite_caps.js`
Expected: `TASK7 PASS` — no `add()` call, and a "Storage full" toast.

- [ ] **Step 3: Commit**

```bash
git add index.html _verify_lite_caps.js
git commit -m "feat(lite): block new takes when over storage cap"
```

---

### Task 8: Seed the running total on song-list entry / login

**Files:**
- Modify: `index.html` — the auth-state handler that toggles `is-guest` / `signed-in` (find `document.body.classList.toggle('is-guest', !!user.isAnonymous);`).

- [ ] **Step 1: Call recompute when a user becomes active**

Locate the `onAuthStateChanged`-style block containing `document.body.classList.toggle('is-guest', !!user.isAnonymous);` (around the `if (user && (!user.isAnonymous || guestChosen)) {` branch). Immediately after that `toggle('is-guest', ...)` line, add:

```js
    liteUsageRecompute(); // seed storage meter + cap state for this session
```

And in the signed-out branch (where `document.body.classList.remove('signed-in', 'is-guest', 'relogin');` runs), after that line add:

```js
    _liteUsageBytes = 0; liteRenderMeter();
```

- [ ] **Step 2: Verify by source check**

Run: `grep -n "liteUsageRecompute(); // seed" index.html && grep -n "_liteUsageBytes = 0; liteRenderMeter();" index.html`
Expected: both present in the auth-state handler.

- [ ] **Step 3: Full headless regression**

Run: `node _verify_lite_caps.js`
Expected: `TASK1 PASS` … `TASK7 PASS` all green, `pageerrors= 0`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(lite): seed/reset storage usage on auth state change"
```

---

### Task 9: Snapshot the build + on-device sign-off (Lite workflow)

**Files:**
- Create: `lite-1.057.html` (copy of `index.html`) — per the Lite versioning workflow (memory `drafthaus-lite.md`).

- [ ] **Step 1: md5 the base before copying (base-drift guard)**

Run: `md5 -q index.html`
Note the hash; confirm it matches the working tree you just edited (sanity that you're snapshotting the right file).

- [ ] **Step 2: Snapshot to the next Lite version**

Run: `cp index.html lite-1.057.html && diff -q index.html lite-1.057.html && echo "identical OK"`
Expected: `identical OK`.

- [ ] **Step 3: Commit the snapshot (do NOT push yet — pushing deploys)**

```bash
git add lite-1.057.html
git commit -m "chore(lite-1.057): storage caps (reg 120MB / guest 10MB / admin ∞) + WAV→mp3 edit-save"
```

- [ ] **Step 4: On-device sign-off checklist (manual, per Lite workflow)**

The headless harness covers tier logic, recompute, meter, and the cap gate. The real recording + waveform-edit paths require a device pass before promote/push. On an iPhone (or desktop browser signed in for real), confirm:
  1. As a registered user: meter shows `X / 120 MB`, increments after recording a take, decrements after deleting it.
  2. As a guest: meter shows `/ 10 MB`; after exceeding ~10 MB, a new recording is blocked with the "sign in for 120 MB" toast, and the meter CTA appears.
  3. Sign in from that guest session (Google/email) → takes carry over (`linkWithPopup`) and the cap jumps to 120 MB.
  4. Edit a take's waveform (trim) → it re-saves; confirm the stored file is `.mp3` (Storage console) and the meter delta is small.
  5. As admin (your uid): no meter shown, no cap.

- [ ] **Step 5: Promote + push (only after sign-off, and only on your go-ahead)**

```bash
cp lite-1.057.html index.html
git add index.html
git commit -m "chore(lite-1.057): promote to index.html (storage caps + mp3 edit-save)"
# push deploys to drafthaus.ca — confirm with the user before running:
# git push origin main
```

---

## Self-Review

**Spec coverage:**
- Tiers (admin ∞ / reg 120 / guest 10) → Task 1. ✓
- Byte tracking on upload → Task 3; on delete → Task 4; on edit-save → Task 5. ✓
- Running total (Approach B) + recompute self-heal/backfill → Task 2; seed on login → Task 8. ✓
- Enforcement at record-start → Task 7; at edit-save → Task 5. ✓
- UI meter + guest/registered messaging → Task 6. ✓
- WAV→mp3 edit-save (reuse `_encodeMp3`, lazy lamejs load) → Task 5. ✓
- Inactive-account deletion → out of scope (already live via `cleanupInactiveAccounts`); noted in spec, no task. ✓
- Snapshot/promote per Lite workflow → Task 9. ✓
- (Spec deviation, intentional/simpler): the running total lives in-memory (`_liteUsageBytes`) seeded by a single indexed `voice_takes where userId == uid` query rather than persisted to `users/{uid}.liteStorageBytes`. The per-take `userId` field already exists, making recompute one cheap query, so the user-doc cache adds drift risk for no benefit. Storage Security Rules per-file backstop (optional, from spec) is also omitted — flag to the user if they want it added.

**Placeholder scan:** No TBD/TODO/"handle errors"; every code step shows full code. The only forward-reference (`liteCapMessage()` used in Task 5, defined in Task 6) is called out with a temporary-stub instruction.

**Type consistency:** `_liteUsageBytes`, `_liteAddBytes`, `liteStorageCap`, `liteUsageOver`, `liteUsageRecompute`, `liteRenderMeter`, `liteCapMessage`, `_ensureMp3Lib`, `bytes` (take field) — names used identically across all tasks. ✓
