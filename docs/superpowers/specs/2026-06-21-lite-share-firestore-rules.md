# Lite Share — Firestore rules to deploy (owner action)

Add this block inside `match /databases/{database}/documents { … }` in the
Firestore rules, then Publish in the Firebase console. NO Storage rule change.

    match /shares/{shareId} {
      allow get:    if true;
      allow list:   if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null
                    && request.auth.uid == request.resource.data.ownerId;
      allow update,
            delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
    }

Why `get` public but not `list`: viewers open a share by exact ID (`get`); the
public must never be able to enumerate/query the collection (`list`). Audio is
unaffected — it streams from each take's existing public Storage download URL.
Until this is published, the viewer link returns "unavailable".
