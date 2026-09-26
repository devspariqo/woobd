/**
 * Google reCAPTCHA v2 verification plus the simpler in-app defences
 * (rate limiting, honeypot fields).
 *
 * Verification is skipped when keys are absent, so local development and a
 * misconfigured deploy degrade to "no captcha" rather than "no signups".
 */
'use strict';

const settings = require('../services/settings.service');
const logger = require('../utils/logger');

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Verify a submitted captcha token.
 *
 * @param {string} token   from `g-recaptcha-response`
 * @param {string} ip      remote address, passed to Google for risk scoring
 * @param {string} action  'login' | 'signup' | 'admin' | 'contact' - picks the
 *                         on/off setting for this specific form
 */
async function verify(token, ip, action) {
  const toggleKey = {
    login: 'captcha_on_login',
    signup: 'captcha_on_signup',
    admin: 'captcha_on_admin',
    contact: 'captcha_on_contact',
  }[action];

  // Feature off for this form? Nothing to check.
  if (toggleKey && !settings.getBool(toggleKey, true)) return { ok: true, skipped: true };

  const secret = settings.secret('captcha_secret_key', process.env.RECAPTCHA_SECRET_KEY);
  const siteKey = settings.secret('captcha_site_key', process.env.RECAPTCHA_SITE_KEY);

  // Not configured at all - do not block the user.
  if (!secret || !siteKey) return { ok: true, skipped: true };

  if (!token) {
    return { ok: false, message: 'Please complete the CAPTCHA verification.' };
  }

  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    if (ip) body.append('remoteip', ip);

    // Node 18+ has global fetch; no dependency needed.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const result = await response.json();

    if (result.success) return { ok: true };

    const codes = (result['error-codes'] || []).join(', ');
    logger.warn('reCAPTCHA rejected a submission', { action, codes });

    if (codes.includes('timeout-or-duplicate')) {
      return { ok: false, message: 'The CAPTCHA expired. Please tick the box again.' };
    }
    return { ok: false, message: 'CAPTCHA verification failed. Please try again.' };
  } catch (err) {
    // Google being unreachable must not lock customers out of their accounts.
    // Log loudly but allow the request through.
    logger.error('reCAPTCHA verification request failed - allowing request', err);
    return { ok: true, degraded: true };
  }
}

/**
 * Express middleware for JSON/API routes that want captcha on the body.
 * For classic form posts the controller calls `verify()` directly so it can
 * re-render the form with the user's input intact.
 */
function requireCaptcha(action) {
  return async (req, res, next) => {
    const token = req.body && (req.body['g-recaptcha-response'] || req.body.captchaToken);
    const result = await verify(token, req.ip, action);
    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.message });
    }
    next();
  };
}

/**
 * Honeypot check. A field hidden with CSS that a human never fills; bots do.
 * Cheap, invisible, and catches the majority of naive spam.
 */
function honeypot(fieldName = 'website') {
  return (req, res, next) => {
    if (req.body && req.body[fieldName]) {
      logger.warn('Honeypot triggered', { ip: req.ip, path: req.path });
      // Return the success shape so the bot does not learn it was caught.
      if (req.xhr) return res.json({ ok: true });
      return res.redirect(req.get('referer') || '/');
    }
    next();
  };
}

module.exports = { verify, requireCaptcha, honeypot };
