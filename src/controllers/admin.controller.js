/**
 * Admin panel.
 *
 * Authorisation is layered: the router applies requireStaff() to everything,
 * and individual routes add requireRole('manager') or ('admin') where the
 * action is destructive or security-sensitive.
 *
 * The most important flow here is `updateOrder` + `saveDeliverables`: when an
 * order is moved to `active`, the operator records the credentials the customer
 * needs (cPanel URL, site URL, password). Those rows are what the customer
 * dashboard displays, so `is_visible` on each row is the switch that decides
 * whether the customer sees it.
 */
'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userModel = require('../models/user.model');
const orderModel = require('../models/order.model');
const contentModel = require('../models/content.model');
const settings = require('../services/settings.service');
const settingsSchema = require('../config/settings-schema');
const mail = require('../services/mail.service');
const activity = require('../services/activity.service');
const db = require('../config/database');
const storage = require('../lib/storage');
const captcha = require('../middleware/captcha');
const { clean, validate } = require('../utils/validators');
const { fromQuery } = require('../utils/paginator');
const helpers = require('../utils/helpers');
const config = require('../config');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

function setNav(res, key, extra = {}) {
  res.locals.navActive = key;
  Object.assign(res.locals, extra);
}

/** Shared payload for the sidebar badges on every admin screen. */
async function badgeCounts() {
  const [orders, payments, tickets, contacts] = await Promise.all([
    orderModel.orderCounts(),
    orderModel.paymentCounts(),
    orderModel.ticketCounts(),
    db.queryOne("SELECT COUNT(*) AS unread FROM contact_messages WHERE status = 'new'"),
  ]);
  return {
    orders: orders ? Number(orders.pending) + Number(orders.in_progress) : 0,
    payments: payments ? Number(payments.pending) : 0,
    tickets: tickets ? Number(tickets.open) + Number(tickets.pending) : 0,
    contacts: contacts ? Number(contacts.unread) : 0,
  };
}

// ===========================================================================
// Authentication
// ===========================================================================

