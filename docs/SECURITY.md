# Security checklist

## What is implemented

**Authentication & sessions**
- [x] Passwords hashed with bcrypt (cost 12); hashes are `select: false` and stripped from every JSON response
- [x] Password policy (≥ 8 chars, letter + number) enforced server-side
- [x] Short-lived access JWT (15 min) kept in memory, not localStorage
- [x] Refresh token in an `httpOnly`, `Secure`, `SameSite` cookie scoped to `/api/auth`; only its SHA-256 hash is stored
- [x] Refresh rotation with reuse detection (session revoked); 30 s grace for concurrent tabs
- [x] Logout deletes the session; password change/reset revokes all sessions and disconnects sockets
- [x] Reset tokens: 256-bit random, hashed, 30-minute expiry, single use
- [x] Same response for unknown and known accounts on login failures and forgot-password (limits user enumeration); constant-time-ish login via a dummy bcrypt compare

**Authorization**
- [x] Every protected route requires a valid access token
- [x] Conversation, message and media access checks use the authenticated user id; non-members get 404 (no existence leak)
- [x] Only senders can edit / delete-for-everyone their messages; time window enforced server-side
- [x] Group admin checks for rename, avatar, settings, adding/removing members and roles
- [x] Blocks enforced in the shared send path, so REST and Socket.IO behave the same
- [x] Media ids in messages must belong to the sender and the same conversation

**Socket.IO**
- [x] Handshake requires a valid access token; user id comes from the token only
- [x] Every event payload validated with zod; per-socket rate limits per event group
- [x] `maxHttpBufferSize` 100 KB (media never travels over the socket)
- [x] Expired tokens are rejected on the next event; `auth:refresh` only accepts a token for the same user
- [x] Events are emitted to member user rooms only — never broadcast globally

**Input & uploads**
- [x] zod validation on body/params/query; unknown keys stripped
- [x] `$`-prefixed and dotted keys removed from bodies (NoSQL injection defence in depth)
- [x] Search input regex-escaped; message length ≤ 4000; JSON body ≤ 100 KB
- [x] File type detected from magic bytes (`file-type`), not the client MIME type; allow-list only
- [x] Size limits per type; images re-encoded (strips EXIF/GPS, defeats polyglots); originals' names sanitized
- [x] Media served with `X-Content-Type-Options: nosniff`, restrictive CSP + `sandbox`, `attachment` disposition for non-images
- [x] No filesystem paths accepted; files go straight to GridFS from memory
- [x] GIF messages only accept HTTPS URLs on `*.giphy.com`; GIPHY key stays on the server

**HTTP hardening**
- [x] Helmet headers (CORP set to `cross-origin` so the SPA can embed avatars)
- [x] CORS allow-list from `CLIENT_URL`, credentials enabled only for allowed origins
- [x] Rate limits: 300/min API, 20/15 min on auth endpoints, 30/min uploads
- [x] Generic 500 responses; stack traces only in server logs
- [x] Logs never include passwords, tokens, cookies or query strings
- [x] `trust proxy` configured so rate limits see real client IPs behind Render/Nginx

## Before going live

- [ ] Generate new random `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (≥ 48 bytes each, different)
- [ ] `NODE_ENV=production`, HTTPS everywhere, `CLIENT_URL` set to the exact production origin(s)
- [ ] MongoDB Atlas: dedicated DB user, IP allow-list (not `0.0.0.0/0`), backups enabled
- [ ] `.env` files are not committed (`.gitignore` covers them) and are `chmod 600` on servers
- [ ] SMTP configured (otherwise password reset cannot work in production)
- [ ] Use custom domains on one site (`app.` + `api.`) so the refresh cookie is first-party
- [ ] Review rate limits against expected traffic; consider a WAF / Cloudflare in front
- [ ] Run `npm audit` in both folders and keep dependencies updated

## Known limitations

- **Not end-to-end encrypted.** Messages are encrypted in transit (HTTPS/WSS) and stored in plaintext in MongoDB. Anyone with database access can read them. Do not market the app as end-to-end encrypted.
- Avatars are public by URL (like most messengers); chat media is private.
- In-process rate limiters are per instance; with several instances use a shared store (e.g. `rate-limit-redis`).
- Presence (`online` / `last seen`) is shared with everyone who has a conversation with the user, including people they have blocked. Blocking stops messages and new chats, not presence.
