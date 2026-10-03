const assert = require('node:assert/strict');
const express = require('express');
const { after, before, test } = require('node:test');
const { createAuth } = require('./auth');
const { createGoogleAuthenticator } = require('./google-auth');

const app = express();
const auth = createAuth({
  secret: 'test-session-secret-with-at-least-32-bytes',
  secureCookies: true
});
const googleAuth = createGoogleAuthenticator({
  clientId: 'test-client-id.apps.googleusercontent.com',
  adminEmail: 'owner@example.com',
  verifyIdToken: async credential => {
    if (credential !== 'valid-google-token') throw new Error('Invalid token');
    return {
      getPayload: () => ({
        sub: 'google-user-123',
        email: 'OWNER@example.com',
        email_verified: true
      })
    };
  }
});

app.use(express.json());
app.post('/api/login', auth.loginRateLimit, async (req, res) => {
  const { credential } = req.body || {};
  try {
    await googleAuth.verifyCredential(credential);
  } catch {
    auth.recordFailedLogin(req);
    return res.status(401).json({ error: 'Invalid or unauthorized Google account' });
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
    body: JSON.stringify({ credential: 'invalid-google-token' })
  });
  assert.equal(invalid.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: 'valid-google-token' })
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
      body: JSON.stringify({ credential: 'invalid-google-token' })
    });
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('accepts only a verified allowlisted Google email and verifies token audience', async () => {
  let observedAudience;
  const verifier = createGoogleAuthenticator({
    clientId: 'configured-client-id',
    adminEmail: 'owner@example.com',
    verifyIdToken: async (credential, audience) => {
      observedAudience = audience;
      return {
        getPayload: () => ({
          sub: 'google-user-123',
          email: credential === 'other-user' ? 'other@example.com' : 'owner@example.com',
          email_verified: credential !== 'unverified'
        })
      };
    }
  });

  assert.deepEqual(await verifier.verifyCredential('valid'), {
    subject: 'google-user-123',
    email: 'owner@example.com'
  });
  assert.equal(observedAudience, 'configured-client-id');
  await assert.rejects(verifier.verifyCredential('other-user'), /not authorized/);
  await assert.rejects(verifier.verifyCredential('unverified'), /not authorized/);
  await assert.rejects(verifier.verifyCredential(''), /required/);
});
