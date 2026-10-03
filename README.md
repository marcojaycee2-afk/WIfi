# NAPBOX ISP Manager

## Run with PostgreSQL

Install and start Docker Desktop, then run:

```powershell
if (!(Test-Path .env)) { Copy-Item backend/.env.example .env }
# Edit .env: set GOOGLE_CLIENT_ID, GOOGLE_ADMIN_EMAIL, SESSION_SECRET (32+ random bytes),
# and optionally MAPBOX_ACCESS_TOKEN to your Mapbox public token (pk...)
docker compose up --build
```

Open http://localhost:3000. PostgreSQL data is kept in the `postgres_data` Docker volume. The app creates its table automatically from `backend/schema.sql` on startup.

To run without Docker, install Node.js 20 or newer and PostgreSQL, copy `backend/.env.example` to `.env`, and set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_ADMIN_EMAIL`, and `SESSION_SECRET`. Then run `npm install` and `npm start`.

Create a **Web application** OAuth client in Google Cloud Console. Add the exact website origin (for example `http://localhost:3000` for local Docker and your deployed `https://...` origin) to **Authorized JavaScript origins**. Configure the OAuth consent screen for your use case. Set `GOOGLE_CLIENT_ID` to the OAuth client ID and `GOOGLE_ADMIN_EMAIL` to the one Google account allowed to sign in.

For a hosted container, configure `DATABASE_URL` with your PostgreSQL connection string, and set `GOOGLE_CLIENT_ID`, `GOOGLE_ADMIN_EMAIL`, and `SESSION_SECRET` (at least 32 random bytes) as app-service variables. Generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. On Railway, use the private Postgres `DATABASE_URL` variable reference. Also make sure the service listens on the platform-provided `PORT`; the server defaults to `3000` when it is not set. Docker images bind to `0.0.0.0` so hosted platforms can route traffic to the container, while running `npm start` directly binds to localhost unless `HOST` is set. The app exits at startup if any required database or Google login setting is missing.

Google ID tokens are verified on the server, and only the configured, verified admin email can sign in. The resulting HTTP-only, same-site session cookie expires after 8 hours. Login attempts are rate limited per client IP. Sign out from the dashboard using the **Sign out** button. Use HTTPS when hosting publicly; production cookies are marked Secure.

The included Compose setup publishes the app only on localhost; add TLS before making it reachable by other devices or the public internet.

Use a Mapbox public token beginning with `pk.`. It is delivered to the browser for map rendering, so restrict it to your app's URL in your Mapbox account. Never use a secret `sk.` token in the browser app.