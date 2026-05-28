# Drum Drawer — Popover Fix & Toolbar Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Probability Roll popover clipping on desktop (top) and mobile (bottom), then rename "Prob" → "Probability Roll" and promote "Randomize Velocity" from the ⋯ more panel to the main toolbar as "🎲 Random Vel".

**Architecture:** All changes are in `1.291.html`. Popover fix adds `getBoundingClientRect()` positioning to `seqProbToggle()` and `seqFillToggle()` — the locked codebase pattern for all dropdowns. Toolbar reorder is a pure HTML change: move one button, rename another.

**Tech Stack:** Vanilla JS, single HTML file, no build step, browser-tested manually.

---

### Task 1: Fix Probability Roll popover positioning

**Files:**
- Modify: `1.291.html` — `seqProbToggle()` function (~line 47972)

- [ ] **Step 1: Locate the function**

  Open `1.291.html` and find `seqProbToggle()` at ~line 47972. The current body is:

  ```javascript
  function seqProbToggle() {
    const pop = document.getElementById('seqProbPopover');
    const btn = document.getElementById('seqProbBtn');
    const fillPop = document.getElementById('seqFillPopover');
    const fillBtn = document.getElementById('seqFillBtn');
    if (!pop) return;
    const showing = pop.style.display !== 'none';
    // Close fill popover if open
    if (fillPop) fillPop.style.display = 'none';
    if (fillBtn) fillBtn.classList.remove('active');
    pop.style.display = showing ? 'none' : '';
    if (btn) btn.classList.toggle('active', !showing);
    if (!showing) seqProbBuildLanes();
  }
  ```

- [ ] **Step 2: Replace with positioned version**

  Replace the entire function with:

  ```javascript
  function seqProbToggle() {
    const pop = document.getElementById('seqProbPopover');
    const btn = document.getElementById('seqProbBtn');
    const fillPop = document.getElementById('seqFillPopover');
    const fillBtn = document.getElementById('seqFillBtn');
    if (!pop) return;
    const showing = pop.style.display !== 'none';
    if (fillPop) fillPop.style.display = 'none';
    if (fillBtn) fillBtn.classList.remove('active');
    pop.style.display = showing ? 'none' : '';
    if (btn) btn.classList.toggle('active', !showing);
    if (!showing) {
      seqProbBuildLanes();
      const rect = btn.getBoundingClientRect();
      const popW = pop.offsetWidth || 260;
      const popH = pop.offsetHeight;
      const left = Math.min(rect.left, window.innerWidth - popW - 8);
      const topBelow = rect.bottom + 4;
      const topAbove = rect.top - popH - 4;
      pop.style.left = Math.max(8, left) + 'px';
      pop.style.top = (topBelow + popH > window.innerHeight - 8 ? topAbove : topBelow) + 'px';
    }
  }
  ```

- [ ] **Step 3: Manual verify — desktop**

  Open `1.291.html` in a browser at ≥900px wide. Open the drum drawer. Click "🎲 Probability Roll". The popover should appear fully visible below the button with no clipping.

- [ ] **Step 4: Manual verify — mobile**

  Open browser devtools, switch to a mobile viewport (e.g. iPhone 14 — 390×844). Open the drum drawer. Tap "🎲 Probability Roll". The popover should be fully visible and not cut off at the bottom. If the popover would overflow the bottom, it should flip above the button instead.

- [ ] **Step 5: Commit**

  ```bash
  git add 1.291.html
  git commit -m "fix(drum-drawer): position Probability Roll popover with getBoundingClientRect"
  ```

---

### Task 2: Fix Fill popover positioning

**Files:**
- Modify: `1.291.html` — `seqFillToggle()` function (~line 48054)

- [ ] **Step 1: Locate the function**

  Find `seqFillToggle()` at ~line 48054. Current body:

  ```javascript
  function seqFillToggle() {
    const pop = document.getElementById('seqFillPopover');
    const btn = document.getElementById('seqFillBtn');
    const probPop = document.getElementById('seqProbPopover');
    const probBtn = document.getElementById('seqProbBtn');
    if (!pop) return;
    const showing = pop.style.display !== 'none';
    // Close probability popover if open
    if (probPop) probPop.style.display = 'none';
    if (probBtn) probBtn.classList.remove('active');
    pop.style.display = showing ? 'none' : '';
    if (btn) btn.classList.toggle('active', !showing);
  }
  ```

