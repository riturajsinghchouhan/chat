# Architecture

```
 Browser (React SPA on Vercel)
   │  HTTPS  /api/*   (REST: auth, history, uploads, edits)
   │  WSS    /socket.io (real-time: send, receipts, typing, presence)
   ▼
 Node.js process (Render / VPS)
   ├─ Express 5 app  ── helmet, CORS allowlist, rate limits, zod validation
   ├─ Socket.IO      ── same HTTP server, JWT-authenticated handshake
   └─ Services       ── messageService: persist → update conversation → broadcast
   ▼
 MongoDB (Atlas)
   ├─ users, sessions, conversations, messages, notifications
   └─ media.files / media.chunks  (GridFS: images, thumbnails, documents, avatars)
```

The frontend can stay on Vercel while the API and the persistent Socket.IO server run on Render or a VPS. Socket.IO needs a long-lived process, so it must **not** be deployed as a Vercel Serverless Function.

## Data model

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | name, username (unique), email (unique), passwordHash (never selected by default), avatar, bio, isOnline, lastSeen, blockedUsers[], settings | username, email, name |
| `sessions` | user, tokenHash (SHA-256 of refresh token), prevTokenHash, rotatedAt, expiresAt | TTL on expiresAt, user |
| `conversations` | type (direct/group), members[{user, role, lastReadAt, unreadCount, pinned, archived, muted}], directKey, name, description, avatar, lastMessage, lastMessageAt, pinnedMessages[], settings.adminsOnlyMessages | (members.user, lastMessageAt), unique partial directKey |
| `messages` | conversationId, senderId, receiverId, clientId, type (text/image/gif/file/system), text, mediaId, thumbnailId, mediaUrl, thumbnailUrl, mimeType, fileName, fileSize, width, height, provider, providerId, replyTo, forwarded, reactions[], status, deliveredAt, readAt, deliveredTo[], readBy[], editedAt, deletedAt, hiddenFor[] | (conversationId, _id), (conversationId, type, _id), unique partial (senderId, clientId), (receiverId, status), mediaId, thumbnailId |
| `notifications` | user, type, actor, conversationId, text, read | (user, createdAt), TTL 60 days |
| `media.files` (GridFS) | metadata: kind (message/thumb/avatar), ownerId, conversationId, attached, contentType, originalName, width, height | (metadata.kind, metadata.attached, uploadDate) |

Per-member state (unread count, pin/archive/mute, last read) lives inside the conversation's `members` array, so the chat list loads in one query. User data is referenced, not copied.

**Cleanup policy:** expired sessions (TTL index), old notifications (TTL index), unattached uploads older than 24 h and expired reset tokens (hourly job). Messages and attached media are never removed by routine cleanup — only by explicit "delete for everyone".

## Message delivery guarantees

1. The client creates a UUID `clientId` and shows an optimistic bubble (status `sending`).
2. It emits `message:send` with an acknowledgement callback (10 s timeout). If the socket is offline or the ack times out, it falls back to `POST /api/messages` with the **same** `clientId`.
3. The server validates the payload, derives the sender from the verified token, checks membership/blocks/group permissions, then **writes the message to MongoDB first**.
4. A unique index on `(senderId, clientId)` makes sending idempotent: a retry after a reconnect returns the stored message instead of creating a duplicate.
5. Only after persistence does the server update the conversation and emit `message:new` to every member's user room, and ack the sender with the stored message.
6. The client merges by `_id`/`clientId`, so the ack and the broadcast echo collapse into one bubble.
7. Failed sends show "Retry". Network failures are retried automatically when the socket reconnects. After any reconnect the client re-fetches the chat list and the open conversation, so nothing is missed.

Status flow: `sent` (persisted) → `delivered` (recipient device acked, or recipient came online) → `read` (recipient opened the chat). In groups a message is `read` once every other member has read it.

## Socket.IO events

All events are authenticated; the user id always comes from the verified JWT, never from the payload. Every payload is validated with zod and each socket is rate-limited per event group.

Client → server (with acknowledgement):

