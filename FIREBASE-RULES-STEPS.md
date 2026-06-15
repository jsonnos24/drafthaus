# How to publish the recording-lockdown rules (step by step)

**What this does:** stops other logged-in users from reaching your recordings.
After this: you can listen/change/delete your own songs' audio; people you *share*
a song with can listen only; everyone else gets nothing.

**Nothing is live until YOU click "Publish" in Firebase.** You can roll back anytime.

The new rules are in this project:
- `firestore.rules`  (the database rules)
- `storage.rules`    (the audio-file rules)

Your current/old rules are backed up here in case you need them:
- `firestore.rules.live-backup-2026-06-15.txt`
- `storage.rules.live-backup-2026-06-15.txt`

---

## Part 1 — Firestore (database) rules

1. Go to **console.firebase.google.com** and open the **drafthaus-ca18c** project.
2. Left menu → **Build → Firestore Database** → top tab **Rules**.
3. **Before changing anything:** select all the text already there and copy it somewhere
   safe (or trust the backup file above). This is your rollback copy.
4. Delete what's in the editor and **paste the entire contents of `firestore.rules`**.
5. Click **Publish**.

### Test it (do this right after publishing)
Still on that Rules tab, click the **Rules Playground** (a small "play"/simulator link
near the editor). Run these quick simulations against one of your real songs:

| Simulate | Location / Collection | Expect |
|---|---|---|
| **get** as YOU (a take in your own song) | `voice_takes` | **Allowed** |
| **get** as a DIFFERENT logged-in user (not shared) | same take | **Denied** |
| **delete** as that other user | same take | **Denied** |

If the "you = allowed" / "stranger = denied" pattern holds, you're good.

---

## Part 2 — Storage (audio files) rules

1. Same project → left menu → **Build → Storage** → top tab **Rules**.
2. Copy the existing text somewhere safe (rollback copy).
3. Delete it and **paste the entire contents of `storage.rules`**.
4. Click **Publish**.

### Test it
Use the Storage **Rules Playground** the same way, on a path like
`voice_takes/<one of your song IDs>/<a file name>`:

| Simulate | Expect |
|---|---|
| **get** (download) as YOU | **Allowed** |
| **get** as a stranger | **Denied** |
| **create/write** as a stranger | **Denied** |

---

## Part 3 — Real-world smoke test (5 min, in the actual apps)

Sign in as **yourself** and confirm everything still works normally:
- Your song list + lyrics load.
- Record a take, play it, **trim it** (it should save as MP3), then **delete** it.
- **Delete a whole song** — confirm it deletes cleanly (no errors).

If you have a second account and a shared song: that account should be able to **play**
the shared song's takes but **not delete** them.

---

## If anything breaks → roll back (instant)
Paste the matching backup file back into the same Rules editor and click **Publish**:
- Firestore problem → `firestore.rules.live-backup-2026-06-15.txt`
- Storage problem → `storage.rules.live-backup-2026-06-15.txt`

Then tell me what failed and I'll adjust.

---

## One thing to watch
The "list/play a shared song's takes" path is the only clever part of these rules
(it looks up the song to check sharing). The Playground tests above cover it. If a
shared collaborator reports they can't load a shared song's recordings, that's the
piece to revisit — tell me and I'll tweak it.
