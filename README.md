# Pulse Chat

A real-time messaging web app (WhatsApp Web / Telegram style) built on the MERN stack with Socket.IO.

- One-to-one and group chats with instant delivery, typing indicators, presence and read receipts
- Text, emoji, GIFs (GIPHY), images, documents, and **live camera capture**
- Reply, edit, delete (for me / for everyone), react, forward, pin, search
- Light/dark neumorphic UI, responsive down to phone width
- Media is stored **in MongoDB (GridFS)** — no Cloudinary or other storage service required

> **Encryption:** traffic is encrypted in transit (HTTPS/WSS). Messages are stored on the server and are **not end-to-end encrypted**.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router 7, Zustand, Axios, Socket.IO client, lucide-react, react-hot-toast, emoji-picker-react |
| Backend | Node.js 20+, Express 5, Socket.IO 4, Mongoose 9, Zod, JWT, bcrypt, Multer, sharp, file-type, Helmet, express-rate-limit |
| Data | MongoDB (Atlas in production); media in GridFS bucket `media` |
| Optional | Redis (Socket.IO adapter for multiple instances), SMTP (password-reset emails), GIPHY API key |

## Project structure

```
chat/
├── client/                 React + Vite SPA (deploy to Vercel)
│   ├── src/components/     AppSidebar, ConversationList, MessageBubble, MessageComposer,
│   │                       CameraCaptureModal, GifPicker, GroupInfoPanel, ...
│   ├── src/pages/          Login, Register, Forgot/Reset password, Chat, Settings, ...
│   ├── src/store/          Zustand stores (auth, chat, ui)
│   ├── src/lib/            api (axios + token refresh), socket, message merge logic, utils
│   └── vercel.json         SPA fallback + asset caching
├── server/                 Express + Socket.IO API (deploy to Render or a VPS)
│   ├── src/models/         User, Session, Conversation, Message, Notification
│   ├── src/controllers/    auth, users, conversations, messages, media, groups, notifications, gifs
│   ├── src/services/       messageService (persist → broadcast), storage (GridFS), ...
│   ├── src/socket/         authenticated Socket.IO server + emit helpers
│   ├── src/jobs/           hourly cleanup of abandoned uploads / expired reset tokens
│   ├── scripts/init-db.js  creates all indexes
│   ├── tests/              Vitest + Supertest + real Socket.IO clients
│   └── ecosystem.config.cjs  PM2 config
├── deploy/nginx.conf       Reverse proxy with WebSocket upgrade headers
├── render.yaml             Render blueprint for the API
└── docs/                   Architecture, deployment, testing, security, troubleshooting
```

## Quick start (local development)

Prerequisites: **Node.js 20+** and **MongoDB** (local `mongod`, Docker, or a free Atlas cluster).

```bash
# 1. Backend
cd server
cp .env.example .env            # then edit MONGODB_URI and set two random JWT secrets
npm install
npm run db:init                 # creates indexes
npm run dev                     # http://localhost:5000  (health: /api/health)

# 2. Frontend (new terminal)
cd client
cp .env.example .env            # leave VITE_API_URL empty for local dev
npm install
npm run dev                     # http://localhost:5173
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

In development Vite proxies `/api` and `/socket.io` to `127.0.0.1:5000`, so cookies are same-origin and no CORS setup is needed. Open two browsers (or a normal + private window), register two accounts, and chat.

Optional:
- **GIFs:** create a free key at <https://developers.giphy.com/> and set `GIPHY_API_KEY` in `server/.env`. Without it, the GIF panel shows "GIF search is not configured".
- **Password reset emails:** set `SMTP_*`. Without SMTP, in development the reset link is printed in the server console.

## Scripts

| Location | Command | What it does |
|---|---|---|
| server | `npm run dev` | API with auto-restart (`node --watch`) |
| server | `npm start` | Production start |
| server | `npm run db:init` | Create/sync MongoDB indexes (incl. GridFS) |
| server | `npm test` | Backend test suite (in-memory MongoDB; or set `MONGODB_TEST_URI`) |
| client | `npm run dev` / `build` / `preview` | Vite dev server / production build / preview |
| client | `npm test` | Frontend unit tests (Vitest + Testing Library) |

## Environment variables

### Backend (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` |
| `PORT` | no | HTTP port (Render sets it automatically). Default `5000` |
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_ACCESS_SECRET` | yes | Secret for 15-minute access tokens |
| `JWT_REFRESH_SECRET` | yes | Secret for refresh tokens (different from the access secret) |
| `ACCESS_TOKEN_TTL` | no | Default `15m` |
| `REFRESH_TOKEN_DAYS` | no | Default `30` |
| `CLIENT_URL` | yes | Comma-separated allowed frontend origins (CORS + Socket.IO). First one is used in reset-password links |
| `COOKIE_SAMESITE` | no | `none` when frontend and API are on different sites (Vercel + Render), `lax` when same-site. Default: `none` in production |
| `COOKIE_DOMAIN` | no | Set only if API and app share a parent domain (e.g. `.example.com`) |
| `TRUST_PROXY` | no | Number of proxies in front of Node. Default `1` (Render, Nginx) |
| `GIPHY_API_KEY` | no | Enables GIF search (proxied by the server; never sent to the browser) |
| `MAX_IMAGE_MB` / `MAX_FILE_MB` | no | Upload limits. Defaults `10` / `20` |
| `DELETE_FOR_EVERYONE_MINUTES` | no | Window for "delete for everyone". Default `60` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | Password-reset email delivery |
| `REDIS_URL` | no | Enables the Socket.IO Redis adapter for multiple instances |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` |

