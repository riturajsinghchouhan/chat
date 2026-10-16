# Testing

## Automated tests

### Backend — `cd server && npm test`

Vitest + Supertest against the real Express app, real Socket.IO clients, and MongoDB (in-memory via `mongodb-memory-server`, which downloads a MongoDB binary on first run). To use an existing MongoDB instead (faster, offline):

```bash
MONGODB_TEST_URI="mongodb://127.0.0.1:27017/x" npm test     # each run uses a throwaway database
```

| File | Covers |
|---|---|
| `tests/auth.test.js` | registration, duplicate/weak input, login by email or username, generic errors, unauthorized requests, NoSQL-injection payloads, refresh rotation + multi-tab grace + reuse revocation, logout, forgot/reset password, change password, account deletion |
| `tests/messages.test.js` | private conversation access, persistence + pagination, duplicate prevention via `clientId`, length limits, edit/delete permissions, delete-for-me, reactions, replies, pins, forwarding, search, blocking, GIF URL allow-list, GIF provider not configured |
| `tests/socket.test.js` | socket authentication, real-time delivery with acks, delivered/read receipts, typing indicators scoped to members, spoofed sender ids, duplicate prevention across reconnects, multi-tab presence, offline → delivered on reconnect, blocks enforced over sockets |
| `tests/media-groups.test.js` | image upload (camera capture path), thumbnails, media access control, content-sniffing rejection of fake files, documents, foreign-conversation uploads, someone else's mediaId, avatars, group creation, admin permissions, admins-only mode, removal, notifications, admin hand-over when the last admin leaves |

### Frontend — `cd client && npm test`

Vitest + Testing Library (jsdom).

| File | Covers |
|---|---|
| `src/lib/messages.test.js` | optimistic → persisted swap, duplicate suppression, no status downgrade, ordering, receipts for direct and group chats |
| `src/components/CameraCaptureModal.test.jsx` | permission denied, missing camera, capture → upload → send, capture disabled until real frames arrive, upload failure keeps the preview and retries, tracks stopped on unmount, device-image fallback with type validation |
| `src/components/GifPicker.test.jsx` | trending through the backend proxy, attribution, debounced search, selection + recents, error/retry when not configured |

## Manual test plan

### Two accounts, two browser windows

1. Start backend and frontend (`npm run dev` in both folders).
2. Open `http://localhost:5173` in a normal window and in a private window (separate cookies).
3. Register **A** and **B**. In A, type B's username in the sidebar search → click B → send "hello".
4. Expected: B's sidebar shows the chat with an unread badge immediately; A's message shows one grey tick (sent) then two (delivered).
5. B opens the chat → A's ticks turn blue (read), B's badge clears.
6. Type in B without sending → A's header and chat list show "typing…", which disappears ~3 s after B stops.
7. Right-click (desktop) or long-press (mobile) a message: reply, react, copy, forward, pin, edit (own), delete for me, delete for everyone (own, within 60 min). Check both windows update.
8. Create a group from the people icon in the bottom nav; add B. Check system messages, member list, admin badge, rename (admin only), admins-only toggle, remove member, leave group.

### Two devices

1. Run the frontend with `npm run dev -- --host` and open `http://<your-LAN-IP>:5173` on a phone on the same Wi-Fi. The Vite proxy forwards API/socket traffic to the backend.
2. Sign in as the same user on both devices → messages, read state and pins sync to both.
3. Note: phone browsers block the camera on plain `http://<ip>`; test the camera on `localhost` on desktop, or on the HTTPS deployment.

### Camera permissions

1. Click the camera icon in the composer → the browser asks for permission → allow → live preview appears; Capture becomes active once frames arrive.
2. Capture → preview → Retake (camera restarts) → Capture → add a caption → Send. Recipient sees the image instantly.
3. Deny permission (or block it in site settings) → the modal explains how to re-enable it and offers "choose from device".
4. Disconnect / disable the webcam → "No camera found". Open the camera in another app → "Camera is busy".
5. On a phone with two cameras, the switch button toggles front/rear.
6. Close the modal → the camera light turns off (tracks are stopped).

### GIF API configuration

1. Without `GIPHY_API_KEY`: the GIF panel shows "GIF search is not configured on this server" with Retry.
2. Create a key at <https://developers.giphy.com/dashboard/> (API, not SDK), set `GIPHY_API_KEY` in `server/.env`, restart the backend.
3. GIF panel → trending loads → search "cat" → pick one → it appears in both windows. Inspect the browser's network tab: requests go to `/api/gifs/*`, and the key never appears in the frontend.

### Media upload failures

1. Try uploading a `.exe` renamed to `.png` → rejected (415) because the bytes are checked.
2. Upload an image > 10 MB or a file > 20 MB → rejected with a size message.
3. Camera flow: in devtools set the network to **Offline**, press Send → an error appears and the preview stays; go back online → Retry succeeds.
4. Attachment flow: go offline, attach a file and send → the bubble shows "Message not sent · Retry"; go online → it is retried automatically (or press Retry).

### Reconnection after network interruption

1. With both windows in a chat, stop the backend (Ctrl+C). The sidebar shows "Offline — messages will send when you reconnect".
2. Send a message in A → it shows "Message not sent".
3. Start the backend again → within a few seconds A reconnects, the message is sent automatically, B receives it **once**, and the chat lists resync.
4. Alternatively toggle devtools Network → Offline/Online, or switch Wi-Fi off and on.
