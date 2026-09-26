/**
 * Admin configuration and account screens.
 *
 * Staff management, the signed-in operator's own profile, the media library,
 * the reporting dashboard, and database backup. These do not fit the CMS
 * registry - each has its own shape and its own risks - so they are written
 * out individually.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const userModel = require('../models/user.model');
const orderModel = require('../models/order.model');
const contentModel = require('../models/content.model');
const activity = require('../services/activity.service');
const adminCtrl = require('./admin.controller');
const db = require('../config/database');
const config = require('../config');
const storage = require('../lib/storage');
const helpers = require('../utils/helpers');
const { clean, validate } = require('../utils/validators');
const { fromQuery } = require('../utils/paginator');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;
const PER_PAGE = 20;

async function chrome(res, navKey) {
  res.locals.navActive = navKey;
  res.locals.badges = await adminCtrl.badgeCounts();
}

// ===========================================================================
// Staff
// ===========================================================================

const ROLES = ['editor', 'manager', 'admin'];

exports.staff = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, PER_PAGE);

    const result = await userModel.listStaff({
      page,
      perPage,
      search: clean.str(req.query.q || '', 120),
      role: clean.str(req.query.role, 20),
      status: clean.str(req.query.status, 20),
    });

    const adminCount = await userModel.countAdmins();

    await chrome(res, 'staff');

    res.render('admin/staff', {
      layout: 'layouts/admin',
      pageTitle: 'Staff',
      pageSubtitle: 'Who can sign in to this panel, and what they can do.',
      // Named `members`, NOT `staff`: middleware/auth sets res.locals.staff to
      // the signed-in user, and the sidebar and layout depend on it. Reusing the
      // name here would shadow the current user with the list.
      members: result.rows,
      pager: result,
      adminCount: Number(adminCount && adminCount.total) || 0,
      roles: ROLES,
      activeRole: clean.str(req.query.role, 20),
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Staff', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

/** Create or update a staff account. */
exports.saveStaff = async (req, res, next) => {
  const back = () => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/staff`));

  try {
    const id = req.params.id ? Number(req.params.id) : null;
    const existing = id ? await userModel.findStaffById(id) : null;

    if (id && !existing) {
      req.session.flashError = 'Staff member not found.';
      return back();
    }

    const name = clean.str(req.body.name, 120);
    const username = clean.str(req.body.username, 60).toLowerCase();
    const email = clean.email(req.body.email);
    const phone = clean.str(req.body.phone, 30);
    const role = clean.str(req.body.role, 20);
    const status = clean.str(req.body.status, 20) === 'suspended' ? 'suspended' : 'active';
    const password = String(req.body.password || '');

    const errors = {};
    if (!name) errors.name = 'Name is required.';
    if (!username) errors.username = 'Username is required.';
    else if (!/^[a-z0-9._-]{3,60}$/.test(username)) {
      errors.username = 'Use 3–60 lowercase letters, numbers, dots, dashes or underscores.';
    }
    const emailError = validate.email(email);
    if (emailError) errors.email = emailError;
    if (!ROLES.includes(role)) errors.role = 'Choose a valid role.';

    // Creating always needs a password; editing only if one was typed.
    if (!id && !password) errors.password = 'A password is required for a new account.';
    if (password) {
      const passwordError = validate.password(password);
      if (passwordError) errors.password = passwordError;
    }

    // A username or email must be unique across staff.
    const [usernameClash, emailClash] = await Promise.all([
      db.queryOne('SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1', [username, id || 0]),
      db.queryOne('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, id || 0]),
    ]);
    if (usernameClash) errors.username = 'That username is already taken.';
    if (emailClash) errors.email = 'That email address is already in use.';

    // Never let the last admin be demoted or suspended, or nobody can manage
    // the panel - including the settings and backup screens.
    if (id && existing.role === 'admin') {
      const adminCount = Number((await userModel.countAdmins()).total) || 0;
      if (adminCount <= 1 && (role !== 'admin' || status !== 'active')) {
        errors.role = 'This is the only administrator. Promote another account first.';
      }
    }

    if (Object.keys(errors).length) {
      req.session.flashError = Object.values(errors)[0];
      return back();
    }

    const row = { name, username, email, phone: phone || null, role, status };
    if (password) row.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let savedId = id;
    if (id) {
      await userModel.updateStaff(id, row);
    } else {
      savedId = await userModel.createStaff(row);
    }

    await activity.log({
      req,
      action: id ? 'staff.updated' : 'staff.created',
      entityType: 'staff',
      entityId: savedId,
      description: `${id ? 'Updated' : 'Created'} staff account "${name}" (${role}).`,
    });

    req.session.flashSuccess = id ? `${name} updated.` : `${name} can now sign in.`;
    return back();
  } catch (err) {
    return next(err);
  }
};

exports.deleteStaff = async (req, res, next) => {
  const back = () => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/staff`));

  try {
    const id = Number(req.params.id);
    const member = await userModel.findStaffById(id);

    if (!member) {
      req.session.flashError = 'Staff member not found.';
      return back();
    }

    // Two guards: you cannot delete yourself, and you cannot delete the last
    // administrator.
    if (req.session.staff && Number(req.session.staff.id) === id) {
      req.session.flashError = 'You cannot delete your own account.';
      return back();
    }

    if (member.role === 'admin') {
      const adminCount = Number((await userModel.countAdmins()).total) || 0;
      if (adminCount <= 1) {
        req.session.flashError = 'This is the only administrator and cannot be deleted.';
        return back();
      }
    }

    await userModel.deleteStaff(id);

    await activity.log({
      req,
      action: 'staff.deleted',
      entityType: 'staff',
      entityId: id,
      description: `Deleted staff account "${member.name}".`,
    });

    req.session.flashSuccess = `${member.name} removed.`;
    return back();
  } catch (err) {
    return next(err);
  }
};