### Frontend (`client/.env`)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Public backend origin, e.g. `https://pulse-chat-api.onrender.com` (no trailing slash, no `/api`). Empty in local dev |

Only `VITE_*` variables reach the browser. Never put database URIs, JWT secrets or the GIPHY key in the frontend.

## How media storage works (no Cloudinary)

1. The browser uploads the file to `POST /api/media/upload` (multipart) with the conversation id.
2. The server checks membership, detects the **real** file type from its bytes (the client MIME type is ignored), enforces size limits, re-encodes images with sharp (strips EXIF/GPS, fixes rotation, caps resolution) and creates a WebP thumbnail.
3. The file is streamed into MongoDB **GridFS** (chunked, so not limited by the 16 MB document size).
4. The client sends the message with the returned `mediaId`; the server verifies the uploader owns it.
5. `GET /api/media/:id` streams the file only to members of a conversation that contains it. Avatars are public.
6. Uploads never attached to a message are deleted after 24 hours.

Allowed: JPEG, PNG, WebP, GIF (≤ 10 MB); PDF, DOCX, XLSX, PPTX, ZIP, TXT, CSV, MD (≤ 20 MB).

Trade-off: media shares your database's storage quota. On Atlas M0 (512 MB) that fills quickly — use a paid tier or move media to object storage later; only `services/storage.js` would change.

## Documentation

- [Architecture & real-time design](docs/ARCHITECTURE.md) — data model, socket events, delivery guarantees, sticky sessions vs Redis adapter
- [Deployment](docs/DEPLOYMENT.md) — Vercel + Render, or Ubuntu VPS with Nginx, PM2 and Certbot; MongoDB Atlas
- [Testing](docs/TESTING.md) — automated suites and the manual test plan
- [Security checklist](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## API overview

All routes are under `/api`. Protected routes need `Authorization: Bearer <accessToken>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`; `GET /auth/me` |
| Users | `GET /users/search?q=`, `GET /users/blocked`, `GET /users/:id`, `PATCH /users/profile`, `PATCH /users/settings`, `POST /users/avatar`, `DELETE /users/avatar`, `POST|DELETE /users/:id/block`, `DELETE /users/me` |
| Conversations | `POST /conversations` (start DM), `GET /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id` (pin/archive/mute), `GET /conversations/:id/media`, `POST /conversations/:id/pins`, `POST /conversations/:id/read` |
| Messages | `GET /messages/:conversationId?before=&limit=&search=`, `GET /messages/search?q=`, `GET /messages/item/:id`, `POST /messages`, `PATCH /messages/:id`, `DELETE /messages/:id?scope=me|everyone`, `POST /messages/:id/reactions`, `POST /messages/:id/forward` |
| Media | `POST /media/upload`, `GET /media/:mediaId` |
| Groups | `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `POST /groups/:id/avatar`, `POST /groups/:id/members`, `PATCH /groups/:id/members/:userId` (role), `DELETE /groups/:id/members/:userId` (remove / leave) |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |
| GIFs | `GET /gifs/trending`, `GET /gifs/search?q=` |
| Health | `GET /health` |

Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

## Not included

- Voice/video calls (no call buttons are shown)
- End-to-end encryption
- Push notifications when the browser is closed (desktop notifications work while a tab is open)
