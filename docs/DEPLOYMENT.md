# Deployment guide

Recommended layout:

| Part | Where |
|---|---|
| React SPA | Vercel |
| API + Socket.IO (one long-running Node process) | Render Web Service **or** Ubuntu VPS (Nginx + PM2) |
| Database + media (GridFS) | MongoDB Atlas |

The frontend stays on Vercel; the backend runs somewhere that keeps a process alive. Do not deploy the Socket.IO server as a Vercel Serverless Function — functions are short-lived and cannot hold WebSocket connections.

---

## 1. MongoDB Atlas

1. Create a project and a cluster. M0 (free, 512 MB) works for testing; because media lives in GridFS, use M10+ (or a larger shared tier) for real use.
2. **Database Access** → add a user with a strong generated password and the role *Read and write to any database* (or scope it to your database).
3. **Network Access** → add the backend's outbound IPs. Render's static outbound IPs are listed under your service's *Connect → Outbound* tab; for a VPS, add its public IP. Avoid `0.0.0.0/0` in production.
4. **Connect → Drivers** → copy the URI and add a database name:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/pulse_chat?retryWrites=true&w=majority`
5. Indexes are created by `npm run db:init` (Render runs it during the build in `render.yaml`; on a VPS run it once per deploy).

## 2. Backend on Render

1. Push the repository to GitHub/GitLab.
2. In Render: **New → Blueprint** and select the repo (uses `render.yaml`), or **New → Web Service** with:
   - Root directory: `server`
   - Build command: `npm ci --omit=dev && npm run db:init`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Instance type: a paid instance avoids free-tier sleeping (sleeping drops every WebSocket)
3. Environment variables:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `MONGODB_URI` | your Atlas URI |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different 96-char random hex strings |
   | `CLIENT_URL` | `https://your-app.vercel.app` (comma-separate extra origins, e.g. a custom domain) |
   | `COOKIE_SAMESITE` | `none` (Vercel and Render are different sites) |
   | `TRUST_PROXY` | `1` |
   | `GIPHY_API_KEY` | optional |
   | `SMTP_*`, `MAIL_FROM` | optional, for reset emails |

4. Render binds the port via `PORT`; the server listens on `0.0.0.0:$PORT`. HTTPS/WSS is terminated by Render automatically.
5. Graceful shutdown: on `SIGTERM` the server stops accepting connections, closes sockets and the DB connection (10 s limit). Clients reconnect automatically and resync.
6. Logs are single-line JSON on stdout (visible in the Render dashboard). Passwords, tokens and query strings are never logged.

Note: the free tier spins down after inactivity, which disconnects all sockets and delays the first request ~30–60 s.

## 3. Frontend on Vercel

1. **Add New → Project**, import the repo, set **Root Directory** to `client`. Vercel detects Vite.
2. Build command `npm run build`, output directory `dist` (already in `client/vercel.json`).
3. Environment variable: `VITE_API_URL=https://pulse-chat-api.onrender.com` (your backend URL, no trailing slash). Vite inlines it at build time, so **redeploy after changing it**.
4. SPA routing: `vercel.json` rewrites every non-asset path to `index.html`, so deep links like `/c/<id>` and `/reset-password?token=…` work on refresh.
5. After the first deploy, put the final Vercel URL (and any custom domain) into the backend's `CLIENT_URL` and restart the backend.

### Cookies across sites (Safari)

With the app on `*.vercel.app` and the API on `*.onrender.com`, the refresh cookie is a third-party cookie (`SameSite=None; Secure`). Chrome, Edge and Firefox accept it. Safari (and browsers with strict tracking protection) may block it, which logs users out on reload. Fix by putting both on one site:

- Custom domains: `app.example.com` (Vercel) + `api.example.com` (Render/VPS), set `COOKIE_SAMESITE=lax` and optionally `COOKIE_DOMAIN=.example.com`. This is the recommended production setup.

