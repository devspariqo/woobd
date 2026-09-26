/**
 * Customer dashboard routes, mounted at /account.
 *
 * Everything except the sign-out shortcut requires an authenticated customer.
 * Ownership of each record is enforced in the controller (not here), because
 * the check needs the row that only the controller loads.
 *
 * The paths must stay in step with views/partials/dashboard-sidebar.ejs and the
 * links inside the customer views.
 */
'use strict';

const express = require('express');

const ctrl = require('../controllers/customer.controller');
const auth = require('../middleware/auth');
const security = require('../middleware/security');
const { uploadGuarded } = require('../middleware/upload');

const router = express.Router();

// Anything below this line needs a signed-in customer.
router.use(auth.requireCustomer);
// Keep the session copy honest - a suspended customer is ejected mid-session.
// refreshIdentity is a factory, so it must be invoked: mounting it bare would
// hand Express a function that never calls next() and the request would hang.
router.use(auth.refreshIdentity());

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
router.get('/', ctrl.dashboard);

// ---------------------------------------------------------------------------
// Orders & checkout
// ---------------------------------------------------------------------------
router.get('/orders', ctrl.orders);
router.get('/orders/:id(\\d+)', ctrl.orderDetail);

router.get('/checkout/:serviceId(\\d+)', ctrl.checkoutForm);
router.post('/checkout', ctrl.checkoutSubmit);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
router.get('/payments', ctrl.payments);

router.get('/orders/:id(\\d+)/pay', ctrl.submitPaymentForm);
router.post(
  '/payments',
  uploadGuarded('payments', 'screenshot'),
  security.formLimiter,
  ctrl.submitPayment
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
router.get('/subscriptions', ctrl.subscriptions);
router.post('/subscriptions/:id(\\d+)/cancel', ctrl.cancelSubscription);

// ---------------------------------------------------------------------------
// Invoices (rendered with the chrome-free print layout)
// ---------------------------------------------------------------------------
router.get('/invoices', ctrl.invoices);
router.get('/invoices/:id(\\d+)', ctrl.invoiceDetail);

// ---------------------------------------------------------------------------
// Support tickets
//
// /tickets/new is declared before /tickets/:id so the literal wins.
// ---------------------------------------------------------------------------
router.get('/tickets', ctrl.tickets);
router.get('/tickets/new', ctrl.ticketForm);
router.post('/tickets', security.formLimiter, ctrl.createTicket);
router.get('/tickets/:id(\\d+)', ctrl.ticketDetail);
router.post('/tickets/:id(\\d+)/reply', uploadGuarded('tickets', 'attachment'), ctrl.replyTicket);
router.post('/tickets/:id(\\d+)/close', ctrl.closeTicket);

// ---------------------------------------------------------------------------
// Profile & security
// ---------------------------------------------------------------------------
router.get('/profile', ctrl.profile);
router.post('/profile', ctrl.updateProfile);
router.post('/profile/avatar', uploadGuarded('avatars', 'avatar'), ctrl.updateAvatar);

router.get('/security', ctrl.security);
router.post('/security', ctrl.updatePassword);

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
router.get('/logout', ctrl.logout);

module.exports = router;
