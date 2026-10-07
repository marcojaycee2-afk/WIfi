require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const webpush = require('web-push');
const cron = require('node-cron');
const { createAuth } = require('./auth');
const { buildOverdueSummary, localDateInTimeZone } = require('./overdue');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const timeZone = process.env.APP_TIMEZONE || 'Asia/Manila';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);

if (pushEnabled) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    vapidPublicKey,
    vapidPrivateKey
  );
}

app.use(express.json({ limit: '10mb' }));

const auth = createAuth({
  username: process.env.ADMIN_USERNAME || 'telecomadmin',
  password: process.env.ADMIN_PASSWORD,
  secret: process.env.SESSION_SECRET,
  secureCookies: process.env.NODE_ENV === 'production'
});

app.post('/api/login', auth.loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.credentialsMatch(username, password)) {
    auth.recordFailedLogin(req);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  auth.clearFailedLogins(req);
  auth.issueSession(res);
  return res.json({ authenticated: true });
});

app.post('/api/logout', auth.requireAuth, (req, res) => {
  auth.clearSession(req, res);
  res.json({ loggedOut: true });
});

app.get(['/login', '/login.html'], (req, res) => {
  if (auth.isAuthenticated(req)) return res.redirect(303, '/');
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(__dirname, '..', 'login.html'));
});

app.get('/', auth.requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.get('/index.html', auth.requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.get('/api/config', auth.requireAuth, (req, res) => {
  const token = process.env.MAPBOX_ACCESS_TOKEN || '';
  res.json({ mapboxAccessToken: token.startsWith('pk.') ? token : '' });
});

app.get('/api/notifications/config', auth.requireAuth, (req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : '' });
});

app.post('/api/notifications/subscribe', auth.requireAuth, async (req, res, next) => {
  const subscription = req.body;
  if (!pushEnabled) return res.status(503).json({ error: 'Push notifications are not configured on the server' });
  if (!isValidSubscription(subscription)) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, subscription, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (endpoint) DO UPDATE
       SET subscription = EXCLUDED.subscription, updated_at = now()`,
      [subscription.endpoint, JSON.stringify(subscription)]
    );
    res.json({ subscribed: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/notifications/subscribe', auth.requireAuth, async (req, res, next) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    return res.status(400).json({ error: 'Invalid push subscription endpoint' });
  }
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.json({ unsubscribed: true });
  } catch (error) {
    next(error);
  }
});

app.get('/service-worker.js', auth.requireAuth, (req, res) => {
  res.set({
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/',
    'Content-Type': 'application/javascript; charset=utf-8'
  });
  res.sendFile(path.join(__dirname, '..', 'service-worker.js'));
});

app.get('/api/state', auth.requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
    res.json({ state: result.rows[0]?.data ?? null });
  } catch (error) {
    next(error);
  }
});

app.put('/api/state', auth.requireAuth, async (req, res, next) => {
  const { state } = req.body || {};
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !Array.isArray(state.clients) || !state.settings || typeof state.settings !== 'object') {
    return res.status(400).json({ error: 'Invalid application state' });
  }

  try {
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(state)]
    );
    res.json({ saved: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

async function start(){
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is missing; set it in the app service environment');
  if (process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error(`ADMIN_PASSWORD is too short (${process.env.ADMIN_PASSWORD.length} characters; minimum is 12)`);
  }
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes');
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  if (pushEnabled) {
    cron.schedule(process.env.NOTIFICATION_CRON || '0 8 * * *', () => {
      sendDailyOverdueNotifications().catch(error => console.error('Daily overdue notification job failed:', error));
    }, { timezone: timeZone });
    console.log(`Daily overdue notifications scheduled for ${process.env.NOTIFICATION_CRON || '0 8 * * *'} (${timeZone})`);
  } else {
    console.warn('Web push notifications are disabled; configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable them');
  }
  app.listen(port, host, () => console.log(`NAPBOX running at http://${host}:${port}`));
}

let notificationJobRunning = false;
async function sendDailyOverdueNotifications(){
  if (notificationJobRunning || !pushEnabled) return;
  notificationJobRunning = true;
  try {
    const today = localDateInTimeZone(new Date(), timeZone);
    const stateResult = await pool.query('SELECT data FROM app_state WHERE id = 1');
    const report = buildOverdueSummary(stateResult.rows[0]?.data, today);
    if (!report) return;

    const subscriptions = await pool.query(
      'SELECT endpoint, subscription FROM push_subscriptions WHERE last_notified_on IS DISTINCT FROM $1::date',
      [today]
    );
    for (const row of subscriptions.rows) {
      let delivered = true;
      try {
        const payload = JSON.stringify({
          ...report.notification,
          url: '/#unpaid-reminders',
          tag: `late-payments-${today}`
        });
        await webpush.sendNotification(row.subscription, payload);
      } catch (error) {
        delivered = false;
        if (error.statusCode === 404 || error.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]);
        } else {
          console.error('Could not send overdue notification:', error.message);
        }
      }
      if (delivered) {
        await pool.query('UPDATE push_subscriptions SET last_notified_on = $1::date, updated_at = now() WHERE endpoint = $2', [today, row.endpoint]);
      }
    }
  } finally {
    notificationJobRunning = false;
  }
}

function isValidSubscription(subscription){
  return Boolean(
    subscription && typeof subscription === 'object' &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.length <= 2048 &&
    subscription.endpoint.startsWith('https://') &&
    subscription.keys && typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string'
  );
}

start().catch(error => {
  console.error('Could not start NAPBOX:', error.message);
  process.exit(1);
});