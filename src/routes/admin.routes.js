/**
 * Admin panel routes.
 *
 * Mounted by server.js under the configured slug (default `dev-cp`), so the
 * same file works whatever slug the operator sets. Paths are declared relative
 * to that mount point.
 *
 * The login route must be declared before the requireStaff() guard, otherwise
 * nobody could ever sign in.
 */
'use strict';

const express = require('express');

const ctrl = require('../controllers/admin.controller');
const content = require('../controllers/admin-content.controller');
const ops = require('../controllers/admin-ops.controller');
const config = require('../controllers/admin-config.controller');
const { RESOURCE_KEYS } = require('../config/admin-resources');
const auth = require('../middleware/auth');
const security = require('../middleware/security');
const captcha = require('../middleware/captcha');
const storage = require('../lib/storage');
const { uploadGuarded, uploadGuardedAny, uploadGuardedRouted } = require('../middleware/upload');

const router = express.Router();

// Ticket replies accept a single attachment; profile edits accept a photo;
// the media library accepts a batch.
//
// These MUST be uploadGuarded rather than raw multer: the global CSRF check
// cannot see a multipart body (it runs before multer parses it), so it defers
// to this middleware. Raw multer here would mean no CSRF check at all.
const uploadTicket = uploadGuarded('tickets', 'upload');
const uploadAvatar = uploadGuarded('avatars', 'upload');
const uploadMedia = uploadGuarded('media', 'upload');
// Settings posts four independent image fields (light logo, dark logo, footer
// logo, favicon), so each file is matched back to its setting by fieldname.
// Brand images go to logos; the hero video to hero. One multer instance has
// one destination, so the folder is resolved per form field.
const uploadSettings = uploadGuardedRouted(storage.settingsUploadFolder);

// ---------------------------------------------------------------------------
// Public: login
// ---------------------------------------------------------------------------
router.get('/login', ctrl.loginForm);

router.post(
  '/login',
  security.authLimiter,
  captcha.honeypot('website'),
  captcha.requireCaptcha('admin'),
  ctrl.loginSubmit
);

router.get('/logout', ctrl.logout);
router.post('/logout', ctrl.logout);

// ---------------------------------------------------------------------------
// Everything below requires a signed-in staff member.
// ---------------------------------------------------------------------------
// requireStaff and refreshIdentity are both FACTORIES - they return the actual
// (req, res, next) handler. Mounting either bare hands Express a function that
// only builds a handler and never calls next(), so the request hangs until the
// client times out. Note the ().
router.use(auth.requireStaff());
// refreshIdentity is a factory - it must be invoked. Mounted bare it would
// return a handler that never calls next(), hanging every admin request.
router.use(auth.refreshIdentity());

