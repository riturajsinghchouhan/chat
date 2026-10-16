# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Server exits with `Missing required environment variable` | `.env` missing or incomplete | `cp .env.example .env` in `server/` and fill `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` |
| `MongoServerSelectionError` / server stops on boot | MongoDB unreachable | Start local `mongod`, or add the server IP in Atlas **Network Access**, and check the user/password in the URI (URL-encode special characters) |
| Frontend loads but every API call is 404 locally | Backend not running, or Vite proxy can't reach it | Start `server` (`npm run dev`). The proxy targets `127.0.0.1:5000`; if you changed `PORT`, update `client/vite.config.js` |
| Logged out on every page reload (production) | Refresh cookie blocked | Backend needs `COOKIE_SAMESITE=none` and HTTPS when app and API are on different sites; Safari may still block third-party cookies → use `app.` + `api.` subdomains of one domain with `COOKIE_SAMESITE=lax` |
| CORS error in the browser console | Origin not allow-listed | Add the exact origin (scheme + host, no trailing slash) to `CLIENT_URL` and restart the backend |
| Socket keeps reconnecting / `connect_error: unauthorized` | Expired or missing token, or wrong `VITE_API_URL` | Sign in again; check `VITE_API_URL` points to the backend origin and redeploy the frontend after changing it |
| WebSocket fails behind Nginx (only polling works) | Missing upgrade headers | Use `deploy/nginx.conf` (`Upgrade` / `Connection` headers on `/socket.io/`), then `sudo nginx -t && sudo systemctl reload nginx` |
| Messages reach only some users when running 2+ instances | No shared adapter | Set `REDIS_URL` on every instance; keep sticky sessions if polling is allowed |
| Camera button shows "Camera access requires HTTPS" | Page opened over plain HTTP on a non-localhost address | Use `https://` in production, or `localhost` in development |
| "Camera permission denied" | Permission blocked earlier | Click the lock icon in the address bar → Camera → Allow, then press "Try again" |
| "Camera is busy" | Another app/tab holds the camera | Close the other app (Zoom, Teams, another tab) and retry |
| Upload fails with 413 | File above limit or Nginx limit | Images ≤ `MAX_IMAGE_MB`, files ≤ `MAX_FILE_MB`; raise `client_max_body_size` in Nginx if you raise the limits |
| Upload fails with 415 | File type not allowed or file content doesn't match its extension | Allowed: JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, PPTX, ZIP, TXT, CSV, MD |
| Images show a broken-image icon | Viewer is not a member of that conversation anymore, or the message was deleted for everyone | Expected behaviour — access is checked per request |
| GIF panel: "GIF search is not configured" | `GIPHY_API_KEY` not set | Add the key to `server/.env` and restart |
| GIF panel: "GIF rate limit reached" | GIPHY beta key limits | Wait, or request a production key from GIPHY |
| Password reset email never arrives | SMTP not configured | Set `SMTP_*`; in development the link is printed to the server console |
| `npm install` fails building `bcrypt` or `sharp` | Unsupported platform or old Node | Use Node 20+ on x64/arm64 Linux, macOS or Windows (prebuilt binaries); on Alpine install `build-base python3` |
| Backend tests hang on first run | `mongodb-memory-server` downloading MongoDB | Wait for the download, or run with `MONGODB_TEST_URI=mongodb://127.0.0.1:27017/x npm test` |
| Render: first request takes ~1 minute | Free instance was asleep | Use a paid instance for a chat app (sleeping also drops all sockets) |
| Atlas storage full | GridFS media count against the DB quota | Upgrade the tier, lower upload limits, or move media to object storage (`server/src/services/storage.js`) |
