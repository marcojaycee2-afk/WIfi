const crypto = require('node:crypto');

const COOKIE_NAME = 'napbox_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function createAuth({ secret, secureCookies }) {
  const failedLogins = new Map();
  const revokedSessions = new Map();

  function sign(payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function readSession(req) {
    const [payload, signature, extra] = readCookie(req, COOKIE_NAME).split('.');
    if (!payload || !signature || extra !== undefined) return null;

    const expectedSignature = sign(payload);
    if (!safeEqual(signature, expectedSignature)) return null;

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof session.id !== 'string' ||
          !Number.isFinite(session.expiresAt) ||
          session.expiresAt <= Date.now() ||
          revokedSessions.has(session.id)) return null;
      return session;
    } catch {
      return null;
    }
  }

  function isAuthenticated(req) {
    return readSession(req) !== null;
  }

  function setSessionCookie(res, value, maxAge) {
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAge}`
    ];
    if (secureCookies) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect(303, '/login');
  }

  function loginRateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    if (failedLogins.size > 1000) {
      for (const [ip, attempts] of failedLogins) {
        if (attempts.expiresAt <= now) failedLogins.delete(ip);
      }
    }
    let attempts = failedLogins.get(key);
    if (!attempts || attempts.expiresAt <= now) {
      attempts = { count: 0, expiresAt: now + LOGIN_WINDOW_MS };
      failedLogins.set(key, attempts);
    }
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      res.setHeader('Retry-After', String(Math.ceil((attempts.expiresAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    }
    req.loginAttempts = attempts;
    return next();
  }

  return {
    isAuthenticated,
    requireAuth,
    loginRateLimit,
    recordFailedLogin(req) {
      req.loginAttempts.count += 1;
    },
    clearFailedLogins(req) {
      failedLogins.delete(req.ip || req.socket.remoteAddress || 'unknown');
    },
    issueSession(res) {
      if (revokedSessions.size > 1000) {
        const now = Date.now();
        for (const [id, expiresAt] of revokedSessions) {
          if (expiresAt <= now) revokedSessions.delete(id);
        }
      }
      const payload = Buffer.from(JSON.stringify({
        id: crypto.randomUUID(),
        expiresAt: Date.now() + SESSION_DURATION_MS
      })).toString('base64url');
      setSessionCookie(res, `${payload}.${sign(payload)}`, SESSION_DURATION_MS / 1000);
    },
    clearSession(req, res) {
      const session = readSession(req);
      if (session) revokedSessions.set(session.id, session.expiresAt);
      setSessionCookie(res, '', 0);
    }
  };
}

module.exports = { createAuth };
