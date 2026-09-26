/**
 * Cross-cutting request middleware: maintenance mode, security headers,
 * canonical-host redirects, rate limiters and 404/error handlers.
 */
'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const settings = require('../services/settings.service');
const helpers = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Maintenance mode. Staff always get through (otherwise you could lock yourself
 * out), as do the assets needed to render the maintenance page itself.
 */
function maintenanceMode() {
  const ALWAYS_ALLOWED = [
    '/assets',
    '/uploads',
    '/health',
    '/api/health',
    '/maintenance',
    '/favicon',
  ];

  return (req, res, next) => {
    if (!settings.getBool('maintenance_mode')) return next();

    // Admins and staff can always preview the real site.
    if (req.session && req.session.staff) return next();
    if (ALWAYS_ALLOWED.some((prefix) => req.path.startsWith(prefix))) return next();

    if (req.path.startsWith('/api/') || req.xhr) {
      return res.status(503).json({ ok: false, message: 'The site is under maintenance.' });
    }

    return res.status(503).render('errors/maintenance', {
      title: settings.get('maintenance_title'),
      layout: false,
      message: settings.get('maintenance_message'),
    });
  };
}

/** Security headers. Kept explicit rather than helmet's defaults so the CSP can
 *  allow the inline theme bootstrap that avoids a flash of wrong theme. */
function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0'); // superseded by CSP; explicitly off
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    if (config.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Everything is self-hosted - no CDN - so the policy is tight. Google
    // reCAPTCHA and the OAuth endpoints are the only external origins.
    const scriptSources = [
      "'self'",
      "'unsafe-inline'",
      'https://www.google.com',
      'https://www.gstatic.com',
      'https://accounts.google.com',
    ];
    const frameSources = ['https://www.google.com', 'https://accounts.google.com'];

    if (!config.isProd) {
      // Source maps and hot reload in development.
      scriptSources.push('http://localhost:*');
    }

    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src ${scriptSources.join(' ')}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://www.google.com",
        `frame-src ${frameSources.join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );

    next();
  };
}

/** Send www -> apex (or the reverse) so canonical URLs never duplicate. */
function canonicalHost() {
  return (req, res, next) => {
    if (!config.isProd) return next();
    const host = (req.get('host') || '').toLowerCase();
    const bare = host.replace(/^www\./, '');
    if (host.startsWith('www.')) {
      return res.redirect(301, `${config.app.url}${req.originalUrl}`);
    }
    // Force HTTPS behind the proxy - req.secure respects trust proxy.
    if (settings.getBool('force_https') && !req.secure && config.isProd) {
      return res.redirect(301, `https://${bare}${req.originalUrl}`);
    }
    next();
  };
}

/** Keep deep-link `next=` parameters on-site so they cannot be used to phish. */
function safeRedirect(target, fallback = '/') {
  if (!target) return helpers.url(fallback);
  if (/^https?:\/\//i.test(target) || target.startsWith('//')) return helpers.url(fallback);
  if (!target.startsWith('/')) return helpers.url(fallback);
  // Never bounce back into the auth or admin login pages.
  if (/\/(signin|signup|login)(\?|$)/.test(target)) return helpers.url(fallback);
  return helpers.url(target);
}

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const jsonHandler = (message) => (req, res) => {
  res.status(429).json({ ok: false, message });
};

/** Auth endpoints: generous enough for typos, tight enough to stop stuffing. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many attempts. Please wait 15 minutes and try again.'),
  skip: () => !config.isProd,
});

/** Public forms: a real person will not submit these 5 times in 10 minutes. */
const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('You have submitted this form too many times. Please try again later.'),
  skip: () => !config.isProd,
});

/** Live chat: costs an API call per message, so capped per visitor. */
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: () => settings.getInt('chat_rate_limit', 20) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.sessionID || req.ip,
  handler: jsonHandler('You have reached the message limit for now. Please contact us on WhatsApp for urgent help.'),
});

function notFound() {
  return (req, res) => {
    // Send JSON for API clients, the HTML 404 page for browsers.
    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
      return res.status(404).json({ ok: false, message: 'Not found.' });
    }
    return res.status(404).render('errors/404', {
      title: 'Page not found',
      layout: 'layouts/public',
      requestedPath: req.originalUrl,
    });
  };
}

function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.status || err.statusCode || 500;

    if (status >= 500) {
      // The raw SQL error for a missing table says nothing about the fix. Name
      // it, because "every page 500s" with no other symptom is almost always a
      // database that was never installed.
      const missingTable = /Table '[\w.]+' doesn't exist|ER_NO_SUCH_TABLE/i.test(err.message || '');
      const noConnection = /ECONNREFUSED|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Access denied/i.test(
        err.code || err.message || ''
      );

      if (missingTable) {
        logger.error(
          `${req.method} ${req.originalUrl} -> 500: the database schema is missing. Run "npm run setup" against this database.`,
          err
        );
      } else if (noConnection) {
        logger.error(
          `${req.method} ${req.originalUrl} -> 500: the database is unreachable. ` +
            'Check DB_HOST (must be 127.0.0.1 on Hostinger, not localhost), DB_NAME, DB_USER and DB_PASSWORD.',
          err
        );
      } else {
        logger.error(`${req.method} ${req.originalUrl} -> ${status}`, err);
      }
    } else {
      logger.warn(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
    }

    if (res.headersSent) return;

    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
      return res.status(status).json({
        ok: false,
        message: status >= 500 ? 'Something went wrong on our side.' : err.message,
      });
    }

    const template = status === 403 ? 'errors/403' : status === 404 ? 'errors/404' : 'errors/500';

    // Pass every local the templates read. `currentUrl` comes from the context
    // middleware, which does not run when the database is unreachable - so
    // without this the 500 page throws and the visitor sees a bare
    // "Internal Server Error" instead of the styled page.
    const locals = {
      title: status === 403 ? 'Access denied' : status === 404 ? 'Page not found' : 'Something went wrong',
      layout: req.path.startsWith(`/${settings.get('admin_path_slug', 'dev-cp')}`)
        ? 'layouts/admin'
        : 'layouts/public',
      message: err.message,
      requestedPath: req.originalUrl,
      currentUrl: req.originalUrl,
      // Only leak a stack trace when it can help the developer.
      stack: config.isDev ? err.stack : null,
    };

    // An error page that throws loses the original error as well. If the render
    // fails for any reason, fall back to a minimal response rather than letting
    // Express's built-in handler emit a bare, uninformative 500.
    try {
      return res.status(status).render(template, locals);
    } catch (renderErr) {
      logger.error('The error page itself failed to render', renderErr);

      if (res.headersSent) return undefined;

      return res
        .status(status)
        .type('text/plain')
        .send(
          status >= 500
            ? 'Internal Server Error\n\nThe error page could not be rendered. Check the application log.'
            : `${status}`
        );
    }
  };
}

module.exports = {
  maintenanceMode,
  securityHeaders,
  canonicalHost,
  safeRedirect,
  authLimiter,
  formLimiter,
  chatLimiter,
  notFound,
  errorHandler,
};
