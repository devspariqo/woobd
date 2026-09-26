/**
 * CSRF protection for form posts.
 *
 * The token is exposed to templates as `csrfToken` and submitted as a hidden
 * `_csrf` field. The Google OAuth callback is exempted because it is a
 * cross-site GET initiated by Google and validated by the OAuth `state`
 * parameter instead.
 *
 * ## Why multipart requests are validated elsewhere
 *
 * This middleware runs globally, before routing. By that point
 * `express.urlencoded` and `express.json` have parsed the body - but they skip
 * `multipart/form-data`, and multipart bodies are only parsed later, by multer,
 * inside the route.
 *
 * So on a file upload `req.body` is empty here and `req.body._csrf` is
 * `undefined`, which would reject every upload with a 419. Multipart requests
 * are therefore deferred: `middleware/upload.js` runs multer first and then
 * calls `verify()` on the parsed body.
 *
 * The important consequence: **any route that accepts a file must use
 * `uploadGuarded()` rather than raw multer**, or it loses CSRF protection
 * entirely. `scripts/smoke.js` asserts that an upload without a token is
 * rejected, so a route that forgets is caught.
 */
'use strict';

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when the body is multipart and therefore not parsed yet. */
function isMultipart(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
}

/** Issue (or reuse) this session's token and expose it to templates. */
function issueToken(req, res) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  return req.session.csrfToken;
}

/**
 * Compare the submitted token against the session's, in constant time.
 *
 * The length check comes first because `crypto.timingSafeEqual` throws when the
 * buffers differ in length - which would turn a bad token into a 500.
 */
function verify(req) {
  if (!req.session || !req.session.csrfToken) return false;

  const submitted =
    (req.body && (req.body._csrf || req.body.csrfToken)) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  const a = Buffer.from(String(submitted || ''), 'utf8');
  const b = Buffer.from(String(req.session.csrfToken), 'utf8');

  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** Reject a request whose token did not match. */
function reject(req, res) {
  const wantsJson =
    req.xhr ||
    req.path.startsWith('/api/') ||
    String(req.get('accept') || '').includes('application/json');

  if (wantsJson) {
    return res.status(419).json({
      ok: false,
      message: 'Your session expired. Please refresh the page and try again.',
    });
  }

  // The admin panel gets its own shell, so an operator whose session lapses
  // mid-edit is not dropped into the public site chrome.
  //
  // `pageTitle` must be passed: layouts/admin-auth renders it, and omitting it
  // turns the 419 into a 500 - the error page failing is worse than the error.
  const adminSlug = `/${require('../services/settings.service').get('admin_path_slug', 'dev-cp')}`;
  const isAdmin = req.path.startsWith(adminSlug);

  return res.status(419).render('errors/419', {
    title: 'Session expired',
    pageTitle: 'Session expired',
    isAdmin,
    adminPath: adminSlug.slice(1),
    layout: isAdmin ? 'layouts/admin-auth' : 'layouts/public',
  });
}

function csrf() {
  return (req, res, next) => {
    if (!req.session) return next();

    issueToken(req, res);

    if (SAFE_METHODS.has(req.method)) return next();

    // The OAuth callback cannot carry our token - it is verified via `state`.
    if (req.path.startsWith('/auth/google')) return next();

    // Multipart bodies are not parsed yet. middleware/upload.js validates the
    // token after multer has read the fields.
    if (isMultipart(req)) return next();

    if (!verify(req)) return reject(req, res);

    next();
  };
}

csrf.verify = verify;
csrf.reject = reject;
csrf.isMultipart = isMultipart;
csrf.issueToken = issueToken;

module.exports = csrf;