exports.loginForm = async (req, res, next) => {
  try {
    // Already signed in? Go straight through.
    if (req.session && req.session.staff) {
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/dashboard`));
    }

    res.render('admin/login', {
      layout: 'layouts/admin-auth',
      pageTitle: 'Staff sign in',
      adminPath: res.locals.adminPath,
      errors: null,
      form: null,
      showCaptcha: settings.getBool('captcha_on_admin') && Boolean(res.locals.captcha.siteKey),
      seo: { ...res.locals.seo, title: 'Staff sign in', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.loginSubmit = async (req, res, next) => {
  const adminPath = res.locals.adminPath;

  try {
    const username = clean.str(req.body.username, 60);
    const password = String(req.body.password || '');
    const next = clean.path(req.body.next, 300);
    // An unchecked checkbox submits nothing at all, so this is presence, not
    // value. Carried through the error re-render so a failed attempt does not
    // silently reset the operator's choice.
    const remember = req.body.remember === '1';

    const render = (errors, status = 400) =>
      res.status(status).render('admin/login', {
        layout: 'layouts/admin-auth',
        pageTitle: 'Staff sign in',
        adminPath,
        errors,
        form: { username, remember },
        showCaptcha: settings.getBool('captcha_on_admin') && Boolean(res.locals.captcha.siteKey),
        seo: { ...res.locals.seo, title: 'Staff sign in', robots: 'noindex,nofollow' },
      });

    if (!username || !password) {
      return render({ username: !username ? 'Enter your username.' : null, password: !password ? 'Enter your password.' : null });
    }

    // Captcha first, so a bot cannot even attempt a credential.
    if (settings.getBool('captcha_on_admin')) {
      const outcome = await captcha.verify(req.body['g-recaptcha-response'], req.ip, 'admin');
      if (!outcome.ok && !outcome.degraded) {
        return render({ captcha: 'Please complete the verification challenge.' });
      }
    }

    // Accept either the username or the email address, so an operator does not
    // have to remember which one they have.
    const staff = username.includes('@')
      ? await userModel.findStaffByEmail(username)
      : await userModel.findStaffByLogin(username);

    // Uniform failure message - never reveal which half was wrong.
    const INVALID = 'Those credentials do not match our records.';

    if (!staff) {
      // Spend roughly the same time as a real compare so timing does not leak.
      await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789012345678901234567');
      return render({ password: INVALID });
    }

    if (staff.status !== 'active') {
      return render({ password: 'This account has been suspended. Contact an administrator.' });
    }

    if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
      return render({ password: `Too many failed attempts. Try again after ${helpers.formatDateTime(staff.locked_until)}.` });
    }

    const ok = staff.password_hash ? await bcrypt.compare(password, staff.password_hash) : false;

    if (!ok) {
      await userModel.registerFailedLogin(staff.id);
      const attempts = Number(staff.failed_attempts || 0) + 1;
      return render({
        password: attempts >= 5
          ? 'Too many failed attempts. This account is locked for 15 minutes.'
          : INVALID,
      });
    }

    await userModel.registerSuccessfulLogin(staff.id, req.ip);

    // Rotate the session id so a pre-login cookie cannot be reused.
    const redirectTo = res.locals.helpers.url(next || `${adminPath}/dashboard`);

    req.session.regenerate((err) => {
      if (err) return next(err);

      // "Keep me signed in" decides how long the session survives.
      //
      // Checked: the configured session lifetime, which is a week by default.
      // Unchecked: twelve hours - long enough not to interrupt a working day,
      // short enough that a shared machine does not stay signed in overnight.
      //
      // Set after regenerate(), because regenerating resets the cookie.
      req.session.cookie.maxAge = remember
        ? config.session.maxAge
        : 1000 * 60 * 60 * 12;

      req.session.staff = {
        id: staff.id,
        name: staff.name,
        username: staff.username,
        email: staff.email,
        role: staff.role,
        avatar: staff.avatar,
      };
      req.session.flashSuccess = `Welcome back, ${staff.name.split(' ')[0]}.`;

      activity
        .log({
          req,
          actorType: 'staff',
          actorId: staff.id,
          actorName: staff.name,
          action: 'staff.login',
          entityType: 'user',
          entityId: staff.id,
          description: `${staff.name} signed in to the admin panel.`,
        })
        .catch(() => {});

      return res.redirect(redirectTo);
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  const adminPath = res.locals.adminPath;
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect(res.locals.helpers.url(`${adminPath}/login`));
  });
};

// ===========================================================================
// Dashboard
// ===========================================================================

exports.dashboard = async (req, res, next) => {
  try {
    const [
      orderStats,
      paymentStats,
      invoiceStats,
      subscriptionStats,
      customerCounts,
      recentOrders,
      recentPayments,
      recentTickets,
      staffList,
      topCustomers,
      pendingPayments,
    ] = await Promise.all([
      orderModel.orderCounts(),
      orderModel.paymentCounts(),
      orderModel.invoiceCounts(),
      orderModel.subscriptionCounts(),
      userModel.counts(),
      orderModel.recentOrders(8),
      orderModel.listPayments({ perPage: 6, status: 'pending' }),
      orderModel.listTickets({ perPage: 6 }),
      userModel.listStaff({ perPage: 8 }),
      orderModel.topCustomers(10),
      orderModel.paymentCounts(),
    ]);

    setNav(res, 'dashboard', { badges: await badgeCounts() });

    res.render('admin/dashboard', {
      layout: 'layouts/admin',
      pageTitle: 'Dashboard',
      pageSubtitle: `Signed in as ${req.session.staff.role}`,
      orderStats,
      paymentStats,
      invoiceStats,
      subscriptionStats,
      customerCounts,
      recentOrders,
      recentPayments: recentPayments.rows,
      recentTickets: recentTickets.rows,
      staffList: staffList.rows,
      topCustomers,
      pendingPaymentCount: pendingPayments ? Number(pendingPayments.pending) : 0,
      seo: { ...res.locals.seo, title: 'Admin dashboard', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.analytics = async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));

    const [trend, byService, byMethod, signupTrend, stats] = await Promise.all([
      orderModel.orderTrend(months),
      orderModel.revenueByService(10),
      orderModel.paymentsByMethod(),
      userModel.signupTrend(months),
      orderModel.orderCounts(),
    ]);

    setNav(res, 'analytics', { badges: await badgeCounts() });

    res.render('admin/analytics', {
      layout: 'layouts/admin',
      pageTitle: 'Analytics',
      pageSubtitle: `Revenue and order performance over the last ${months} months`,
      months,
      trend,
      byService,
      byMethod,
      signupTrend,
      stats,
      seo: { ...res.locals.seo, title: 'Analytics', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Orders - the core of the panel
// ===========================================================================

exports.orders = async (req, res, next) => {
  try {
    const { page } = fromQuery(req.query, 20);

    const result = await orderModel.listOrders({
      page,
      perPage: 20,
      status: clean.str(req.query.status, 20),
      paymentStatus: clean.str(req.query.payment, 20),
      search: clean.str(req.query.q || '', 120),
      sort: clean.str(req.query.sort, 20) || 'newest',
    });

    const [counts, paymentTotals] = await Promise.all([
      orderModel.orderCounts(),
      orderModel.paymentCounts(),
    ]);

    setNav(res, 'orders', { badges: await badgeCounts() });

    res.render('admin/orders', {
      layout: 'layouts/admin',
      pageTitle: 'Orders',
      pageSubtitle: 'Manage every project from order to handover.',
      orders: result.rows,
      pager: result,
      counts,
      paymentTotals,
      activeStatus: clean.str(req.query.status, 20),
      activePayment: clean.str(req.query.payment, 20),
      search: clean.str(req.query.q || '', 120),
      sort: clean.str(req.query.sort, 20) || 'newest',
      statuses: orderModel.ORDER_STATUSES,
      seo: { ...res.locals.seo, title: 'Orders', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.orderDetail = async (req, res, next) => {
  try {
    const detail = await orderModel.orderDetail(Number(req.params.id));

    if (!detail) {
      req.session.flashError = 'Order not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/orders`));
    }

    const [staff, customers] = await Promise.all([
      userModel.listStaff({ perPage: 100 }),
      userModel.listCustomers({ perPage: 1 }),
    ]);

    setNav(res, 'orders', { badges: await badgeCounts() });

    res.render('admin/order-detail', {
      layout: 'layouts/admin',
      pageTitle: `Order ${detail.order.order_number}`,
      pageSubtitle: detail.order.service_title,
      order: detail.order,
      deliverables: detail.deliverables,
      payments: detail.payments,
      invoices: detail.invoices,
      invoiceItems: detail.invoiceItems,
      subscription: detail.subscription,
      timeline: detail.timeline,
      // Available next states come from the state machine, not a hardcoded list,
      // so the UI cannot offer a transition the model would reject.
      nextStatuses: (orderModel.ORDER_TRANSITIONS[detail.order.status] || []),
      staff: staff.rows,
      customer: customers.rows[0] || null,
      seo: { ...res.locals.seo, title: `Order ${detail.order.order_number}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an order, optionally hand over credentials.
 *
 * This is the single most important admin action in the application: moving an
 * order to `active` together with the credential rows is what gives the
 * customer access to their website.
 */
exports.updateOrder = async (req, res, next) => {
  const staff = req.session.staff;

  try {
    const orderId = Number(req.params.id);
    const order = await orderModel.findOrderById(orderId);

    if (!order) {
      req.session.flashError = 'Order not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/orders`));
    }

    const status = clean.str(req.body.status, 20);
    const note = clean.text(req.body.note, 500);

    // --- status change (validated against ORDER_TRANSITIONS in the model) ---
    if (status && status !== order.status) {
      try {
        await orderModel.updateOrderStatus(orderId, status, {
          actor: { req, type: 'staff', id: staff.id, name: staff.name },
          note: note || undefined,
          dueAt: req.body.due_at || null,
        });
      } catch (err) {
        req.session.flashError = err.message;
        return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/orders/${orderId}`));
      }
    } else {
      // No status change - still allow the editable fields to be saved.
      const patch = {};
      if (req.body.service_title) patch.service_title = clean.str(req.body.service_title, 180);
      if (req.body.total !== undefined && req.body.total !== '') patch.total = clean.decimal(req.body.total);
      if (req.body.due_at) patch.due_at = new Date(req.body.due_at);
      if (req.body.domain_name !== undefined) patch.domain_name = clean.str(req.body.domain_name, 191) || null;
      if (req.body.notes !== undefined) patch.notes = clean.text(req.body.notes, 4000);
      if (req.body.payment_status) patch.payment_status = clean.str(req.body.payment_status, 20);
      if (Object.keys(patch).length) await orderModel.updateOrder(orderId, patch);
    }

    // --- deliverables (the credentials the customer will see) ---
    // The form posts parallel arrays: label[], value[], visible[].
    if (req.body.deliverable_label !== undefined) {
      const labels = [].concat(req.body.deliverable_label || []);
      const values = [].concat(req.body.deliverable_value || []);
      const visibleFlags = [].concat(req.body.deliverable_visible || []);

      const items = labels
        .map((label, index) => ({
          label: clean.str(label, 150),
          value: String(values[index] === undefined ? '' : values[index]).slice(0, 4000),
          // A checkbox only appears in the POST when ticked, so anything not
          // present in the array is considered hidden.
          isVisible: visibleFlags.map(String).includes(String(index)),
        }))
        .filter((item) => item.label);

      await orderModel.replaceDeliverables(orderId, items);

      await activity.log({
        req,
        actorType: 'staff',
        actorId: staff.id,
        actorName: staff.name,
        action: 'order.deliverables_updated',
        entityType: 'order',
        entityId: orderId,
        description: `Handover details updated for ${order.order_number} (${items.length} item(s)).`,
      });
    }

    req.session.flashSuccess = `Order ${order.order_number} updated.`;

    // Tell the customer when their site goes live and credentials are ready.
    if (status === 'active' && status !== order.status) {
      const customer = await userModel.findCustomerById(order.customer_id);
      const refreshed = await orderModel.findOrderById(orderId);
      const items = await orderModel.listDeliverables(orderId);

      Promise.allSettled([
        mail.sendOrderStatusUpdate(customer, refreshed),
        items.filter((i) => i.is_visible).length
          ? mail.send({
              to: customer.email,
              subject: `Your website is live - ${refreshed.order_number}`,
              html: mail.wrapLayout({
                title: 'Your website is live',
                body: `<p>Hi ${clean.str(customer.name, 60)}, <strong>${clean.str(refreshed.service_title, 120)}</strong> is now online.</p>
                       <p>Your login details are waiting on your dashboard. Please sign in and save them somewhere secure.</p>`,
                ctaText: 'Open my dashboard',
                ctaUrl: `${config.app.url}${helpers.url('/account/orders/' + orderId)}`,
              }),
              text: `Your website ${refreshed.service_title} is live. Sign in to see your login details.`,
            })
          : Promise.resolve(),
      ]).catch(() => {});

      req.session.flashSuccess = `Order ${order.order_number} is live and the customer has been notified.`;
    }

    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/orders/${orderId}`));
  } catch (err) {
    next(err);
  }
};