// ===========================================================================
// Own profile
// ===========================================================================

exports.profile = async (req, res, next) => {
  try {
    const me = await userModel.findStaffById(req.session.staff.id);

    await chrome(res, 'profile');

    res.render('admin/profile', {
      layout: 'layouts/admin',
      pageTitle: 'My profile',
      pageSubtitle: 'Your account details and password.',
      me,
      seo: { ...res.locals.seo, title: 'My profile', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  const back = () => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/profile`));

  try {
    const id = req.session.staff.id;
    const me = await userModel.findStaffById(id);

    const name = clean.str(req.body.name, 120);
    const email = clean.email(req.body.email);
    const phone = clean.str(req.body.phone, 30);

    const errors = {};
    if (!name) errors.name = 'Name is required.';
    const emailError = validate.email(email);
    if (emailError) errors.email = emailError;

    const clash = await db.queryOne('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [email, id]);
    if (clash) errors.email = 'That email address is already in use.';

    if (Object.keys(errors).length) {
      req.session.flashError = Object.values(errors)[0];
      return back();
    }

    const row = { name, email, phone: phone || null };

    // An uploaded photo replaces the stored path.
    if (req.files && req.files.length) {
      row.avatar = `${config.uploads.publicPath}/avatars/${req.files[0].filename}`;
    }

    await userModel.updateStaff(id, row);

    // Keep the session copy in step, or the header keeps showing the old name.
    req.session.staff.name = name;
    req.session.staff.email = email;
    if (row.avatar) req.session.staff.avatar = row.avatar;

    await activity.log({
      req,
      action: 'profile.updated',
      entityType: 'staff',
      entityId: id,
      description: `Updated own profile.${me && me.name !== name ? ` Name changed from "${me.name}".` : ''}`,
    });

    req.session.flashSuccess = 'Profile updated.';
    return back();
  } catch (err) {
    return next(err);
  }
};

exports.updatePassword = async (req, res, next) => {
  const back = () => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/profile`));

  try {
    const id = req.session.staff.id;
    const me = await userModel.findStaffById(id);

    const current = String(req.body.current_password || '');
    const next_ = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');

    if (!me.password_hash || !(await bcrypt.compare(current, me.password_hash))) {
      req.session.flashError = 'Your current password is not correct.';
      return back();
    }

    const passwordError = validate.password(next_);
    if (passwordError) {
      req.session.flashError = passwordError;
      return back();
    }

    if (next_ !== confirm) {
      req.session.flashError = 'The new passwords do not match.';
      return back();
    }

    if (await bcrypt.compare(next_, me.password_hash)) {
      req.session.flashError = 'The new password must be different from the current one.';
      return back();
    }

    await userModel.updateStaff(id, { password_hash: await bcrypt.hash(next_, BCRYPT_ROUNDS) });

    await activity.log({
      req,
      action: 'profile.password_changed',
      entityType: 'staff',
      entityId: id,
      description: 'Changed their own password.',
    });

    req.session.flashSuccess = 'Password changed.';
    return back();
  } catch (err) {
    return next(err);
  }
};

// ===========================================================================
// Media library
// ===========================================================================

exports.media = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, 24);

    const [result, folders] = await Promise.all([
      contentModel.listMedia({
        page,
        perPage,
        folder: clean.str(req.query.folder, 60),
        search: clean.str(req.query.q || '', 120),
        type: clean.str(req.query.type, 40),
      }),
      contentModel.mediaFolders(),
    ]);

    await chrome(res, 'media');

    res.render('admin/media', {
      layout: 'layouts/admin',
      pageTitle: 'Media library',
      pageSubtitle: 'Every image uploaded through the panel.',
      media: result.rows,
      pager: result,
      // mediaFolders() returns rows of { folder, total } for folders that
      // actually contain files - used for the filter. The upload destination
      // list is every folder the storage rules allow, so an empty one is still
      // selectable.
      folders,
      uploadFolders: Object.keys(storage.FOLDER_RULES),
      activeFolder: clean.str(req.query.folder, 60),
      activeType: clean.str(req.query.type, 40),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Media library', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.uploadMedia = async (req, res, next) => {
  try {
    if (!req.files || !req.files.length) {
      req.session.flashError = 'Choose a file to upload.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/media`));
    }

    // Always the `media` folder.
    //
    // The route mounts multer for that folder, so that is where the bytes land.
    // A per-upload destination would have to be read from `req.body.folder`,
    // but multipart fields arrive in document order and multer's destination
    // callback runs as soon as it reaches the file - so a selector placed after
    // the file input would silently be ignored, and the record would claim a
    // folder the file is not in. The CMS screens route to their own folders;
    // this library is the general pool.
    const folder = 'media';

    // recordMedia takes the multer files and does the record conversion itself.
    // Passing it a single record (as this used to) returns an empty list and
    // stores nothing at all.
    const saved = await storage.recordMedia(req.files, {
      folder,
      uploaderId: req.session.staff.id,
      uploaderType: 'staff',
    });

    if (!saved.length) {
      req.session.flashError = 'Those files could not be saved. Please try again.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/media`));
    }

    await activity.log({
      req,
      action: 'media.uploaded',
      entityType: 'media',
      description: `Uploaded ${saved.length} file(s) to ${folder}.`,
    });

    req.session.flashSuccess = `${saved.length} file${saved.length === 1 ? '' : 's'} uploaded.`;
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/media`));
  } catch (err) {
    next(err);
  }
};

exports.deleteMedia = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = await contentModel.findMediaById(id);

    if (!item) {
      req.session.flashError = 'File not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/media`));
    }

    // Remove the file from disk first; if that fails, keep the record so the
    // library does not list a file that is gone.
    try {
      await storage.removeFile(item.file_path);
    } catch (err) {
      logger.warn('Could not delete media file from disk', err);
    }

    await contentModel.deleteMedia(id);

    await activity.log({
      req,
      action: 'media.deleted',
      entityType: 'media',
      entityId: id,
      description: `Deleted media file "${item.original_name}".`,
    });

    req.session.flashSuccess = 'File deleted.';
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/media`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Reports
// ===========================================================================

exports.reports = async (req, res, next) => {
  try {
    const months = [6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;

    const [
      orderCounts,
      invoiceCounts,
      paymentCounts,
      subscriptionCounts,
      customerCounts,
      trend,
      revenueByService,
      paymentsByMethod,
      signupTrend,
    ] = await Promise.all([
      orderModel.orderCounts(),
      orderModel.invoiceCounts(),
      orderModel.paymentCounts(),
      orderModel.subscriptionCounts(),
      userModel.counts(),
      orderModel.orderTrend(months),
      orderModel.revenueByService(8),
      orderModel.paymentsByMethod(),
      userModel.signupTrend(months),
    ]);

    await chrome(res, 'reports');

    res.render('admin/reports', {
      layout: 'layouts/admin',
      pageTitle: 'Reports',
      pageSubtitle: 'Revenue, orders, customers and what is selling.',
      months,
      orderCounts,
      invoiceCounts,
      paymentCounts,
      subscriptionCounts,
      customerCounts,
      trend,
      revenueByService,
      paymentsByMethod,
      signupTrend,
      seo: { ...res.locals.seo, title: 'Reports', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Database backup
// ===========================================================================

/** Table inventory with row counts and approximate size. */
async function tableInventory() {
  return db.query(
    `SELECT TABLE_NAME AS name,
            TABLE_ROWS AS row_estimate,
            ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024) AS kb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME ASC`
  );
}

exports.backup = async (req, res, next) => {
  try {
    const [tables, inventory] = await Promise.all([
      db.query(
        `SELECT TABLE_NAME AS name FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME ASC`
      ),
      tableInventory(),
    ]);

    const counts = {};
    for (const table of inventory) {
      counts[table.name] = { rows: Number(table.row_estimate) || 0, kb: Number(table.kb) || 0 };
    }

    await chrome(res, 'backup');

    res.render('admin/backup', {
      layout: 'layouts/admin',
      pageTitle: 'Backup & migration',
      pageSubtitle: 'Export the database, and see what it contains.',
      tables,
      inventory,
      counts,
      dbName: config.db.database,
      seo: { ...res.locals.seo, title: 'Backup', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

/** Escape a value for a MySQL INSERT statement. */
function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')}'`;
}

