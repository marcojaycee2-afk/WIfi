const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAuth } = require('./auth');

const app = express();
const auth = createAuth({
  username: 'admin',
  password: 'correct horse battery',
  secret: 'test-session-secret-with-at-least-32-bytes',
  secureCookies: true
});

app.use(express.json());
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
app.get('/api/private', auth.requireAuth, (req, res) => res.json({ private: true }));
app.get('/', auth.requireAuth, (req, res) => res.send('private page'));

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

test('protects routes, authenticates, and clears the session on logout', async () => {
  const blocked = await fetch(`${baseUrl}/api/private`);
  assert.equal(blocked.status, 401);
  const page = await fetch(baseUrl, { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/login');

  const invalid = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' })
  });
  assert.equal(invalid.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct horse battery' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const sessionCookie = cookie.split(';', 1)[0];

  const allowed = await fetch(`${baseUrl}/api/private`, {
    headers: { cookie: sessionCookie }
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { private: true });

  const [cookieName, cookieValue] = sessionCookie.split('=');
  const [payload, signature] = cookieValue.split('.');
  const tampered = await fetch(`${baseUrl}/api/private`, {
    headers: { cookie: `${cookieName}=${payload}.${signature}x` }
  });
  assert.equal(tampered.status, 401);

  const logout = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { cookie: sessionCookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  const afterLogout = await fetch(`${baseUrl}/api/private`, {
    headers: { cookie: sessionCookie }
  });
  assert.equal(afterLogout.status, 401);
});

test('rate limits repeated invalid logins', async () => {
  let response;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' })
    });
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