exports.deleteOrder = async (req, res, next) => {
  try {
    const order = await orderModel.findOrderById(Number(req.params.id));
    if (order) {
      await orderModel.deleteOrder(order.id);
      await activity.log({
        req,
        actorType: 'staff',
        actorId: req.session.staff.id,
        actorName: req.session.staff.name,
        action: 'order.deleted',
        entityType: 'order',
        entityId: order.id,
        description: `Order ${order.order_number} deleted.`,
      });
      req.session.flashSuccess = `Order ${order.order_number} deleted.`;
    }
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/orders`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Customers
// ===========================================================================

exports.customers = async (req, res, next) => {
  try {
    const { page } = fromQuery(req.query, 20);

    const result = await userModel.listCustomers({
      page,
      perPage: 20,
      search: clean.str(req.query.q || '', 120),
      status: clean.str(req.query.status, 20),
    });

    setNav(res, 'customers', { badges: await badgeCounts() });

    res.render('admin/customers', {
      layout: 'layouts/admin',
      pageTitle: 'Customers',
      pageSubtitle: 'Everyone who has bought from you.',
      customers: result.rows,
      pager: result,
      search: clean.str(req.query.q || '', 120),
      activeStatus: clean.str(req.query.status, 20),
      seo: { ...res.locals.seo, title: 'Customers', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.customerDetail = async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    const profile = await userModel.customerProfile(customerId);

    if (!profile || !profile.customer) {
      req.session.flashError = 'Customer not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/customers`));
    }

    setNav(res, 'customers', { badges: await badgeCounts() });

    res.render('admin/customer-detail', {
      layout: 'layouts/admin',
      pageTitle: profile.customer.name,
      pageSubtitle: profile.customer.email,
      customer: profile.customer,
      orders: profile.orders,
      payments: profile.payments,
      tickets: profile.tickets,
      subscriptions: profile.subscriptions,
      seo: { ...res.locals.seo, title: profile.customer.name, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    const patch = {};

    if (req.body.name) patch.name = clean.str(req.body.name, 120);
    if (req.body.phone !== undefined) patch.phone = clean.str(req.body.phone, 30) || null;
    if (req.body.company !== undefined) patch.company = clean.str(req.body.company, 150) || null;
    if (req.body.address !== undefined) patch.address = clean.str(req.body.address, 255) || null;
    if (req.body.city !== undefined) patch.city = clean.str(req.body.city, 80) || null;
    if (req.body.country !== undefined) patch.country = clean.str(req.body.country, 80) || null;
    if (['active', 'suspended'].includes(req.body.status)) patch.status = req.body.status;

    if (Object.keys(patch).length) {
      await userModel.updateCustomer(customerId, patch);

      await activity.log({
        req,
        actorType: 'staff',
        actorId: req.session.staff.id,
        actorName: req.session.staff.name,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: customerId,
        description: `Customer record updated (${Object.keys(patch).join(', ')}).`,
      });
    }

    req.session.flashSuccess = 'Customer updated.';
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/customers/${customerId}`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Payments
// ===========================================================================

exports.payments = async (req, res, next) => {
  try {
    const { page } = fromQuery(req.query, 20);

    const [result, counts] = await Promise.all([
      orderModel.listPayments({
        page,
        perPage: 20,
        status: clean.str(req.query.status, 20),
        method: clean.str(req.query.method, 60),
        search: clean.str(req.query.q || '', 120),
      }),
      orderModel.paymentCounts(),
    ]);

    setNav(res, 'payments', { badges: await badgeCounts() });

    res.render('admin/payments', {
      layout: 'layouts/admin',
      pageTitle: 'Payments',
      pageSubtitle: 'Verify manual transfers and card payments.',
      payments: result.rows,
      pager: result,
      counts,
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Payments', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.approvePayment = async (req, res, next) => {
  try {
    const payment = await orderModel.findPaymentById(Number(req.params.id));
    if (!payment) {
      req.session.flashError = 'Payment not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/payments`));
    }

    await orderModel.approvePayment(payment.id, {
      reviewerId: req.session.staff.id,
      note: clean.text(req.body.note, 500) || null,
    });

    await activity.log({
      req,
      actorType: 'staff',
      actorId: req.session.staff.id,
      actorName: req.session.staff.name,
      action: 'payment.approved',
      entityType: 'payment',
      entityId: payment.id,
      description: `Payment ${payment.transaction_id || payment.id} of ${payment.amount} approved.`,
    });

    const customer = await userModel.findCustomerById(payment.customer_id);
    mail.sendPaymentReceived(customer, payment).catch(() => {});

    // Optionally activate the order automatically once it is paid for - the
    // setting exists because some operators prefer to start work on payment.
    if (payment.order_id && settings.getBool('order_auto_activate_payment')) {
      const order = await orderModel.findOrderById(payment.order_id);
      if (order && order.status === 'pending') {
        await orderModel.updateOrderStatus(order.id, 'in_progress', {
          actor: { req, type: 'staff', id: req.session.staff.id, name: req.session.staff.name },
          note: 'Started automatically after payment approval.',
        });
      }
    }

    req.session.flashSuccess = 'Payment approved and the customer has been notified.';
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/payments`));
  } catch (err) {
    next(err);
  }
};

exports.rejectPayment = async (req, res, next) => {
  try {
    const payment = await orderModel.findPaymentById(Number(req.params.id));
    if (!payment) {
      req.session.flashError = 'Payment not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/payments`));
    }

    const note = clean.text(req.body.note, 500);

    await orderModel.rejectPayment(payment.id, {
      reviewerId: req.session.staff.id,
      note: note || 'Could not be verified.',
    });

    await activity.log({
      req,
      actorType: 'staff',
      actorId: req.session.staff.id,
      actorName: req.session.staff.name,
      action: 'payment.rejected',
      entityType: 'payment',
      entityId: payment.id,
      description: `Payment ${payment.transaction_id || payment.id} rejected. ${note || ''}`.trim(),
    });

    const customer = await userModel.findCustomerById(payment.customer_id);
    mail.sendPaymentRejected(customer, { ...payment, admin_note: note }).catch(() => {});

    req.session.flashSuccess = 'Payment rejected and the customer has been told why.';
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/payments`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Customer photo
// ===========================================================================

/**
 * Replace a customer's profile photo from the admin panel.
 *
 * Staff often need to set or correct a customer's photo for them, and the
 * customer record screen showed the avatar without offering any way to change
 * it. Its own route because the record form posts urlencoded.
 */
exports.updateCustomerAvatar = async (req, res, next) => {
  const id = Number(req.params.id);
  const back = () =>
    res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/customers/${id}`));

  try {
    const customer = await userModel.findCustomerById(id);
    if (!customer) {
      req.session.flashError = 'Customer not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/customers`));
    }

    if (!req.files || !req.files.length) {
      req.session.flashError = 'Choose an image to upload.';
      return back();
    }

    const saved = await storage.recordMedia(req.files, {
      folder: 'avatars',
      uploaderId: req.session.staff ? req.session.staff.id : null,
      uploaderType: 'staff',
    });

    if (!saved.length) {
      req.session.flashError = 'That image could not be saved. Please try another.';
      return back();
    }

    await userModel.updateCustomer(id, { avatar: saved[0].file_url });

    // Remove the previous photo so uploads do not accumulate.
    if (customer.avatar && customer.avatar !== saved[0].file_url) {
      storage
        .removeFile(customer.avatar.replace(`${config.uploads.publicPath}/`, ''))
        .catch(() => {});
      db.query('DELETE FROM media WHERE file_url = ?', [customer.avatar]).catch(() => {});
    }

    await activity.log({
      req,
      action: 'customer.avatar_updated',
      entityType: 'customer',
      entityId: id,
      description: `Updated the profile photo for ${customer.name}.`,
    });

    req.session.flashSuccess = `${customer.name}'s photo updated.`;
    return back();
  } catch (err) {
    return next(err);
  }
};

