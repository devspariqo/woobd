/**
 * Authentication and authorisation middleware.
 *
 * Three separate guards, matching the three audiences:
 *   requireStaff    - admin, manager or editor (or a narrower role list)
 *   requireCustomer - a signed-in customer
 *   requireGuest    - redirects signed-in users away from login/register pages
 */
'use strict';

const db = require('../config/database');
const helpers = require('../utils/helpers');
const settings = require('../services/settings.service');

const ROLE_RANK = { editor: 1, manager: 2, admin: 3 };

/** Populate res.locals with the signed-in identities for every request. */
function loadIdentity() {
  return (req, res, next) => {
    res.locals.staff = req.session && req.session.staff ? req.session.staff : null;
    res.locals.customer = req.session && req.session.customer ? req.session.customer : null;
    res.locals.isStaff = Boolean(res.locals.staff);
    res.locals.isCustomer = Boolean(res.locals.customer);
    res.locals.adminPath = settings.get('admin_path_slug', 'dev-cp');
    res.locals.currentPath = req.path;
    next();
  };
}

/** Staff guard. `roles` narrows to a subset; omit to allow any staff. */
function requireStaff(roles) {
  const allowed = roles ? (Array.isArray(roles) ? roles : [roles]) : null;
  return (req, res, next) => {
    const staff = req.session && req.session.staff;
    if (!staff) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(401).json({ ok: false, message: 'Authentication required.' });
      }
      const target = helpers.url(`${settings.get('admin_path_slug', 'dev-cp')}/login`);
      return res.redirect(`${target}?next=${encodeURIComponent(req.originalUrl)}`);
    }

    if (allowed && !allowed.includes(staff.role)) {
      if (req.xhr || req.path.startsWith('/api/')) {
        return res.status(403).json({ ok: false, message: 'You do not have permission for this action.' });
      }
      return res.status(403).render('errors/403', {
        title: 'Access denied',
        layout: 'layouts/admin',
        message: 'Your role does not have permission to open this page.',
      });
    }

    next();
  };
}

/** Require at least the given rank, e.g. requireRole('manager') allows manager+admin. */
function requireRole(minimumRole) {
  return (req, res, next) => {
    const staff = req.session && req.session.staff;
    if (!staff) return res.redirect(helpers.url(`${settings.get('admin_path_slug', 'dev-cp')}/login`));
    const have = ROLE_RANK[staff.role] || 0;
    const need = ROLE_RANK[minimumRole] || 0;
    if (have < need) {
      return res.status(403).render('errors/403', {
        title: 'Access denied',
        layout: 'layouts/admin',
        message: `This action requires the ${minimumRole} role.`,
      });
    }
    next();
  };
}

/** Customer guard - used by every /account route. */
function requireCustomer(req, res, next) {
  const customer = req.session && req.session.customer;
  if (!customer) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, message: 'Please sign in to continue.' });
    }
    return res.redirect(`${helpers.url('/signin')}?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

/** Redirect already-authenticated users away from signin/signup. */
function requireGuest(area = 'customer') {
  return (req, res, next) => {
    if (area === 'staff' && req.session && req.session.staff) {
      return res.redirect(helpers.url(`${settings.get('admin_path_slug', 'dev-cp')}/dashboard`));
    }
    if (area === 'customer' && req.session && req.session.customer) {
      return res.redirect(helpers.url('/account'));
    }
    next();
  };
}

/**
 * Re-validate the session against the database on each request.
 *
 * Without this a suspended or deleted user keeps their session until it
 * expires. Cheap because it is a single indexed primary-key lookup.
 */
function refreshIdentity() {
  return async (req, res, next) => {
    try {
      if (req.session && req.session.staff) {
        const row = await db.queryOne(
          'SELECT id, name, username, email, role, status, avatar FROM users WHERE id = ? LIMIT 1',
          [req.session.staff.id]
        );
        if (!row || row.status !== 'active') {
          req.session.staff = null;
          if (req.session) req.session.flashError = 'Your account is no longer active.';
          return res.redirect(helpers.url(`${settings.get('admin_path_slug', 'dev-cp')}/login`));
        }
        // Keep the session copy current so a profile change shows immediately.
        req.session.staff = { ...req.session.staff, ...row };
        // `loadIdentity` ran earlier and stored a REFERENCE to the old session
        // object. Replacing the session with a new object leaves res.locals
        // pointing at the stale one, so the header and sidebar would render the
        // previous name and avatar for this request. Re-point it.
        res.locals.staff = req.session.staff;
      }

      if (req.session && req.session.customer) {
        const row = await db.queryOne(
          'SELECT id, name, email, phone, avatar, status FROM customers WHERE id = ? LIMIT 1',
          [req.session.customer.id]
        );
        if (!row || row.status !== 'active') {
          req.session.customer = null;
          req.session.flashError = 'Your account is no longer active.';
          return res.redirect(helpers.url('/signin'));
        }
        req.session.customer = { ...req.session.customer, ...row };
        // Same reason as the staff branch above: without this, a customer who
        // has just changed their photo sees the old one in the dashboard chrome
        // until the next request.
        res.locals.customer = req.session.customer;
      }
    } catch (err) {
      // A transient DB blip should not log everyone out - carry on with the
      // session as-is and let the request itself surface the error.
    }
    next();
  };
}

module.exports = {
  loadIdentity,
  refreshIdentity,
  requireStaff,
  requireRole,
  requireCustomer,
  requireGuest,
  ROLE_RANK,
};
