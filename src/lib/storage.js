/**
 * Persistence helpers: the MySQL-backed session store and the upload handler.
 *
 * Both solve the same underlying problem - Hostinger Web Apps runs each deploy
 * from a fresh versioned directory, so anything written to the local disk at
 * runtime is lost on the next push.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');
const db = require('../config/database');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

/**
 * A minimal MySQL session store.
 *
 * Express's default MemoryStore drops every session on restart or redeploy, so
 * customers get logged out every time you push. This persists them in the same
 * database the app already uses - no Redis to provision.
 */
class MySQLSessionStore extends require('express-session').Store {
  constructor(options = {}) {
    super(options);
    this.table = options.table || 'sessions';
    this.cleanupInterval = setInterval(() => this.reap(), 15 * 60 * 1000);
    // Do not hold the Node process open just for the reaper.
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  get(sid, callback) {
    db.queryOne(`SELECT data, expires FROM \`${this.table}\` WHERE session_id = ? LIMIT 1`, [sid])
      .then((row) => {
        if (!row) return callback(null, null);
        // Expired rows are treated as a miss even if the reaper has not run.
        if (row.expires && Number(row.expires) * 1000 < Date.now()) {
          return this.destroy(sid, () => callback(null, null));
        }
        try {
          return callback(null, JSON.parse(row.data));
        } catch {
          return callback(null, null);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, session, callback) {
    const maxAge = session.cookie && session.cookie.maxAge ? session.cookie.maxAge : config.session.maxAge;
    const expires = Math.floor((Date.now() + maxAge) / 1000);
    let payload;
    try {
      payload = JSON.stringify(session);
    } catch (err) {
      return callback(err);
    }
    db.query(
      `INSERT INTO \`${this.table}\` (session_id, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sid, expires, payload]
    )
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback) {
    db.query(`DELETE FROM \`${this.table}\` WHERE session_id = ?`, [sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, session, callback) {
    const maxAge = session.cookie && session.cookie.maxAge ? session.cookie.maxAge : config.session.maxAge;
    const expires = Math.floor((Date.now() + maxAge) / 1000);
    db.query(`UPDATE \`${this.table}\` SET expires = ? WHERE session_id = ?`, [expires, sid])
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  length(callback) {
    db.queryOne(`SELECT COUNT(*) AS total FROM \`${this.table}\` WHERE expires > ?`, [
      Math.floor(Date.now() / 1000),
    ])
      .then((row) => callback(null, row ? row.total : 0))
      .catch((err) => callback(err));
  }

  clear(callback) {
    db.query(`DELETE FROM \`${this.table}\``)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  all(callback) {
    db.query(`SELECT data FROM \`${this.table}\` WHERE expires > ?`, [Math.floor(Date.now() / 1000)])
      .then((rows) =>
        callback(
          null,
          rows.map((row) => {
            try {
              return JSON.parse(row.data);
            } catch {
              return null;
            }
          }).filter(Boolean)
        )
      )
      .catch((err) => callback(err));
  }

  /** Drop rows whose expiry has passed. */
  async reap() {
    try {
      await db.query(`DELETE FROM \`${this.table}\` WHERE expires < ?`, [Math.floor(Date.now() / 1000)]);
    } catch (err) {
      logger.warn('Session reaper failed', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];
const DOC_TYPES = ['application/pdf', 'application/zip', 'text/plain'];
// MP4 and WebM are the two every current browser plays. Deliberately not
// QuickTime or AVI: accepting a file the browser cannot play just produces a
// silent black box on the homepage.
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

const FOLDER_RULES = {
  packages: { types: IMAGE_TYPES, maxMb: config.uploads.maxSizeMb },
  portfolio: { types: IMAGE_TYPES, maxMb: config.uploads.maxSizeMb },
  testimonials: { types: IMAGE_TYPES, maxMb: 5 },
  clients: { types: IMAGE_TYPES, maxMb: 5 },
  logos: { types: IMAGE_TYPES, maxMb: 5 },
  // 5 MB, not 2. A photo straight off a phone is routinely 3-6 MB, and a 2 MB
  // cap silently rejects the most natural thing a customer will try to upload.
  // The image is only ever displayed at ~78px, so this is generous on purpose:
  // refusing a valid photo is a worse outcome than storing a large one.
  avatars: { types: IMAGE_TYPES, maxMb: 5 },
  // Homepage hero media. Generous because a hero video is a real video, not a
  // thumbnail - a 30-second 1080p clip is comfortably 20-40 MB.
  hero: { types: [...IMAGE_TYPES, ...VIDEO_TYPES], maxMb: 60 },
  media: { types: [...IMAGE_TYPES, ...DOC_TYPES], maxMb: 10 },
  payments: { types: [...IMAGE_TYPES, ...DOC_TYPES], maxMb: 5 },
  tickets: { types: [...IMAGE_TYPES, ...DOC_TYPES], maxMb: 5 },
  posts: { types: IMAGE_TYPES, maxMb: config.uploads.maxSizeMb },
};

/** Ensure the upload root and every subfolder exist. */
function ensureUploadDirs() {
  const folders = ['', ...Object.keys(FOLDER_RULES)];
  for (const folder of folders) {
    const target = path.join(config.uploads.dir, folder);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
  }
}

/** `my logo final.png` -> `my-logo-final.png`, with a random suffix. */
function safeFileName(original) {
  const ext = path.extname(original || '').toLowerCase().slice(0, 10);
  const base = path
    .basename(original || 'file', ext)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'file';
  const unique = crypto.randomBytes(4).toString('hex');
  return `${base}-${unique}${ext}`;
}

function storage(folder) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const target = path.join(config.uploads.dir, folder);
      fs.mkdir(target, { recursive: true }, (err) => cb(err, target));
    },
    filename(req, file, cb) {
      const name = safeFileName(file.originalname);

      // Record the path on the request as the file is written.
      //
      // `req.files` is only populated once a field completes, so when multer
      // aborts mid-upload - a file over the size limit, for instance - the
      // partial file exists on disk but appears nowhere. Tracking it here is
      // what lets a rejected request clean up after itself.
      const target = path.join(config.uploads.dir, folder, name);
      req.__uploadPaths = req.__uploadPaths || [];
      req.__uploadPaths.push(target);

      cb(null, name);
    },
  });
}

/**
 * Build a multer handler for a logical folder.
 *
 * @param {string} folder key of FOLDER_RULES
 * @param {'array'|'single'|'any'} mode
 *        'array'  one field name, up to 12 files -> req.files
 *        'single' one field name, one file       -> req.file
 *        'any'    any field names                -> req.files (each keeps fieldname)
 * @param {string} field  form field name, for 'array' and 'single'
 */
function buildUploader(folder, mode, field) {
  const rules = FOLDER_RULES[folder] || FOLDER_RULES.media;

  const handler = multer({
    storage: storage(folder),
    limits: { fileSize: (rules.maxMb || 5) * 1024 * 1024, files: 12 },
    fileFilter(req, file, cb) {
      if (rules.types.includes(file.mimetype)) return cb(null, true);
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
  });

  if (mode === 'any') return handler.any();
  if (mode === 'single') return handler.single(field);
  return handler.array(field, 12);
}

/**
 * Build an upload middleware for a logical folder.
 * @param {string} folder key of FOLDER_RULES
 * @param {string} field  form field name
 */
function upload(folder = 'media', field = 'file') {
  return buildUploader(folder, 'array', field);
}

/**
 * One file from one named field. Populates `req.file`, not `req.files`.
 *
 * Previously this was an alias for `upload()`, which returns an array - so a
 * caller reading `req.file` got `undefined` with no error.
 */
function uploadSingle(folder = 'media', field = 'file') {
  return buildUploader(folder, 'single', field);
}

/**
 * Several differently-named file fields in one request. Each file keeps its
 * `fieldname`, so the caller can map it back to the field it belongs to - which
 * is what the settings screen needs for its four independent image fields.
 */
function uploadAny(folder = 'media') {
  return buildUploader(folder, 'any');
}

/**
 * An uploader whose folder is chosen per form field.
 *
 * The settings screen posts brand images and a hero video in one request, and a
 * multer instance has a single destination - so the choice has to be made per
 * file. `file.fieldname` is available inside both the destination callback and
 * the filter, which is what makes that possible.
 *
 * The size limit is the largest of the folders involved rather than each
 * folder's own, because multer applies `limits.fileSize` per instance. The type
 * filter IS per folder, so a video still cannot be posted into an image-only
 * folder. The per-folder `maxMb` remains the figure shown in the form.
 *
 * @param {(fieldname: string) => string} resolver  field name -> folder key
 */
function uploadAnyRouted(resolver) {
  const folderFor = (fieldname) => {
    const key = resolver(fieldname);
    return FOLDER_RULES[key] ? key : 'media';
  };

  // multer applies `limits.fileSize` per instance, not per file, so this has to
  // be the largest of the folders involved. The type filter below IS per
  // folder, so a video still cannot be posted into an image-only folder.
  const maxMb = Math.max(...Object.keys(FOLDER_RULES).map((key) => FOLDER_RULES[key].maxMb || 5));

  const handler = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        const target = path.join(config.uploads.dir, folderFor(file.fieldname));
        fs.mkdir(target, { recursive: true }, (err) => cb(err, target));
      },
      filename(req, file, cb) {
        const name = safeFileName(file.originalname);
        // Recorded for the same reason as in storage(): a rejected request has
        // to be able to clean up after itself.
        req.__uploadPaths = req.__uploadPaths || [];
        req.__uploadPaths.push(path.join(config.uploads.dir, folderFor(file.fieldname), name));
        cb(null, name);
      },
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 12 },
    fileFilter(req, file, cb) {
      const rules = FOLDER_RULES[folderFor(file.fieldname)] || FOLDER_RULES.media;
      if (rules.types.includes(file.mimetype)) return cb(null, true);
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
  });

  return handler.any();
}

/**
 * Which upload folder a settings-screen file field belongs to.
 *
 * Exported because the route that RECEIVES the upload and the controller that
 * records the resulting URL both need it. When they disagree the stored path
 * points somewhere the file is not - the admin looks correct and the asset
 * 404s, which is a slow bug to find.
 */
function settingsUploadFolder(fieldname) {
  return fieldname === 'hero_video' ? 'hero' : 'logos';
}

/**
 * Turn saved multer files into a media-table payload list.
 * `fileUrl` is built from the public mount path, which is independent of where
 * the file physically lives.
 */
function toMediaRecords(files, { folder = 'media', uploaderId = null, uploaderType = 'staff' } = {}) {
  if (!files || !files.length) return [];
  return files.map((file) => ({
    file_name: file.filename,
    original_name: file.originalname,
    // Store the path relative to the upload root; the deploy can relocate that
    // root without rewriting every row.
    file_path: path.relative(config.uploads.dir, file.path).replace(/\\/g, '/'),
    file_url: `${config.uploads.publicPath}/${folder}/${file.filename}`,
    mime_type: file.mimetype,
    extension: path.extname(file.filename).replace('.', '').toLowerCase(),
    size_bytes: file.size,
    folder,
    uploaded_by: uploaderId,
    uploader_type: uploaderType,
  }));
}

/** Persist media rows. Failures are logged, never thrown - the upload already
 *  succeeded on disk and losing the index row should not 500 the request. */
async function recordMedia(files, options = {}) {
  const records = toMediaRecords(files, options);
  const saved = [];
  for (const record of records) {
    try {
      const id = await db.insert('media', record);
      saved.push({ id, ...record });
    } catch (err) {
      logger.warn('Could not index uploaded file', { file: record.file_name, error: err.message });
    }
  }
  return saved;
}

/** Remove a file from disk, ignoring "already gone". */
async function removeFile(relativePath) {
  if (!relativePath) return false;
  // Refuse to escape the upload root.
  const full = path.resolve(config.uploads.dir, relativePath);
  if (!full.startsWith(path.resolve(config.uploads.dir))) return false;
  try {
    await fs.promises.unlink(full);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  MySQLSessionStore,
  upload,
  uploadSingle,
  uploadAny,
  uploadAnyRouted,
  settingsUploadFolder,
  ensureUploadDirs,
  safeFileName,
  toMediaRecords,
  recordMedia,
  removeFile,
  FOLDER_RULES,
};