// Root of the panel goes to the dashboard.
router.get('/', (req, res) => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/dashboard`)));

// ---------------------------------------------------------------------------
// Dashboard & analytics
// ---------------------------------------------------------------------------
router.get('/dashboard', ctrl.dashboard);
router.get('/analytics', auth.requireRole('manager'), ctrl.analytics);

// ---------------------------------------------------------------------------
// Orders
//
// The detail route is declared before any sibling that could shadow it.
// ---------------------------------------------------------------------------
router.get('/orders', ctrl.orders);
router.get('/orders/:id(\\d+)', ctrl.orderDetail);
router.post('/orders/:id(\\d+)', ctrl.updateOrder);
router.post('/orders/:id(\\d+)/delete', auth.requireRole('admin'), ctrl.deleteOrder);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
router.get('/customers', ctrl.customers);
router.get('/customers/:id(\\d+)', ctrl.customerDetail);
router.post('/customers/:id(\\d+)', auth.requireRole('manager'), ctrl.updateCustomer);
// Its own route: the record form posts urlencoded, a file needs multipart.
router.post('/customers/:id(\\d+)/avatar', auth.requireRole('manager'), uploadAvatar, ctrl.updateCustomerAvatar);

// ---------------------------------------------------------------------------
// Payments - approval is what releases an order into production
// ---------------------------------------------------------------------------
router.get('/payments', ctrl.payments);
router.post('/payments/:id(\\d+)/approve', auth.requireRole('manager'), ctrl.approvePayment);
router.post('/payments/:id(\\d+)/reject', auth.requireRole('manager'), ctrl.rejectPayment);

// ---------------------------------------------------------------------------
// Operations - invoices, subscriptions, tickets, contacts, activity
//
// Detail routes are declared before siblings that could shadow them, and
// `/tickets/:id/reply` before `/tickets/:id` for the same reason.
// ---------------------------------------------------------------------------
router.get('/invoices', ops.invoices);
router.get('/invoices/:id(\\d+)', ops.invoiceDetail);
router.post('/invoices/:id(\\d+)', auth.requireRole('manager'), ops.updateInvoice);

router.get('/subscriptions', ops.subscriptions);
router.post('/subscriptions/:id(\\d+)', auth.requireRole('manager'), ops.updateSubscription);

router.get('/tickets', ops.tickets);
router.get('/tickets/:id(\\d+)', ops.ticketDetail);
router.post('/tickets/:id(\\d+)/reply', uploadTicket, ops.replyTicket);
router.post('/tickets/:id(\\d+)', ops.updateTicket);

router.get('/contacts', ops.contacts);
router.post('/contacts/:id(\\d+)', ops.updateContact);

// Live chat. Deleting is admin-only: a transcript is the record of what a
// customer was told, and destroying it is not a day-to-day action.
router.get('/chat', ops.chatConversations);
router.get('/chat/:id(\\d+)', ops.chatConversation);
router.post('/chat/:id(\\d+)', ops.updateChatConversation);
router.post('/chat/:id(\\d+)/delete', auth.requireRole('admin'), ops.deleteChatConversation);

router.get('/activity', ops.activity);

// ---------------------------------------------------------------------------
// Settings
//
// Admin only. This screen holds credentials (Google client secret, reCAPTCHA
// secret, SMTP password) and security controls (CAPTCHA toggles, the admin
// path slug, login lockout), so a manager or editor must not be able to open
// it or post to it.
// ---------------------------------------------------------------------------
router.get('/settings', auth.requireRole('admin'), ctrl.settings);
// The Branding tab posts logo and favicon files, so this form is multipart.
// uploadGuardedAny accepts several differently-named file fields and validates
// the CSRF token once multer has parsed the body.
router.post('/settings', auth.requireRole('admin'), uploadSettings, ctrl.saveSettings);

// Checks the saved reCAPTCHA keys against Google and reports the answer. No
// upload middleware: it reads what is already stored.
router.post('/settings/test-captcha', auth.requireRole('admin'), ctrl.testCaptcha);
router.post('/settings/test-mail', auth.requireRole('admin'), ctrl.testMail);

// ---------------------------------------------------------------------------
// CMS resources - packages, portfolio, testimonials, FAQs, clients, pages, menus
//
// Registered in a loop from the resource registry so the paths stay in step
// with what the sidebar and the registry declare. `tagResource` injects which
// resource a request is for, which is why every controller handler is a plain
// (req, res, next) function rather than a factory.
// ---------------------------------------------------------------------------
for (const key of RESOURCE_KEYS) {
  const tag = content.tagResource(key);
  const upload = content.uploadFor(key);

  router.get(`/${key}`, tag, content.contentList);
  router.get(`/${key}/new`, tag, content.contentForm);
  router.get(`/${key}/:id(\\d+)/edit`, tag, content.contentForm);

  // The upload middleware must run before the handler so req.files is populated.
  router.post(`/${key}`, tag, upload, content.contentSave);
  router.post(`/${key}/:id(\\d+)`, tag, upload, content.contentSave);

  router.post(`/${key}/:id(\\d+)/delete`, tag, content.contentRemove);
  router.post(`/${key}/:id(\\d+)/toggle/:field`, tag, content.contentToggle);
}

// ---------------------------------------------------------------------------
// Configuration & account
//
// Staff management and backup are admin-only: one grants panel access, the
// other exports the whole database.
// ---------------------------------------------------------------------------
router.get('/staff', auth.requireRole('admin'), config.staff);
router.post('/staff', auth.requireRole('admin'), config.saveStaff);
router.post('/staff/:id(\\d+)', auth.requireRole('admin'), config.saveStaff);
router.post('/staff/:id(\\d+)/delete', auth.requireRole('admin'), config.deleteStaff);

// Profile is deliberately open to every role - it only edits your own account.
router.get('/profile', config.profile);
router.post('/profile', uploadAvatar, config.updateProfile);
router.post('/profile/password', config.updatePassword);

router.get('/media', config.media);
router.post('/media/upload', uploadMedia, config.uploadMedia);
router.post('/media/:id(\\d+)/delete', config.deleteMedia);

router.get('/reports', auth.requireRole('manager'), config.reports);

router.get('/backup', auth.requireRole('admin'), config.backup);
router.get('/backup/download', auth.requireRole('admin'), config.downloadBackup);

module.exports = router;
