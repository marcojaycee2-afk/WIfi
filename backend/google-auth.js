const { OAuth2Client } = require('google-auth-library');

function createGoogleAuthenticator({ clientId, adminEmail, verifyIdToken }) {
  const client = new OAuth2Client(clientId);
  const allowedEmail = adminEmail.trim().toLowerCase();

  return {
    async verifyCredential(credential) {
      if (typeof credential !== 'string' || credential.length === 0) {
        throw new Error('Google credential is required');
      }

      const ticket = verifyIdToken
        ? await verifyIdToken(credential, clientId)
        : await client.verifyIdToken({ idToken: credential, audience: clientId });
      const payload = ticket.getPayload();

      if (!payload || !payload.sub || payload.email_verified !== true ||
          typeof payload.email !== 'string' ||
          payload.email.trim().toLowerCase() !== allowedEmail) {
        throw new Error('Google account is not authorized');
      }

      return { subject: payload.sub, email: allowedEmail };
    }
  };
}

module.exports = { createGoogleAuthenticator };