// ===========================================================================
// Settings
// ===========================================================================

/**
 * Where the settings screen's `type: 'file'` uploads are stored. One folder for
 * all of them, because the settings registry does not declare a folder per
 * field and logos/favicons are all brand assets.
 */
const UPLOAD_FOLDER_FOR_FILES = 'logos';

/**
 * Paths the admin slug must never be set to.
 *
 * If the panel were mounted at /assets or /uploads it would shadow static
 * files and the site would render unstyled; at /account or /auth it would
 * hijack the customer area; at /api it would swallow the chat endpoint.
 */
const RESERVED_SLUGS = new Set([
  'assets', 'uploads', 'api', 'account', 'auth', 'signin', 'signup', 'signout',
  'login', 'logout', 'verify-email', 'forgot-password', 'reset-password',
  'about', 'services', 'portfolio', 'contact', 'live-chat', 'page',
  'privacy-policy', 'terms-conditions', 'refund-policy',
  'healthz', 'maintenance', 'admin', 'wp-admin', 'wp-login', 'robots.txt',
  'sitemap.xml', 'favicon.ico',
]);

const SETTINGS_GROUPS = Object.keys(settingsSchema.GROUP_LABELS);

/** Which group tab is being viewed, falling back to General. */
function resolveGroup(query) {
  const requested = String(query || '');
  return SETTINGS_GROUPS.includes(requested) ? requested : 'general';
}

