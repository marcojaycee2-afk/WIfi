require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/api/config', (req, res) => {
  const token = process.env.MAPBOX_ACCESS_TOKEN || '';
  res.json({ mapboxAccessToken: token.startsWith('pk.') ? token : '' });
});

app.get('/api/state', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
    res.json({ state: result.rows[0]?.data ?? null });
  } catch (error) {
    next(error);
  }
});

app.put('/api/state', async (req, res, next) => {
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
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  app.listen(port, host, () => console.log(`NAPBOX running at http://${host}:${port}`));
}

start().catch(error => {
  console.error('Could not start NAPBOX:', error.message);
  process.exit(1);
});