/**
 * Stream a full SQL dump as a download.
 *
 * Written by hand rather than shelling out to mysqldump, which is not
 * guaranteed to exist on shared hosting and would need the credentials on the
 * command line.
 */
exports.downloadBackup = async (req, res, next) => {
  try {
    const tables = await db.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME ASC`
    );

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${config.db.database}-backup-${stamp}.sql`;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.write(`-- ${config.app.name} database backup\n`);
    res.write(`-- Database: ${config.db.database}\n`);
    res.write(`-- Generated: ${new Date().toISOString()}\n`);
    res.write(`-- Tables: ${tables.length}\n`);
    res.write('--\n-- Restore with: mysql -u USER -p DBNAME < this-file.sql\n\n');
    res.write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n');

    let rowsWritten = 0;

    for (const { name } of tables) {
      // Identifiers are escaped, never taken raw from input.
      const safe = db.escapeId(name);
      res.write(`-- ----------------------------------------------------------------\n`);
      res.write(`-- Table: ${name}\n`);
      res.write(`-- ----------------------------------------------------------------\n`);

      // Recreate the table, so the dump restores into an empty database too.
      const createRow = await db.queryOne(`SHOW CREATE TABLE ${safe}`);
      const createSql = createRow ? createRow['Create Table'] : null;
      res.write(`DROP TABLE IF EXISTS ${safe};\n`);
      if (createSql) res.write(`${createSql};\n\n`);

      // Write INSERTs in batches so a large table does not build one huge string.
      const BATCH = 200;
      let offset = 0;

      for (;;) {
        const rows = await db.query(`SELECT * FROM ${safe} LIMIT ? OFFSET ?`, [BATCH, offset]);
        if (!rows.length) break;

        const columns = Object.keys(rows[0]);
        const columnList = columns.map((c) => db.escapeId(c)).join(', ');

        for (const row of rows) {
          const values = columns.map((c) => sqlValue(row[c])).join(', ');
          res.write(`INSERT INTO ${safe} (${columnList}) VALUES (${values});\n`);
        }

        rowsWritten += rows.length;
        offset += BATCH;
        if (rows.length < BATCH) break;
      }

      res.write('\n');
    }

    res.write('SET FOREIGN_KEY_CHECKS = 1;\n');
    res.write(`-- ${rowsWritten} row(s) exported from ${tables.length} table(s).\n`);
    res.end();

    await activity.log({
      req,
      action: 'backup.downloaded',
      entityType: 'database',
      description: `Downloaded a SQL backup of ${tables.length} tables (${rowsWritten} rows).`,
    });
  } catch (err) {
    // Headers are already sent, so the error handler cannot render a page.
    if (res.headersSent) {
      logger.error('Backup stream failed mid-download', err);
      return res.end();
    }
    return next(err);
  }
};

module.exports = exports;