/**
 * Environment fallbacks for the settings that can also come from .env.
 *
 * `settings.secret()` prefers a stored value and falls back to the environment.
 * The panel has to know which one is in play: without this it reported "Not
 * set" for a credential that was fully working from .env, which reads as
 * "my save did not stick".
 */
const ENV_FALLBACKS = {
  captcha_site_key: () => config.recaptcha.siteKey,
  captcha_secret_key: () => config.recaptcha.secretKey,
  google_client_id: () => config.google.clientId,
  google_client_secret: () => config.google.clientSecret,
  smtp_password: () => config.smtp.password,
  chat_api_key: () => config.chat.apiKey,
};

/**
 * A partially masked preview of a stored secret.
 *
 * Confirms *which* credential is saved without sending the whole thing to the
 * browser. Showing the first and last few characters is what payment and cloud
 * providers do, and it is enough for an operator to recognise their own key.
 */
function maskSecret(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 12) return '•'.repeat(raw.length);
  return `${raw.slice(0, 6)}${'•'.repeat(6)}${raw.slice(-4)}`;
}

/**
 * Build the render payload for one settings group.
 *
 * Secrets are never sent in full: the browser is told whether a value is
 * stored, where it came from, and a masked preview - never the value itself.
 */
async function settingsView(res, { group, errors = null }) {
  const values = await settings.loadAll(true);
  const defs = settingsSchema.BY_GROUP[group] || [];

  const fields = defs.map((def) => {
    const isSecret = settingsSchema.SECRET_KEYS.has(def.key);
    const stored = values[def.key];
    const storedText = stored === undefined || stored === null ? '' : String(stored);

    // Does an environment variable provide this, when nothing is stored?
    const envValue = ENV_FALLBACKS[def.key] ? String(ENV_FALLBACKS[def.key]() || '') : '';
    const fromEnv = !storedText.trim() && Boolean(envValue.trim());
    const effective = storedText.trim() ? storedText : envValue;

    return {
      key: def.key,
      label: def.label,
      type: def.type,
      help: def.help || '',
      options: def.options || null,
      isSecret,
      // A secret's real value never leaves the server.
      value: isSecret ? '' : storedText || def.default,
      hasValue: Boolean(storedText.trim()),
      fromEnv,
      // Enough to recognise the credential, not enough to use it.
      masked: isSecret ? maskSecret(effective) : '',
      // True when the feature will work, whether from the database or .env.
      effective: Boolean(effective.trim()),
    };
  });

  return {
    group,
    groups: SETTINGS_GROUPS.map((key) => ({
      key,
      label: settingsSchema.GROUP_LABELS[key],
      count: (settingsSchema.BY_GROUP[key] || []).length,
    })),
    fields,
    errors,
    // Surfaced so the UI can warn when a toggle is on but has no credentials.
    captchaConfigured: Boolean(
      settings.secret('captcha_site_key', config.recaptcha.siteKey) &&
        settings.secret('captcha_secret_key', config.recaptcha.secretKey)
    ),
    googleConfigured: Boolean(
      settings.secret('google_client_id', config.google.clientId) &&
        settings.secret('google_client_secret', config.google.clientSecret)
    ),
  };
}

