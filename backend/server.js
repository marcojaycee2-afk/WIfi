require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuth } = require('./auth');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

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
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes');
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  app.listen(port, host, () => console.log(`NAPBOX running at http://${host}:${port}`));
}

start().catch(error => {
  console.error('Could not start NAPBOX:', error.message);
  process.exit(1);
});