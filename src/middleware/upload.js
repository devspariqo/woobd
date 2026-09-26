/**
 * File upload middleware.
 *
 * `uploadGuarded()` is the only upload entry point routes should use. It runs
 * multer, then validates the CSRF token against the now-parsed multipart body.
 *
 * Why the two steps are fused: the global CSRF middleware runs before routing
 * and cannot see a multipart body (express's urlencoded/json parsers skip that
 * content type, and multer has not run yet). It therefore defers multipart
 * requests to this module. If a route mounted raw multer instead, the request
 * would never be CSRF-checked at all - so the check is bundled with the parser
 * rather than left to each route to remember.
 */
'use strict';

const multer = require('multer');
const fs = require('fs');

const { upload, uploadAny, FOLDER_RULES } = require('../lib/storage');
const csrf = require('./csrf');
const logger = require('../utils/logger');

/**
 * Delete files multer already wrote for a request we are about to reject.
 *
 * multer runs before the CSRF check, so by the time a request is refused the
 * bytes are already on disk. Without this, every rejected upload leaves an
 * orphan that no media row points at - a rejected request could fill the disk.
 *
 * Uses `req.__uploadPaths`, recorded by the storage engine as each file is
 * written, rather than `req.files`. multer only populates `req.files` once a
 * field completes, so a file that trips the size limit mid-write is on disk but
 * absent from `req.files` - which is exactly the case that leaked.
 *
 * Returns a promise so the caller can wait before responding.
 */
async function discardUploads(req) {
  const paths = new Set(req.__uploadPaths || []);

  for (const file of req.files || []) {
    if (file && file.path) paths.add(file.path);
  }
  if (req.file && req.file.path) paths.add(req.file.path);

  await Promise.all(
    [...paths].map((p) =>
      fs.promises.unlink(p).catch((err) => {
        if (err.code !== 'ENOENT') logger.warn('Could not remove a rejected upload', { path: p });
      })
    )
  );
}

/**
 * Turn a multer error into something an operator can act on.
 *
 * Without this, an oversized file or a wrong type surfaces as an unhandled
 * MulterError and a 500 with no explanation.
 */
function friendlyUploadError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return Object.assign(new Error('That file is too large. Please upload a smaller image.'), { status: 413 });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return Object.assign(new Error('Too many files in one upload.'), { status: 413 });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return Object.assign(new Error('Unexpected file field in the upload.'), { status: 400 });
    }
    return Object.assign(new Error(`Upload failed: ${err.message}`), { status: 400 });
  }

  // storage.js's fileFilter throws a plain Error for a rejected mime type.
  if (err && /Unsupported file type/i.test(err.message)) {
    return Object.assign(
      new Error('That file type is not allowed. Use JPG, PNG, WebP, GIF, AVIF or SVG.'),
      { status: 415 }
    );
  }

  return err;
}

/**
 * Multer for a logical folder, with CSRF validation afterwards.
 *
 * @param {string} folder key of storage.FOLDER_RULES
 * @param {string} field  form field name carrying the file(s)
 */
function uploadGuarded(folder = 'media', field = 'upload') {
  const handler = upload(folder, field);

  return (req, res, next) => {
    handler(req, res, async (err) => {
      if (err) {
        await discardUploads(req);
        const friendly = friendlyUploadError(err);
        // Surface the reason on the page the operator came from rather than a
        // bare 500, which gives them nothing to act on.
        if (req.session && friendly.status && friendly.status < 500) {
          req.session.flashError = friendly.message;
          return res.redirect(req.get('referer') || res.locals.helpers.url('/'));
        }
        return next(friendly);
      }

      if (!csrf.verify(req)) {
        // The bytes are already on disk; remove them before refusing.
        await discardUploads(req);
        return csrf.reject(req, res);
      }

      next();
    });
  };
}

/**
 * Multer accepting any field name, with CSRF validation afterwards.
 *
 * Used by the settings screen, where one form posts several independent image
 * fields (light logo, dark logo, footer logo, favicon) and each file has to be
 * matched back to its setting by `file.fieldname`.
 */
function uploadGuardedAny(folder = 'media') {
  const handler = uploadAny(folder);

  return (req, res, next) => {
    handler(req, res, async (err) => {
      if (err) {
        await discardUploads(req);
        const friendly = friendlyUploadError(err);
        if (req.session && friendly.status && friendly.status < 500) {
          req.session.flashError = friendly.message;
          return res.redirect(req.get('referer') || res.locals.helpers.url('/'));
        }
        return next(friendly);
      }

      if (!csrf.verify(req)) {
        // The bytes are already on disk; remove them before refusing.
        await discardUploads(req);
        return csrf.reject(req, res);
      }

      next();
    });
  };
}

/** The allowed types and size cap for a folder, for display in a form hint. */
function uploadLimits(folder) {
  const rules = FOLDER_RULES[folder] || FOLDER_RULES.media;
  return { maxMb: rules.maxMb, types: rules.types };
}

module.exports = { uploadGuarded, uploadGuardedAny, uploadLimits };