exports.settings = async (req, res, next) => {
  try {
    const group = resolveGroup(req.query.group);

    setNav(res, 'settings', { badges: await badgeCounts() });

    res.render('admin/settings', {
      layout: 'layouts/admin',
      pageTitle: 'Settings',
      pageSubtitle: 'Configure the site, integrations and security.',
      ...(await settingsView(res, { group })),
      seo: { ...res.locals.seo, title: 'Settings', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Save one group.
 *
 * Booleans are the subtle part: an unchecked checkbox submits nothing at all,
 * so absence has to mean OFF rather than "unchanged". Every boolean in the
 * group is therefore written explicitly on each save.
 */
exports.saveSettings = async (req, res, next) => {
  const group = resolveGroup(req.body.group);

  try {
    const defs = settingsSchema.BY_GROUP[group] || [];
    const pairs = {};
    const errors = {};
    // Files uploaded in this request, recorded in the media library afterwards.
    const uploadedFiles = [];
    // Brand assets replaced or cleared by this save, deleted from disk after a
    // successful write so the uploads folder does not accumulate orphans.
    const filesToRemove = [];

    for (const def of defs) {
      const isSecret = settingsSchema.SECRET_KEYS.has(def.key);

      if (def.type === 'boolean') {
        pairs[def.key] = req.body[def.key] ? '1' : '0';
        continue;
      }

      // --- File uploads (logos, favicon) ------------------------------------
      //
      // The file input for a file setting is named after the setting key, so
      // multer's `.any()` leaves it on `file.fieldname` and it can be matched
      // back here. Uploading replaces the value; ticking the "remove" box
      // clears it; doing neither leaves the stored value untouched, so saving
      // an unrelated field on the Branding tab cannot wipe a logo.
      if (def.type === 'file') {
        const uploaded = (req.files || []).find((f) => f.fieldname === def.key);
        // What is stored now, so a replaced or cleared file can be tidied up.
        const current = String(settings.get(def.key, '') || '');

        if (uploaded) {
          // Same resolver the route used to place the file, so the URL cannot
          // point somewhere the file is not.
          const folder = storage.settingsUploadFolder(def.key);
          pairs[def.key] = `${config.uploads.publicPath}/${folder}/${uploaded.filename}`;
          uploadedFiles.push(uploaded);
          // Replacing a logo leaves the previous file behind otherwise.
          if (current.startsWith(config.uploads.publicPath)) filesToRemove.push(current);
          continue;
        }

        if (req.body[`clear_${def.key}`]) {
          // Delete the file as well as clearing the setting, or every removal
          // leaves an orphan in the uploads folder that nothing points at.
          if (current.startsWith(config.uploads.publicPath)) filesToRemove.push(current);
          pairs[def.key] = '';
          continue;
        }

        continue;
      }

      const raw = req.body[def.key];
      const value = raw === undefined || raw === null ? '' : String(raw).trim();

      if (isSecret) {
        // Blank means "keep what is stored". Otherwise saving any other field
        // on this tab would silently erase the credential.
        if (!value) continue;
        pairs[def.key] = value;
        continue;
      }

      if (def.type === 'number') {
        if (value === '') {
          errors[def.key] = `${def.label} is required.`;
          continue;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          errors[def.key] = `${def.label} must be a positive number.`;
          continue;
        }
        pairs[def.key] = String(Math.floor(parsed));
        continue;
      }

      if (def.type === 'select') {
        if (Array.isArray(def.options) && def.options.length && !def.options.includes(value)) {
          errors[def.key] = `${def.label} must be one of: ${def.options.join(', ')}.`;
          continue;
        }
        pairs[def.key] = value;
        continue;
      }

      pairs[def.key] = value;
    }

    // --- Admin slug: the one setting that can lock you out if it is wrong ---
    let slugChangedTo = null;
    if (group === 'security' && pairs.admin_path_slug !== undefined) {
      const slug = String(pairs.admin_path_slug).toLowerCase().replace(/^\/+|\/+$/g, '');

      if (!/^[a-z0-9][a-z0-9-]{1,58}$/.test(slug)) {
        errors.admin_path_slug =
          'Use 2-59 lowercase letters, numbers or hyphens, starting with a letter or number.';
      } else if (RESERVED_SLUGS.has(slug)) {
        errors.admin_path_slug =
          `"${slug}" is reserved by the site and cannot be used for the admin panel.`;
      } else {
        pairs.admin_path_slug = slug;
        if (slug !== settings.get('admin_path_slug', 'dev-cp')) slugChangedTo = slug;
      }
    }

    if (Object.keys(errors).length) {
      setNav(res, 'settings', { badges: await badgeCounts() });
      return res.status(422).render('admin/settings', {
        layout: 'layouts/admin',
        pageTitle: 'Settings',
        pageSubtitle: 'Configure the site, integrations and security.',
        ...(await settingsView(res, { group, errors })),
        seo: { ...res.locals.seo, title: 'Settings', robots: 'noindex,nofollow' },
      });
    }

    const saved = await settings.saveMany(pairs);

    // Catalogue any uploaded brand assets so they appear in the media library
    // rather than becoming orphaned files nobody can find.
    for (const file of uploadedFiles) {
      try {
        const records = storage.toMediaRecords([file], {
          folder: UPLOAD_FOLDER_FOR_FILES,
          uploaderId: req.session.staff ? req.session.staff.id : null,
          uploaderType: 'staff',
        });
        for (const record of records) await storage.recordMedia(record);
      } catch (err) {
        // A media-table failure must not fail the settings save.
        logger.warn('Failed to record an uploaded brand asset', err);
      }
    }

    // Delete replaced or cleared brand assets, and their media rows. Done after
    // the settings write, so a failed save never destroys the live file.
    for (const url of filesToRemove) {
      const relative = url.replace(`${config.uploads.publicPath}/`, '');
      try {
        await storage.removeFile(relative);
        await db.query('DELETE FROM media WHERE file_url = ?', [url]);
      } catch (err) {
        logger.warn('Could not remove a replaced brand asset', { url, error: err.message });
      }
    }

    // Record it - a settings change is security-relevant, and this is the audit
    // trail for "who turned the CAPTCHA off".
    await activity.log({
      req,
      action: 'settings.updated',
      entityType: 'settings',
      description: `Updated ${settingsSchema.GROUP_LABELS[group] || group} settings (${saved} value${
        saved === 1 ? '' : 's'
      }).`,
    });

    // Changing the slug moves the panel. Redirect to the new address, or the
    // operator lands on a 404 at the path they were just using.
    if (slugChangedTo) {
      req.session.flashSuccess = `Settings saved. The admin panel now lives at /${slugChangedTo}/settings.`;
      return res.redirect(res.locals.helpers.url(`/${slugChangedTo}/settings?group=security`));
    }

    req.session.flashSuccess = `${settingsSchema.GROUP_LABELS[group] || group} settings saved.`;
    return res.redirect(
      res.locals.helpers.url(`${res.locals.adminPath}/settings?group=${group}`)
    );
  } catch (err) {
    next(err);
  }
};

// badgeCounts is shared: every admin screen renders the sidebar, and the
// sidebar shows pending counts. Exported so other admin controllers (the CMS
// screens, for instance) can supply the same data without re-querying it.
exports.badgeCounts = badgeCounts;

module.exports = exports;
