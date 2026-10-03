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

New clients default to ₱800/month for 25 Mbps and ₱1,000/month for 50 Mbps. An exact ₱800 rate selects 25 Mbps and an exact ₱1,000 rate selects 50 Mbps. Rates below ₱800 and all other rates remain Unspecified for manual plan assignment; rates are always editable for discounts. The default roster contains the 68 customers transcribed from the supplied list, with continuous client IDs and no invented customers for the two missing count numbers. Existing saved customer data is not replaced automatically.

To connect a customer to a NAP port, first add a NAP box with its port count under **NAP Boxes**, then use **Connect** beside that customer on the **Clients** page. The connection dialog lists available ports and prevents assigning a port already in use.

The included Compose setup publishes the app only on localhost; add TLS before making it reachable by other devices or the public internet.

The map works without a token using OpenStreetMap tiles. If `MAPBOX_ACCESS_TOKEN` is set on the app service to a Mapbox public token beginning with `pk.`, the app uses Mapbox instead. Mapbox tokens are delivered to the browser, so allow your deployed site's domain in the token settings; never use a secret `sk.` token in the browser app.

The OpenStreetMap fallback requires an internet connection to `tile.openstreetmap.org` and includes OpenStreetMap attribution. Its 3D toggle is available only when Mapbox is configured.