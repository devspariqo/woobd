/**
 * Google Sign-In (OAuth 2.0 / OpenID Connect).
 *
 * Implemented against the raw endpoints rather than an SDK: the flow is three
 * HTTP calls, and this avoids passing client secrets through a library that
 * would also pull in a session dependency we already have.
 *
 * Flow:
 *   1. buildAuthUrl()  -> redirect the browser to Google with a signed `state`
 *   2. Google returns   -> /auth/google/callback?code=...&state=...
 *   3. exchangeCode()  -> swap the code for tokens, read the ID token claims
 */
'use strict';

const crypto = require('crypto');

const config = require('../config');
const settings = require('../services/settings.service');
const helpers = require('../utils/helpers');
const logger = require('../utils/logger');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

function credentials() {
  return {
    clientId: settings.secret('google_client_id', config.google.clientId),
    clientSecret: settings.secret('google_client_secret', config.google.clientSecret),
  };
}

function isEnabled() {
  const { clientId, clientSecret } = credentials();
  return settings.getBool('google_auth_enabled', true) && Boolean(clientId && clientSecret);
}

/** Must exactly match an "Authorised redirect URI" in the Google Cloud console. */
function redirectUri() {
  return `${config.app.url}${helpers.url('/auth/google/callback')}`;
}

/**
 * Build the consent-screen URL.
 * The `state` value is stored in the session and compared on return, which is
 * what protects the callback from CSRF (it cannot carry our form token).
 */
function buildAuthUrl(req, { next = '/account' } = {}) {
  const { clientId } = credentials();
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleState = state;
  req.session.googleNext = next;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    // Always show the account chooser so a shared device does not silently
    // sign the next person into the previous person's account.
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange the authorisation code for an access token. */
async function exchangeCode(code) {
  const { clientId, clientSecret } = credentials();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error_description || payload.error || 'Token exchange failed');
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the profile.
 *
 * Primary source is the ID token (no extra round trip), decoded locally since
 * it arrived over TLS directly from Google's token endpoint in response to our
 * own request. If the ID token is absent we fall back to the userinfo endpoint
 * with the access token - the safer of the two, and the reason the fallback
 * exists rather than trusting a token we cannot verify here.
 */
async function fetchProfile(tokens) {
  if (tokens.id_token) {
    try {
      const segment = tokens.id_token.split('.')[1];
      const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (claims && claims.sub) {
        return {
          sub: claims.sub,
          email: claims.email,
          emailVerified: Boolean(claims.email_verified),
          name: claims.name || (claims.email ? claims.email.split('@')[0] : 'Customer'),
          picture: claims.picture || null,
        };
      }
    } catch (err) {
      logger.warn('Could not decode ID token, falling back to userinfo endpoint', err);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || !payload.sub) {
      throw new Error(payload.error_description || 'Could not read the Google profile');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name || (payload.email ? payload.email.split('@')[0] : 'Customer'),
      picture: payload.picture || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the `state` parameter returned by Google against the one we stored.
 * Constant-time so the comparison itself leaks nothing.
 */
function verifyState(req, returnedState) {
  const expected = req.session && req.session.googleState;
  delete req.session.googleState;

  if (!expected || !returnedState) return false;
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(returnedState), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Download the Google avatar so the profile picture keeps working if the
 *  Google URL rotates. Best-effort - failure just leaves the avatar unset. */
async function downloadAvatar(url, destinationDir) {
  const fs = require('fs');
  const path = require('path');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) return null;

    const fileName = `google-${crypto.randomBytes(6).toString('hex')}.jpg`;
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.writeFileSync(path.join(destinationDir, fileName), buffer);
    return fileName;
  } catch {
    return null;
  }
}

module.exports = {
  isEnabled,
  buildAuthUrl,
  exchangeCode,
  fetchProfile,
  verifyState,
  redirectUri,
  downloadAvatar,
};
