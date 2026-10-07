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
## Daily overdue-payment notifications

The Settings page can enable a daily web-push reminder separately on each PC or phone. Notifications arrive even when the dashboard is closed. Push requires a supported browser and HTTPS (localhost works for local setup). The reminder summarizes every client with an unpaid balance on invoices due today or earlier, split across notifications when needed, and runs at 8:00 AM in `Asia/Manila` by default.

Configure a VAPID key pair on the app server. Generate one with:

```powershell
npx web-push generate-vapid-keys
```

Set the generated `publicKey` as `VAPID_PUBLIC_KEY`, the `privateKey` as `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to a contact URI such as `mailto:admin@your-domain.example`. For Docker Compose, put these values in the ignored local `.env` file; for hosted deployments, set them as secret environment variables. Never publish the private key. `APP_TIMEZONE` controls the schedule timezone (default `Asia/Manila`), and `NOTIFICATION_CRON` can override the schedule (default `0 8 * * *`). Rebuild/restart the app after changing these settings, then sign in and choose **Settings → Enable on this device** on every computer where reminders are wanted.

The app stores push subscriptions in PostgreSQL, independently of exported app-data backups. Keep one running app instance for the daily scheduler; the included Compose setup does this. If the app is stopped at the scheduled time, that day's reminder is skipped. The push service subscription is removed automatically when a browser reports it has expired.

## Windows toast notifications

For reminders delivered by Windows itself, use the optional PowerShell scheduled task instead of browser push. Keep the NAPBOX app running and reachable from this PC; Windows Task Scheduler checks every six hours, starting at the configured **Windows local time** (6:00 AM by default: 6 AM, noon, 6 PM, and midnight). Each alert lists clients with any unpaid balance on invoices due today or earlier, including partial payments. The task runs in your Windows account, so you need to be signed in to see the toast. A check missed while the PC sleeps runs when it becomes available again.

Open PowerShell in the project folder and run:

```powershell
.\windows-overdue-toast.ps1 -Action Setup -BaseUrl http://localhost:3000 -Username telecomadmin -Time 06:00
```

Use your actual admin username if it differs from `telecomadmin`. The `-Time` value sets the start time for the six-hour cycle. Setup installs the BurntToast PowerShell module for your account if needed, prompts for the NAPBOX password, and protects it with Windows DPAPI for that Windows user. It registers a task that repeats every six hours and copies its script/configuration under `%LOCALAPPDATA%\NAPBOX\WindowsNotifications`. Run Setup again to update an existing task. Do not share the DPAPI-protected password file; it is intended to be usable only by your Windows account on this PC.

Send a sample toast without checking invoices. Clicking the test or payment reminder toast opens the configured NAPBOX website in your default browser:

```powershell
.\windows-overdue-toast.ps1 -Action Test
```

Check for actual overdue invoices immediately:

```powershell
.\windows-overdue-toast.ps1 -Action CheckNow
```

Logs are written under `%LOCALAPPDATA%\NAPBOX\WindowsNotifications\notifications.log`. Remove the scheduled task with `.\windows-overdue-toast.ps1 -Action Remove`. Windows toast notifications may display customer names and balances on the lock screen; adjust Windows notification privacy if needed.