## 4. Backend on an Ubuntu VPS (Nginx + PM2 + Certbot)

Tested commands for Ubuntu 22.04/24.04. Replace `api.example.com` with your domain and point its DNS A/AAAA record at the server first.

### 4.1 Base setup and firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo adduser --disabled-password --gecos "" pulse
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 4.2 Node.js 22 and PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx
sudo npm install -g pm2
node -v
```

### 4.3 Application code and environment

```bash
sudo -iu pulse
git clone https://github.com/<you>/<repo>.git ~/app
cd ~/app/server
npm ci --omit=dev
cp .env.example .env
nano .env        # NODE_ENV=production, MONGODB_URI, secrets, CLIENT_URL, COOKIE_SAMESITE, PORT=5000
chmod 600 .env
npm run db:init
```

### 4.4 Run with PM2 (restart policy + boot startup)

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
exit                                   # back to your sudo user
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pulse --hp /home/pulse
```

`ecosystem.config.cjs` sets memory-based restarts, exponential back-off on crashes and a 12 s kill timeout so graceful shutdown can finish. Install log rotation:

```bash
sudo -iu pulse pm2 install pm2-logrotate
```

### 4.5 Nginx reverse proxy with WebSocket upgrade

```bash
sudo cp /home/pulse/app/deploy/nginx.conf /etc/nginx/sites-available/pulse-chat-api
sudo sed -i 's/api.example.com/YOUR_DOMAIN/' /etc/nginx/sites-available/pulse-chat-api
sudo ln -s /etc/nginx/sites-available/pulse-chat-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The config forwards `Upgrade`/`Connection` headers for `/socket.io/`, raises `client_max_body_size` for uploads, and passes `X-Forwarded-*` headers (keep `TRUST_PROXY=1`).

### 4.6 HTTPS with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN --redirect -m you@example.com --agree-tos
sudo certbot renew --dry-run
```

Camera access in browsers requires HTTPS (except on `localhost`), and the `Secure` refresh cookie requires it too.

### 4.7 Deploy updates and roll back

```bash
sudo -iu pulse
cd ~/app
git fetch --tags && git log --oneline -1          # note the current commit for rollback
git pull --ff-only
cd server && npm ci --omit=dev && npm run db:init
pm2 reload pulse-chat-api                          # graceful restart
curl -fsS https://YOUR_DOMAIN/api/health
```

Rollback:

```bash
cd ~/app && git checkout <previous-commit>
cd server && npm ci --omit=dev
pm2 reload pulse-chat-api
```

Schema changes in this project are additive (new optional fields), so rolling back code does not require a data migration.

Useful commands: `pm2 status`, `pm2 logs pulse-chat-api`, `pm2 monit`, `sudo journalctl -u nginx`.

## 5. Running more than one backend instance

1. Provision Redis (Render Key Value, Upstash, or `apt install redis-server`).
2. Set `REDIS_URL` on every instance — the Socket.IO Redis adapter turns on automatically.
3. Keep sticky sessions if clients can fall back to HTTP long-polling (Nginx `ip_hash` is already in `deploy/nginx.conf`). On platforms without stickiness, change `transports` in `client/src/lib/socket.js` to `['websocket']`.

See [ARCHITECTURE.md](ARCHITECTURE.md#scaling-sticky-sessions-vs-the-redis-adapter) for why both pieces exist.

## 6. Post-deploy checklist

- [ ] `GET https://api…/api/health` returns `{"status":"ok","db":true}`
- [ ] Register two accounts from two browsers; messages arrive instantly, ticks go grey → blue
- [ ] Reload the page — you stay signed in (refresh cookie works)
- [ ] Upload an image and a PDF; open/download them from the other account
- [ ] Camera button opens a live preview over HTTPS
- [ ] GIF search works (if `GIPHY_API_KEY` is set)
- [ ] Forgot password sends an email (if SMTP is set)
- [ ] Browser devtools show a `wss://` connection, not repeated polling requests
