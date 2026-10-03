# NAPBOX ISP Manager

## Run with PostgreSQL

Install and start Docker Desktop, then run:

```powershell
# Create a local .env file with ADMIN_PASSWORD (12+ characters),
# SESSION_SECRET (32+ random bytes), and optionally MAPBOX_ACCESS_TOKEN.
docker compose up --build
```

Open http://localhost:3000. PostgreSQL data is kept in the `postgres_data` Docker volume. The app creates its table automatically from `backend/schema.sql` on startup.

To run without Docker, install Node.js 20 or newer and PostgreSQL, create a local `.env` file with `DATABASE_URL`, `ADMIN_PASSWORD` (at least 12 characters), and `SESSION_SECRET` (at least 32 random bytes), then run `npm install` and `npm start`.

The admin username defaults to `telecomadmin`; you may override it with `ADMIN_USERNAME`. For a hosted container, configure `DATABASE_URL` with your PostgreSQL connection string, `ADMIN_PASSWORD` (at least 12 characters), and `SESSION_SECRET` (at least 32 random bytes) as app-service variables. Do not store passwords or session secrets in source control. Generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. On Railway, use the private Postgres `DATABASE_URL` variable reference. Also make sure the service listens on the platform-provided `PORT`; the server defaults to `3000` when it is not set. Docker images bind to `0.0.0.0` so hosted platforms can route traffic to the container, while running `npm start` directly binds to localhost unless `HOST` is set. The app exits at startup if any required database or login setting is missing.

Sign-in uses an HTTP-only, same-site session cookie that expires after 8 hours. Login attempts are rate limited per client IP. Sign out from the dashboard using the **Sign out** button. Use HTTPS when hosting publicly; production cookies are marked Secure.

New clients default to ₱800/month for 25 Mbps and ₱1,000/month for 50 Mbps. The default roster contains the 68 customers transcribed from the supplied list, with continuous client IDs; no customers were invented for the two missing count numbers. Only exact ₱800 and ₱1,000 rates are assigned those speeds, while other rates remain `Unspecified` for manual assignment. The monthly rate remains editable per client, so you can enter a discounted amount; saved custom rates are preserved.

The included Compose setup publishes the app only on localhost; add TLS before making it reachable by other devices or the public internet.

Use a Mapbox public token beginning with `pk.`. It is delivered to the browser for map rendering, so restrict it to your app's URL in your Mapbox account. Never use a secret `sk.` token in the browser app.