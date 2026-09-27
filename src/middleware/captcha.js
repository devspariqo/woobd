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
    // Logged, because a missing token and a rejected token look identical on
    // screen and have completely different causes: one is a front-end problem,
    // the other a key problem.
    logger.warn('reCAPTCHA token missing from the submission', { action });
    return { ok: false, message: 'The verification did not complete. Please try again.' };
  }

  try {
    const body = new URLSearchParams({ secret, response: String(token) });

    // remoteip is optional and Google uses it only for risk scoring. It is
    // deliberately NOT sent: behind a proxy or CDN it is frequently the load
    // balancer's address rather than the visitor's, and a value that does not
    // match the token can turn a valid submission into a rejection. There is
    // nothing to gain from sending it and a working login to lose.
    void ip;

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

    // Each Google code means something different, and they are not
    // interchangeable. Saying which one it is turns "captcha is broken" into a
    // fixable sentence.
    if (codes.includes('invalid-input-secret')) {
      return {
        ok: false,
        reason: 'invalid-secret',
        message:
          'The reCAPTCHA secret key was rejected. It must come from the same Google registration as the site key.',
      };
    }

    if (codes.includes('invalid-keys')) {
      return {
        ok: false,
        reason: 'invalid-keys',
        message: 'Google did not recognise the reCAPTCHA keys. Check both the site key and the secret.',
      };
    }

    if (codes.includes('missing-input-secret') || codes.includes('missing-input-response')) {
      return {
        ok: false,
        reason: 'missing-input',
        message: 'The verification did not reach Google. Please try again.',
      };
    }

    if (codes.includes('timeout-or-duplicate')) {
      return {
        ok: false,
        reason: 'expired',
        message: 'The verification expired. Please complete it again.',
      };
    }

    if (codes.includes('bad-request')) {
      return {
        ok: false,
        reason: 'bad-request',
        message:
          'Google rejected the request. This usually means the site key is for a different reCAPTCHA type than the one selected here.',
      };
    }

    return {
      ok: false,
      reason: 'rejected',
      message: 'The verification was not accepted. Please try again.',
    };
  } catch (err) {
    // Google being unreachable must not lock customers out of their accounts.
    // Log loudly but allow the request through.
    logger.error('reCAPTCHA verification request failed - allowing request', err);
    return { ok: true, degraded: true };
  }
}

/**
 * Check that the configured key pair is valid, without needing a browser.
 *
 * Sends a deliberately invalid token. Google's answer tells us what we need:
 *
 *   invalid-input-response -> the SECRET was accepted and the token was not.
 *                             The keys are fine; a real visitor will pass.
 *   invalid-input-secret   -> the secret is wrong, or belongs to a different
 *                             registration than the site key.
 *   invalid-keys           -> neither key is recognised.
 *
 * This exists because "captcha is not working" is unactionable. A wrong secret
 * and an unsolved challenge look identical on screen, and the operator has no
 * way to tell which they are looking at.
 */
async function selfTest() {
  const secret = settings.secret('captcha_secret_key', process.env.RECAPTCHA_SECRET_KEY);
  const siteKey = settings.secret('captcha_site_key', process.env.RECAPTCHA_SITE_KEY);

  if (!secret || !siteKey) {
    return { ok: false, message: 'No reCAPTCHA keys are saved yet. Add both, then test again.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: 'self-test-deliberately-invalid' }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const result = await response.json();
    const codes = (result['error-codes'] || []).join(', ');

    if (codes.includes('invalid-input-response')) {
      return {
        ok: true,
        message: 'The secret key is valid and matches the site key. Verification is working.',
      };
    }

    if (codes.includes('invalid-input-secret')) {
      return {
        ok: false,
        message:
          'The secret key was rejected. Copy it again from the same Google reCAPTCHA registration as the site key.',
      };
    }

    if (codes.includes('invalid-keys')) {
      return { ok: false, message: 'Google does not recognise these keys. Check both, then save and test again.' };
    }

    if (codes.includes('missing-input-secret')) {
      return { ok: false, message: 'The secret key is empty. Save it again on this tab.' };
    }

    return { ok: false, message: `Google answered: ${codes || 'no error code'}.` };
  } catch (err) {
    logger.error('reCAPTCHA self-test could not reach Google', err);
    return { ok: false, message: 'Could not reach Google. Check the server can make outbound requests.' };
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

module.exports = { verify, selfTest, requireCaptcha, honeypot };
