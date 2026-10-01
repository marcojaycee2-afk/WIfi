# NAPBOX ISP Manager

## Run with PostgreSQL

Install and start Docker Desktop, then run:

```powershell
if (!(Test-Path .env)) { Copy-Item backend/.env.example .env }
# Edit .env and set MAPBOX_ACCESS_TOKEN to your Mapbox public token (pk...)
docker compose up --build
```

Open http://localhost:3000. PostgreSQL data is kept in the `postgres_data` Docker volume. The app creates its table automatically from `backend/schema.sql` on startup.

To run without Docker, install Node.js 20 or newer and PostgreSQL, set `DATABASE_URL` (and optionally `PORT`) in the environment, then run `npm install` and `npm start`.

The server listens on localhost by default. The included Compose setup also publishes the app only on localhost; add authentication and TLS before making it reachable by other devices or the public internet.

Use a Mapbox public token beginning with `pk.`. It is delivered to the browser for map rendering, so restrict it to your app's URL in your Mapbox account. Never use a secret `sk.` token in the browser app.