- [ ] **Step 2: Replace with positioned version**

  ```javascript
  function seqFillToggle() {
    const pop = document.getElementById('seqFillPopover');
    const btn = document.getElementById('seqFillBtn');
    const probPop = document.getElementById('seqProbPopover');
    const probBtn = document.getElementById('seqProbBtn');
    if (!pop) return;
    const showing = pop.style.display !== 'none';
    if (probPop) probPop.style.display = 'none';
    if (probBtn) probBtn.classList.remove('active');
    pop.style.display = showing ? 'none' : '';
    if (btn) btn.classList.toggle('active', !showing);
    if (!showing) {
      const rect = btn.getBoundingClientRect();
      const popW = pop.offsetWidth || 220;
      const popH = pop.offsetHeight;
      const left = Math.min(rect.left, window.innerWidth - popW - 8);
      const topBelow = rect.bottom + 4;
      const topAbove = rect.top - popH - 4;
      pop.style.left = Math.max(8, left) + 'px';
      pop.style.top = (topBelow + popH > window.innerHeight - 8 ? topAbove : topBelow) + 'px';
    }
  }
  ```

- [ ] **Step 3: Manual verify — desktop**

  Click "🥁 Fill". Popover appears fully visible below the button.

- [ ] **Step 4: Manual verify — mobile**

  On mobile viewport, tap "🥁 Fill". Popover fully visible, not cut off at bottom.

- [ ] **Step 5: Verify both popovers mutual-close**

  Open Prob popover, then click Fill — Prob should close and Fill should open (and vice versa). This behavior is unchanged.

- [ ] **Step 6: Commit**

  ```bash
  git add 1.291.html
  git commit -m "fix(drum-drawer): position Fill popover with getBoundingClientRect"
  ```

---

### Task 3: Rename "Prob" button and reorder toolbar

**Files:**
- Modify: `1.291.html` — drum toolbar HTML (~line 25107–25142)

- [ ] **Step 1: Rename Prob button**

  Find at ~line 25107:
  ```html
  <button class="seq-gen-btn dr-stage-btn" id="seqProbBtn" onclick="seqProbToggle()" title="Add random hits based on probability">🎲 Prob</button>
  ```

  Replace the button text only (keep all attributes):
  ```html
  <button class="seq-gen-btn dr-stage-btn" id="seqProbBtn" onclick="seqProbToggle()" title="Add random hits based on probability">🎲 Probability Roll</button>
  ```

- [ ] **Step 2: Add Random Vel button to main toolbar row**

  Find at ~line 25108–25109:
  ```html
          <button class="seq-gen-btn dr-stage-btn" id="seqFillBtn" onclick="seqFillToggle()" title="Add a drum fill">🥁 Fill</button>
          <button class="dr-mob-more-btn" id="drMobMoreBtn" onclick="_drToggleMobMore()" title="More options">&#8943;</button>
  ```

  Replace with (adds Random Vel between Fill and ⋯):
  ```html
          <button class="seq-gen-btn dr-stage-btn" id="seqFillBtn" onclick="seqFillToggle()" title="Add a drum fill">🥁 Fill</button>
          <button class="seq-gen-btn dr-stage-btn" onclick="seqRandomizeDrumVelocity()" title="Randomize velocity of active drum hits">🎲 Random Vel</button>
          <button class="dr-mob-more-btn" id="drMobMoreBtn" onclick="_drToggleMobMore()" title="More options">&#8943;</button>
  ```

- [ ] **Step 3: Remove Randomize Velocity from the more panel**

  Find at ~line 25142:
  ```html
          <button class="dr-stage-btn" style="font-size:9px;padding:4px 6px;background:var(--card2);border:1px solid var(--gold);color:var(--gold);border-radius:4px;cursor:pointer;" onclick="seqRandomizeDrumVelocity()" title="Randomize velocity of active drum hits">🎲 Randomize Velocity</button>
  ```

  Delete that entire line.

- [ ] **Step 4: Manual verify — desktop**

  At ≥900px: toolbar should show "🎲 Probability Roll | 🥁 Fill | 🎲 Random Vel" inline. The ⋯ button is hidden. The more panel (shown automatically on desktop) should no longer contain a Randomize Velocity button.

- [ ] **Step 5: Manual verify — mobile**

  At mobile width: main row shows "🎲 Probability Roll | 🥁 Fill | 🎲 Random Vel | ⋯". Tapping ⋯ opens the more panel — confirm no duplicate Randomize Velocity button in there.

- [ ] **Step 6: Commit**

  ```bash
  git add 1.291.html
  git commit -m "feat(drum-drawer): rename Prob→Probability Roll, promote Random Vel to toolbar"
  ```