| Event | Payload | Notes |
|---|---|---|
| `message:send` | `{ clientId, conversationId, type, text?, mediaId?, gif?, replyTo? }` | Ack `{ ok, message, duplicate }` |
| `message:delivered` | `{ messageIds[] }` | Only affects messages in the user's conversations |
| `conversation:read` | `{ conversationId }` | Resets unread, updates receipts |
| `typing:start` / `typing:stop` | `{ conversationId }` | Ignored for non-members and blocked pairs |
| `auth:refresh` | `{ token }` | Extends the live socket after a token refresh |

Server → client:

| Event | Payload |
|---|---|
| `message:new` | `{ message }` |
| `message:updated` | `{ message }` (edit, delete for everyone, reactions) |
| `message:hidden` | `{ conversationId, messageId }` (delete for me — other tabs) |
| `message:delivered` | `{ conversationId, messageIds, userId, deliveredAt }` |
| `message:read` | `{ conversationId, userId, readAt, isGroup }` |
| `typing:start` / `typing:stop` | `{ conversationId, userId }` |
| `user:online` / `user:offline` | `{ userId, lastSeen? }` |
| `user:updated` / `user:deleted` / `user:blocked` | profile changes, account deletion, block list sync |
| `conversation:new` / `conversation:updated` / `conversation:removed` / `conversation:prefs` | group lifecycle, pins, per-user prefs sync |
| `notification:new` | `{ notification }` |
| `auth:expired` | access token expired mid-session; the client refreshes and reconnects |

Edits, deletes, reactions, pins, forwards and group management go through REST (easier to authorize and test); the server then broadcasts the result over Socket.IO.

### Rooms

Every socket joins `user:<userId>`. Messages are emitted to the user rooms of the conversation's current members, so:
- all tabs and devices of a user receive events (multi-device support);
- membership changes take effect immediately (a removed member stops receiving events without needing to leave a room);
- nothing is ever broadcast to all sockets.

### Presence

On connect the user is marked online and contacts get `user:online` (only for the first socket). On disconnect the server checks `fetchSockets()` on the user room — this works across instances with the Redis adapter — and only marks the user offline (with `lastSeen`) when no sockets remain.

## Scaling: sticky sessions vs the Redis adapter

They solve two different problems:

- **Sticky sessions** keep all HTTP requests of one Socket.IO connection on the same server. Needed only when the HTTP long-polling transport is used (it sends many separate HTTP requests that must reach the process holding the session). Pure WebSocket connections are a single TCP connection and don't need it.
- **The Redis adapter** lets instances share room broadcasts. Without it, an event emitted on instance A never reaches a recipient connected to instance B.

So:

| Setup | Needs |
|---|---|
| 1 instance (default) | nothing |
| N instances, clients may fall back to polling | Redis adapter **and** sticky sessions (`ip_hash` in Nginx; Render multi-instance does not guarantee stickiness, so restrict clients to `transports: ['websocket']` there) |
| N instances, WebSocket-only clients | Redis adapter |

Set `REDIS_URL` to enable the adapter — no code changes. Message persistence never depends on Socket.IO memory: everything important is in MongoDB.

## Authentication

- Access token: JWT, 15 minutes, kept in memory only (not in localStorage), sent as `Authorization: Bearer`.
- Refresh token: JWT bound to a server-side session, stored as an `httpOnly`, `Secure`, `SameSite` cookie scoped to `/api/auth`. Only its SHA-256 hash is stored.
- Rotation on every refresh. Re-using an old token after a 30-second grace window (which covers several tabs refreshing at once) revokes the session.
- Page reloads call `/auth/refresh` to restore the session. The client refreshes proactively every 10 minutes and once on any 401.
- Password reset: random 256-bit token, hashed in the DB, valid 30 minutes, single use; all sessions are revoked after a reset.

## Capacity

No specific user count is claimed. Capacity depends on instance size, MongoDB tier and message rate; measure it with a load test (e.g. Artillery's Socket.IO engine) against your own deployment before promising numbers.
