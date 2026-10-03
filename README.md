# NAPBOX ISP Manager

## Run with PostgreSQL

Install and start Docker Desktop, then run:

```powershell
if (!(Test-Path .env)) { Copy-Item backend/.env.example .env }
# Edit .env and set MAPBOX_ACCESS_TOKEN to your Mapbox public token (pk...)
docker compose up --build
```

Open http://localhost:3000. PostgreSQL data is kept in the `postgres_data` Docker volume. The app creates its table automatically from `backend/schema.sql` on startup.

To run without Docker, install Node.js 20 or newer and PostgreSQL, copy `backend/.env.example` to `.env`, and set `DATABASE_URL` to your PostgreSQL connection string. Then run `npm install` and `npm start`.

For a hosted container, provision or attach a PostgreSQL database and configure the app service's `DATABASE_URL` environment variable with that database's connection string. Also make sure the service listens on the platform-provided `PORT`; the server defaults to `3000` when it is not set. Docker images bind to `0.0.0.0` so hosted platforms can route traffic to the container, while running `npm start` directly binds to localhost unless `HOST` is set. The app exits at startup if `DATABASE_URL` is missing; it cannot create or infer a hosted database automatically.

The included Compose setup publishes the app only on localhost; add authentication and TLS before making it reachable by other devices or the public internet.

Use a Mapbox public token beginning with `pk.`. It is delivered to the browser for map rendering, so restrict it to your app's URL in your Mapbox account. Never use a secret `sk.` token in the browser app.