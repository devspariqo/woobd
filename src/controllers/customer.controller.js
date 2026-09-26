/**
 * Customer dashboard: overview, orders, checkout, payments, subscriptions,
 * invoices, tickets, profile and security.
 */
'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const userModel = require('../models/user.model');
const orderModel = require('../models/order.model');
const contentModel = require('../models/content.model');
const settings = require('../services/settings.service');
const mail = require('../services/mail.service');
const activity = require('../services/activity.service');
const storage = require('../lib/storage');
const captcha = require('../middleware/captcha');
const { clean, validate } = require('../utils/validators');
const { fromQuery } = require('../utils/paginator');
const config = require('../config');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

/**
 * The monthly rate a package is actually sold at.
 *
 * `sale_price` wins when it is set and greater than zero, which is how a
 * discounted monthly rate is expressed.
 */
function monthlyRate(service) {
  const sale = Number(service.sale_price);
  return sale > 0 ? sale : Number(service.price);
}

/**
 * The terms a customer may choose, in months.
 *
 * Starts at the package's minimum commitment. Twelve months earns the yearly
 * discount, so it is always offered. Six is the natural midpoint.
 */
function termOptions(minMonths) {
  const min = Math.max(1, Number(minMonths) || 1);
  return [...new Set([min, 6, 12])]
    .filter((months) => months >= min)
    .sort((a, b) => a - b);
}

/**
 * Price an order for a given term.
 *
 * The yearly discount applies only at twelve months or more. Kept in one place
 * so the checkout form, the submit handler and the seeded demo orders cannot
 * disagree about what a customer owes.
 */
function priceOrder(monthly, termMonths, yearlyDiscountPercent) {
  const term = Math.max(1, Number(termMonths) || 1);
  const gross = Number(monthly) * term;
  const percent = term >= 12 ? Number(yearlyDiscountPercent) || 0 : 0;
  const discount = Math.round((gross * percent) / 100);
  return { term, gross, discount, percent, total: gross - discount };
}

/** Tell the layout which sidebar entry is active. */
function setNav(res, key, extra = {}) {
  res.locals.navActive = key;
  Object.assign(res.locals, extra);
}

/** Load sidebar counters so the badges are always current. */
async function navCounts(customerId) {
  const [orders, tickets] = await Promise.all([
    orderModel.orderCounts(customerId),
    orderModel.ticketCounts(customerId),
  ]);
  return {
    orders: orders ? Number(orders.pending) + Number(orders.in_progress) : 0,
    tickets: tickets ? Number(tickets.open) + Number(tickets.pending) : 0,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

exports.dashboard = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;

    const [orderStats, payments, tickets, subscriptions, recentOrders, user] = await Promise.all([
      orderModel.orderCounts(customerId),
      orderModel.listPayments({ customerId, perPage: 5 }),
      orderModel.ticketCounts(customerId),
      orderModel.listSubscriptions({ customerId, status: 'active', perPage: 5 }),
      orderModel.recentOrders(5, customerId),
      userModel.findCustomerById(customerId),
    ]);

    // Surface live sites the customer can access straight away.
    const liveOrders = recentOrders.filter((order) => order.status === 'active');
    const deliverables = liveOrders.length
      ? await orderModel.listDeliverables(liveOrders[0].id)
      : [];

    setNav(res, 'dashboard', { navCounts: await navCounts(customerId) });

    res.render('customer/dashboard', {
      layout: 'layouts/dashboard',
      pageTitle: 'Dashboard',
      pageSubtitle: `Welcome back, ${req.session.customer.name.split(' ')[0]}`,
      orderStats,
      payments: payments.rows,
      ticketStats: tickets,
      subscriptions: subscriptions.rows,
      recentOrders,
      liveOrders,
      deliverables,
      customer: { ...req.session.customer, ...user },
      seo: { ...res.locals.seo, title: 'Dashboard', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

exports.orders = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const { page } = fromQuery(req.query, 10);
    const status = clean.str(req.query.status, 20);

    const result = await orderModel.listOrders({
      page,
      perPage: 10,
      customerId,
      status,
      search: clean.str(req.query.q || '', 120),
    });

    const counts = await orderModel.orderCounts(customerId);

    setNav(res, 'orders', { navCounts: await navCounts(customerId) });

    res.render('customer/orders', {
      layout: 'layouts/dashboard',
      pageTitle: 'My Orders',
      pageSubtitle: 'Track every project you have ordered from us.',
      orders: result.rows,
      pager: result,
      counts,
      activeStatus: status,
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'My Orders', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.orderDetail = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const detail = await orderModel.orderDetail(Number(req.params.id));

    // Ownership check - without it any signed-in customer could read another's
    // credentials by guessing an id.
    if (!detail || detail.order.customer_id !== customerId) {
      return res.status(404).render('errors/404', {
        layout: 'layouts/dashboard',
        title: 'Order not found',
        pageTitle: 'Order not found',
        requestedPath: req.originalUrl,
        navActive: 'orders',
        navCounts: await navCounts(customerId),
      });
    }

    setNav(res, 'orders', { navCounts: await navCounts(customerId) });

    res.render('customer/order-detail', {
      layout: 'layouts/dashboard',
      pageTitle: `Order ${detail.order.order_number}`,
      pageSubtitle: detail.order.service_title,
      order: detail.order,
      deliverables: detail.deliverables.filter((item) => item.is_visible),
      allDeliverables: detail.deliverables,
      payments: detail.payments,
      invoices: detail.invoices,
      invoiceItems: detail.invoiceItems,
      subscription: detail.subscription,
      timeline: detail.timeline,
      seo: { ...res.locals.seo, title: `Order ${detail.order.order_number}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

exports.checkoutForm = async (req, res, next) => {
  try {
    const service = await contentModel.findServiceById(Number(req.params.serviceId));

    if (!service || service.status !== 'active') {
      req.session.flashError = 'That package is no longer available.';
      return res.redirect(res.locals.helpers.url('/services'));
    }

    const customerId = req.session.customer.id;
    const user = await userModel.findCustomerById(customerId);

    // Recurring packages are sold by term. `one_time` packages have a single
    // period and no choices to make.
    const isRecurring = service.billing_cycle !== 'one_time';
    const minMonths = isRecurring ? Math.max(1, Number(service.min_months) || 1) : 1;
    const options = isRecurring ? termOptions(minMonths) : [1];
    const rate = monthlyRate(service);

    // Pre-select the shortest term: it is the smallest commitment and the
    // clearest starting point.
    const defaultTerm = options[0];
    const quote = priceOrder(rate, defaultTerm, service.yearly_discount_percent);

    const taxPercent = settings.getInt('tax_percent', 0);
    const tax = taxPercent > 0 ? (quote.total * taxPercent) / 100 : 0;

    setNav(res, 'orders', { navCounts: await navCounts(customerId) });

    res.render('customer/checkout', {
      layout: 'layouts/dashboard',
      pageTitle: 'Complete Your Order',
      pageSubtitle: service.title,
      service,
      customer: { ...req.session.customer, ...user },
      isRecurring,
      rate,
      minMonths,
      termOptions: options,
      yearlyDiscount: Number(service.yearly_discount_percent) || 0,
      quote,
      term: defaultTerm,
      taxPercent,
      tax,
      total: quote.total + tax,
      errors: null,
      form: null,
      seo: { ...res.locals.seo, title: 'Checkout', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.checkoutSubmit = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const service = await contentModel.findServiceById(Number(req.body.service_id));

    if (!service || service.status !== 'active') {
      req.session.flashError = 'That package is no longer available.';
      return res.redirect(res.locals.helpers.url('/services'));
    }

    const form = {
      requirements: clean.text(req.body.requirements, 4000),
      domain_name: clean.str(req.body.domain_name, 191),
      notes: clean.text(req.body.notes, 2000),
      agree: req.body.agree,
    };

    // Recurring packages are ordered by term. The minimum is the package's own
    // commitment, so it is enforced here rather than trusted from the form - a
    // tampered value would otherwise let a customer buy below the minimum.
    const isRecurring = service.billing_cycle !== 'one_time';
    const minMonths = isRecurring ? Math.max(1, Number(service.min_months) || 1) : 1;
    const options = isRecurring ? termOptions(minMonths) : [1];

    const requested = Number(req.body.term_months);
    const term = options.includes(requested) ? requested : options[0];

    const rate = monthlyRate(service);
    const quote = priceOrder(rate, term, service.yearly_discount_percent);

    // A term order is billed monthly unless the whole year was paid up front.
    const billingCycle = isRecurring ? (term >= 12 ? 'yearly' : 'monthly') : 'one_time';
    form.billing_cycle = billingCycle;

    const errors = {};
    if (!form.requirements || form.requirements.length < 10) {
      errors.requirements = 'Please tell us a little about your business and what you need (at least 10 characters).';
    }
    if (isRecurring && requested && requested < minMonths) {
      errors.term_months = `This package has a minimum term of ${minMonths} months.`;
    }
    if (!form.agree) {
      errors.agree = 'Please confirm the order details are correct.';
    }

    const customer = await userModel.findCustomerById(customerId);
    const taxPercent = settings.getInt('tax_percent', 0);
    const tax = taxPercent > 0 ? (quote.total * taxPercent) / 100 : 0;
    const total = quote.total + tax;

    if (Object.keys(errors).length) {
      setNav(res, 'orders', { navCounts: await navCounts(customerId) });
      return res.status(400).render('customer/checkout', {
        layout: 'layouts/dashboard',
        pageTitle: 'Complete Your Order',
        pageSubtitle: service.title,
        service,
        customer,
        isRecurring,
        rate,
        minMonths,
        termOptions: options,
        yearlyDiscount: Number(service.yearly_discount_percent) || 0,
        quote,
        term,
        taxPercent,
        tax,
        total,
        errors,
        form,
        seo: { ...res.locals.seo, title: 'Checkout', robots: 'noindex,nofollow' },
      });
    }

    const orderNumber = await activity.numbers.order();
    const deliveryDays = settings.getInt('default_delivery_days', 7);

    const orderId = await orderModel.createOrder({
      order_number: orderNumber,
      customer_id: customerId,
      service_id: service.id,
      service_title: service.title,
      billing_cycle: form.billing_cycle,
      // `amount` is the undiscounted total for the term; `discount` records what
      // the yearly rate saved, so the invoice can show it as a line.
      term_months: quote.term,
      amount: quote.gross,
      discount: quote.discount,
      total,
      currency: settings.get('currency_code', 'BDT'),
      status: 'pending',
      payment_status: 'unpaid',
      requirements: form.requirements,
      notes: form.notes,
      domain_name: form.domain_name || null,
      due_at: new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000),
    });

    // A recurring package gets its subscription row now, so the term and the
    // next billing date are visible from day one.
    if (isRecurring) {
      const next = new Date();
      next.setMonth(next.getMonth() + quote.term);

      await orderModel.createSubscription({
        customer_id: customerId,
        order_id: orderId,
        service_id: service.id,
        plan_name: service.title,
        amount: rate,
        billing_cycle: form.billing_cycle,
        status: 'active',
        started_at: new Date().toISOString().slice(0, 10),
        next_billing_at: next.toISOString().slice(0, 10),
      });
    }

    // Issue the invoice immediately so the customer has something to pay against.
    const invoiceNumber = await activity.numbers.invoice();
    const invoiceId = await orderModel.createInvoice({
      invoice_number: invoiceNumber,
      customer_id: customerId,
      order_id: orderId,
      subtotal: quote.gross,
      tax,
      total,
      currency: settings.get('currency_code', 'BDT'),
      status: 'unpaid',
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      notes: `Payment for ${service.title} — ${quote.term} month${quote.term === 1 ? '' : 's'} (order ${orderNumber}).`,
    });

    await orderModel.createInvoiceItem({
      invoice_id: invoiceId,
      description:
        quote.term === 1
          ? service.title
          : `${service.title} — ${quote.term} months at ৳${rate.toLocaleString('en-US')}/month`,
      quantity: quote.term,
      unit_price: rate,
      amount: quote.gross,
    });

    // Shown as its own line so the customer can see the saving, not just a
    // smaller total.
    if (quote.discount > 0) {
      await orderModel.createInvoiceItem({
        invoice_id: invoiceId,
        description: `Yearly discount (${quote.percent}% off 12 months)`,
        quantity: 1,
        unit_price: -quote.discount,
        amount: -quote.discount,
      });
    }

    if (tax > 0) {
      await orderModel.createInvoiceItem({
        invoice_id: invoiceId,
        description: `VAT (${taxPercent}%)`,
        quantity: 1,
        unit_price: tax,
        amount: tax,
      });
    }

    await activity.log({
      req,
      action: 'order.created',
      entityType: 'order',
      entityId: orderId,
      description: `Order ${orderNumber} placed for ${service.title}.`,
    });

    const order = await orderModel.findOrderById(orderId);
    Promise.allSettled([
      mail.sendOrderConfirmation(customer, order),
      mail.sendAdminNewOrder(order, customer),
    ]).catch(() => {});

    req.session.flashSuccess = `Order ${orderNumber} placed. Submit your payment to get started.`;
    return res.redirect(res.locals.helpers.url(`/account/orders/${orderId}`));
  } catch (err) {
    logger.error('Checkout failed', err);
    req.session.flashError = 'We could not place your order just now. Please try again.';
    return res.redirect(res.locals.helpers.url(`/account/checkout/${req.body.service_id}`));
  }
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

exports.payments = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const { page } = fromQuery(req.query, 15);

    const result = await orderModel.listPayments({
      page,
      perPage: 15,
      customerId,
      status: clean.str(req.query.status, 20),
    });

    setNav(res, 'payments', { navCounts: await navCounts(customerId) });

    res.render('customer/payments', {
      layout: 'layouts/dashboard',
      pageTitle: 'My Payments',
      pageSubtitle: 'Every payment you have submitted, and its verification status.',
      payments: result.rows,
      pager: result,
      activeStatus: clean.str(req.query.status, 20),
      seo: { ...res.locals.seo, title: 'My Payments', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitPaymentForm = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const order = await orderModel.findOrderById(Number(req.params.id));

    if (!order || order.customer_id !== customerId) {
      req.session.flashError = 'Order not found.';
      return res.redirect(res.locals.helpers.url('/account/orders'));
    }

    setNav(res, 'orders', { navCounts: await navCounts(customerId) });

    res.render('customer/payment-submit', {
      layout: 'layouts/dashboard',
      pageTitle: 'Submit Payment',
      pageSubtitle: `Order ${order.order_number}`,
      order,
      errors: null,
      form: null,
      seo: { ...res.locals.seo, title: 'Submit Payment', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitPayment = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const order = await orderModel.findOrderById(Number(req.body.order_id));

    if (!order || order.customer_id !== customerId) {
      req.session.flashError = 'Order not found.';
      return res.redirect(res.locals.helpers.url('/account/orders'));
    }

    const form = {
      method: clean.str(req.body.method, 60),
      transaction_id: clean.str(req.body.transaction_id, 120),
      sender_number: clean.str(req.body.sender_number, 30),
      amount: clean.decimal(req.body.amount),
      note: clean.text(req.body.note, 500),
    };

    const allowedMethods = [];
    if (settings.getBool('payment_bkash_enabled')) allowedMethods.push('bKash');
    if (settings.getBool('payment_nagad_enabled')) allowedMethods.push('Nagad');
    if (settings.getBool('payment_rocket_enabled')) allowedMethods.push('Rocket');
    if (settings.getBool('payment_card_enabled')) allowedMethods.push('Card');

    const errors = {};
    if (!form.method || !allowedMethods.includes(form.method)) {
      errors.method = 'Please choose how you paid.';
    }
    if (!form.transaction_id) errors.transaction_id = 'Enter the transaction ID from your payment receipt.';
    if (form.amount <= 0) errors.amount = 'Enter the amount you sent.';

    if (Object.keys(errors).length) {
      setNav(res, 'orders', { navCounts: await navCounts(customerId) });
      return res.status(400).render('customer/payment-submit', {
        layout: 'layouts/dashboard',
        pageTitle: 'Submit Payment',
        pageSubtitle: `Order ${order.order_number}`,
        order,
        errors,
        form,
        seo: { ...res.locals.seo, title: 'Submit Payment', robots: 'noindex,nofollow' },
      });
    }

    const files = req.files && req.files.length ? req.files : [];
    const saved = files.length
      ? await storage.recordMedia(files, { folder: 'payments', uploaderId: customerId, uploaderType: 'customer' })
      : [];

    const paymentId = await orderModel.createPayment({
      customer_id: customerId,
      order_id: order.id,
      method: form.method,
      method_type: form.method === 'Card' ? 'card' : 'manual',
      amount: form.amount,
      currency: settings.get('currency_code', 'BDT'),
      transaction_id: form.transaction_id,
      sender_number: form.sender_number || null,
      screenshot: saved.length ? saved[0].file_url : null,
      status: 'pending',
      admin_note: form.note || null,
    });

    await activity.log({
      req,
      action: 'payment.submitted',
      entityType: 'payment',
      entityId: paymentId,
      description: `Payment of ${form.amount} submitted via ${form.method} for order ${order.order_number}.`,
    });

    // Optionally auto-approve, for operators who reconcile out of band.
    if (settings.getBool('order_auto_activate_payment')) {
      await orderModel.approvePayment(paymentId, { note: 'Auto-approved by setting.' });
    }

    req.session.flashSuccess = 'Payment submitted. We verify transfers within 24 hours.';
    return res.redirect(res.locals.helpers.url(`/account/orders/${order.id}`));
  } catch (err) {
    logger.error('Payment submission failed', err);
    req.session.flashError = 'We could not record your payment just now. Please try again.';
    return res.redirect(res.locals.helpers.url(`/account/orders/${req.body.order_id}`));
  }
};

// ---------------------------------------------------------------------------
// Subscriptions & invoices
// ---------------------------------------------------------------------------

exports.subscriptions = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const { page } = fromQuery(req.query, 15);

    const result = await orderModel.listSubscriptions({ page, perPage: 15, customerId });

    setNav(res, 'subscriptions', { navCounts: await navCounts(customerId) });

    res.render('customer/subscriptions', {
      layout: 'layouts/dashboard',
      pageTitle: 'Subscriptions',
      pageSubtitle: 'Recurring plans attached to your account.',
      subscriptions: result.rows,
      pager: result,
      seo: { ...res.locals.seo, title: 'Subscriptions', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.cancelSubscription = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const subscription = await orderModel.findSubscriptionById(Number(req.params.id));

    if (!subscription || subscription.customer_id !== customerId) {
      req.session.flashError = 'Subscription not found.';
      return res.redirect(res.locals.helpers.url('/account/subscriptions'));
    }

    await orderModel.updateSubscription(subscription.id, {
      status: 'cancelled',
      cancelled_at: new Date(),
    });

    await activity.log({
      req,
      action: 'subscription.cancelled',
      entityType: 'subscription',
      entityId: subscription.id,
      description: `Customer cancelled subscription ${subscription.plan_name}.`,
    });

    req.session.flashSuccess =
      'Your subscription is cancelled. Service continues until the end of the current paid period.';
    return res.redirect(res.locals.helpers.url('/account/subscriptions'));
  } catch (err) {
    next(err);
  }
};

exports.invoices = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const { page } = fromQuery(req.query, 15);

    const result = await orderModel.listInvoices({
      page,
      perPage: 15,
      customerId,
      status: clean.str(req.query.status, 20),
    });

    setNav(res, 'invoices', { navCounts: await navCounts(customerId) });

    res.render('customer/invoices', {
      layout: 'layouts/dashboard',
      pageTitle: 'My Invoices',
      pageSubtitle: 'Download or print any invoice for your records.',
      invoices: result.rows,
      pager: result,
      activeStatus: clean.str(req.query.status, 20),
      seo: { ...res.locals.seo, title: 'My Invoices', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.invoiceDetail = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const invoice = await orderModel.findInvoiceById(Number(req.params.id));

    if (!invoice || invoice.customer_id !== customerId) {
      return res.status(404).render('errors/404', {
        layout: 'layouts/dashboard',
        title: 'Invoice not found',
        pageTitle: 'Invoice not found',
        requestedPath: req.originalUrl,
        navActive: 'invoices',
        navCounts: await navCounts(customerId),
      });
    }

    const items = await orderModel.invoiceItems(invoice.id);

    // A dedicated, chrome-free layout so printing produces a clean document.
    res.render('customer/invoice-detail', {
      layout: 'layouts/print',
      pageTitle: `Invoice ${invoice.invoice_number}`,
      invoice,
      items,
      seo: { ...res.locals.seo, title: `Invoice ${invoice.invoice_number}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

exports.tickets = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const { page } = fromQuery(req.query, 15);

    const [result, counts] = await Promise.all([
      orderModel.listTickets({
        page,
        perPage: 15,
        customerId,
        status: clean.str(req.query.status, 20),
        search: clean.str(req.query.q || '', 120),
      }),
      orderModel.ticketCounts(customerId),
    ]);

    setNav(res, 'tickets', { navCounts: await navCounts(customerId) });

    res.render('customer/tickets', {
      layout: 'layouts/dashboard',
      pageTitle: 'Support Tickets',
      pageSubtitle: 'Ask a question or report a problem — we reply within one business day.',
      tickets: result.rows,
      pager: result,
      counts,
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Support Tickets', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.ticketForm = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const orders = await orderModel.listOrders({ customerId, perPage: 50 });

    setNav(res, 'tickets', { navCounts: await navCounts(customerId) });

    res.render('customer/ticket-new', {
      layout: 'layouts/dashboard',
      pageTitle: 'New Support Ticket',
      pageSubtitle: 'Describe the issue and we will get back to you.',
      orders: orders.rows,
      errors: null,
      form: null,
      seo: { ...res.locals.seo, title: 'New Ticket', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.createTicket = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const form = {
      subject: clean.str(req.body.subject, 250),
      department: ['general', 'billing', 'technical', 'sales'].includes(req.body.department)
        ? req.body.department
        : 'general',
      priority: ['low', 'medium', 'high', 'urgent'].includes(req.body.priority)
        ? req.body.priority
        : 'medium',
      message: clean.text(req.body.message, 8000),
      order_id: clean.int(req.body.order_id, { min: 0, fallback: 0 }) || null,
    };

    const errors = {};
    const subjectError = validate.length(form.subject, 5, 250, 'Subject');
    const messageError = validate.length(form.message, 15, 8000, 'Message');
    if (subjectError) errors.subject = subjectError;
    if (messageError) errors.message = messageError;

    if (Object.keys(errors).length) {
      const orders = await orderModel.listOrders({ customerId, perPage: 50 });
      setNav(res, 'tickets', { navCounts: await navCounts(customerId) });
      return res.status(400).render('customer/ticket-new', {
        layout: 'layouts/dashboard',
        pageTitle: 'New Support Ticket',
        pageSubtitle: 'Describe the issue and we will get back to you.',
        orders: orders.rows,
        errors,
        form,
        seo: { ...res.locals.seo, title: 'New Ticket', robots: 'noindex,nofollow' },
      });
    }

    const ticketNumber = await activity.numbers.ticket();
    const customer = req.session.customer;

    const ticketId = await orderModel.createTicket({
      ticket_number: ticketNumber,
      customer_id: customerId,
      order_id: form.order_id,
      subject: form.subject,
      department: form.department,
      priority: form.priority,
      status: 'open',
    });

    await orderModel.createTicketReply({
      ticket_id: ticketId,
      author_type: 'customer',
      author_id: customerId,
      author_name: customer.name,
      message: form.message,
    });

    await activity.log({
      req,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticketId,
      description: `Ticket ${ticketNumber} opened: ${form.subject}.`,
    });

    req.session.flashSuccess = `Ticket ${ticketNumber} created. We will reply by email.`;
    return res.redirect(res.locals.helpers.url(`/account/tickets/${ticketId}`));
  } catch (err) {
    logger.error('Ticket creation failed', err);
    req.session.flashError = 'We could not create your ticket. Please try again.';
    return res.redirect(res.locals.helpers.url('/account/tickets/new'));
  }
};

exports.ticketDetail = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const ticket = await orderModel.findTicketById(Number(req.params.id));

    if (!ticket || ticket.customer_id !== customerId) {
      return res.status(404).render('errors/404', {
        layout: 'layouts/dashboard',
        title: 'Ticket not found',
        pageTitle: 'Ticket not found',
        requestedPath: req.originalUrl,
        navActive: 'tickets',
        navCounts: await navCounts(customerId),
      });
    }

    const replies = await orderModel.ticketReplies(ticket.id);

    setNav(res, 'tickets', { navCounts: await navCounts(customerId) });

    res.render('customer/ticket-detail', {
      layout: 'layouts/dashboard',
      pageTitle: ticket.subject,
      pageSubtitle: `Ticket ${ticket.ticket_number}`,
      ticket,
      replies,
      errors: null,
      seo: { ...res.locals.seo, title: ticket.subject, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.replyTicket = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const ticket = await orderModel.findTicketById(Number(req.body.ticket_id));

    if (!ticket || ticket.customer_id !== customerId) {
      req.session.flashError = 'Ticket not found.';
      return res.redirect(res.locals.helpers.url('/account/tickets'));
    }

    const message = clean.text(req.body.message, 8000);
    if (!message || message.length < 2) {
      req.session.flashError = 'Please type a reply before sending.';
      return res.redirect(res.locals.helpers.url(`/account/tickets/${ticket.id}`));
    }

    const files = req.files && req.files.length ? req.files : [];
    const saved = files.length
      ? await storage.recordMedia(files, { folder: 'tickets', uploaderId: customerId, uploaderType: 'customer' })
      : [];

    await orderModel.createTicketReply({
      ticket_id: ticket.id,
      author_type: 'customer',
      author_id: customerId,
      author_name: req.session.customer.name,
      message,
      attachment: saved.length ? saved[0].file_url : null,
    });

    await activity.log({
      req,
      action: 'ticket.replied',
      entityType: 'ticket',
      entityId: ticket.id,
      description: `Customer replied to ticket ${ticket.ticket_number}.`,
    });

    req.session.flashSuccess = 'Reply sent.';
    return res.redirect(res.locals.helpers.url(`/account/tickets/${ticket.id}`));
  } catch (err) {
    next(err);
  }
};

exports.closeTicket = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const ticket = await orderModel.findTicketById(Number(req.params.id));

    if (!ticket || ticket.customer_id !== customerId) {
      req.session.flashError = 'Ticket not found.';
      return res.redirect(res.locals.helpers.url('/account/tickets'));
    }

    await orderModel.updateTicket(ticket.id, { status: 'closed' });
    req.session.flashSuccess = 'Ticket closed. Reopen it any time by replying.';
    return res.redirect(res.locals.helpers.url(`/account/tickets/${ticket.id}`));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Profile & security
// ---------------------------------------------------------------------------

exports.profile = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const user = await userModel.findCustomerById(customerId);

    setNav(res, 'profile', { navCounts: await navCounts(customerId) });

    res.render('customer/profile', {
      layout: 'layouts/dashboard',
      pageTitle: 'Edit Profile',
      pageSubtitle: 'Keep your contact details up to date so we can reach you.',
      user,
      errors: null,
      seo: { ...res.locals.seo, title: 'Edit Profile', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateProfile = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const form = {
      name: clean.str(req.body.name, 120),
      phone: clean.str(req.body.phone, 30),
      company: clean.str(req.body.company, 150),
      address: clean.str(req.body.address, 255),
      city: clean.str(req.body.city, 80),
      country: clean.str(req.body.country, 80) || 'Bangladesh',
    };

    const errors = {};
    const nameError = validate.length(form.name, 2, 120, 'Full name');
    const phoneError = validate.phone(form.phone);
    if (nameError) errors.name = nameError;
    if (phoneError) errors.phone = phoneError;

    if (Object.keys(errors).length) {
      setNav(res, 'profile', { navCounts: await navCounts(customerId) });
      return res.status(400).render('customer/profile', {
        layout: 'layouts/dashboard',
        pageTitle: 'Edit Profile',
        pageSubtitle: 'Keep your contact details up to date so we can reach you.',
        user: { ...req.session.customer, ...form },
        errors,
        seo: { ...res.locals.seo, title: 'Edit Profile', robots: 'noindex,nofollow' },
      });
    }

    await userModel.updateCustomer(customerId, form);

    // Keep the session copy in step so the header updates immediately.
    req.session.customer = { ...req.session.customer, ...form };

    await activity.log({
      req,
      action: 'customer.profile_updated',
      entityType: 'customer',
      entityId: customerId,
      description: 'Updated profile details.',
    });

    req.session.flashSuccess = 'Your profile has been updated.';
    return res.redirect(res.locals.helpers.url('/account/profile'));
  } catch (err) {
    next(err);
  }
};

exports.updateAvatar = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const files = req.files && req.files.length ? req.files : [];

    if (!files.length) {
      req.session.flashError = 'Please choose an image to upload.';
      return res.redirect(res.locals.helpers.url('/account/profile'));
    }

    const saved = await storage.recordMedia(files, {
      folder: 'avatars',
      uploaderId: customerId,
      uploaderType: 'customer',
    });

    if (!saved.length) {
      req.session.flashError = 'That image could not be saved. Please try another.';
      return res.redirect(res.locals.helpers.url('/account/profile'));
    }

    const existing = await userModel.findCustomerById(customerId);

    await userModel.updateCustomer(customerId, { avatar: saved[0].file_url });
    req.session.customer.avatar = saved[0].file_url;

    // Remove the previous avatar so uploads do not accumulate.
    if (existing && existing.avatar && existing.avatar !== saved[0].file_url) {
      storage
        .removeFile(existing.avatar.replace(config.uploads.publicPath + '/', ''))
        .catch(() => {});
    }

    await activity.log({
      req,
      action: 'customer.avatar_updated',
      entityType: 'customer',
      entityId: customerId,
      description: 'Updated profile photo.',
    });

    req.session.flashSuccess = 'Profile photo updated.';
    return res.redirect(res.locals.helpers.url('/account/profile'));
  } catch (err) {
    logger.error('Avatar upload failed', err);
    req.session.flashError = 'We could not upload that image. Please try a smaller file.';
    return res.redirect(res.locals.helpers.url('/account/profile'));
  }
};

exports.security = async (req, res, next) => {
  try {
    const customerId = req.session.customer.id;
    const user = await userModel.findCustomerById(customerId);

    setNav(res, 'security', { navCounts: await navCounts(customerId) });

    res.render('customer/security', {
      layout: 'layouts/dashboard',
      pageTitle: 'Security',
      pageSubtitle: 'Change your password and review your account.',
      user,
      hasPassword: Boolean(user.password_hash),
      errors: null,
      seo: { ...res.locals.seo, title: 'Security', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePassword = async (req, res, next) => {
  const customerId = req.session.customer.id;

  try {
    const current = String(req.body.current_password || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.password_confirm || '');

    const user = await userModel.findCustomerById(customerId);

    const errors = {};

    // A Google-only account has no password yet, so there is nothing to verify.
    if (user.password_hash) {
      if (!current) {
        errors.current_password = 'Enter your current password.';
      } else if (!(await bcrypt.compare(current, user.password_hash))) {
        errors.current_password = 'That is not your current password.';
      }
    }

    const passwordError = validate.strongPassword(password);
    if (passwordError) errors.password = passwordError;
    if (password !== confirm) errors.password_confirm = 'The two passwords do not match.';

    if (Object.keys(errors).length) {
      setNav(res, 'security', { navCounts: await navCounts(customerId) });
      return res.status(400).render('customer/security', {
        layout: 'layouts/dashboard',
        pageTitle: 'Security',
        pageSubtitle: 'Change your password and review your account.',
        user,
        hasPassword: Boolean(user.password_hash),
        errors,
        seo: { ...res.locals.seo, title: 'Security', robots: 'noindex,nofollow' },
      });
    }

    await userModel.updateCustomer(customerId, {
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    });

    await activity.log({
      req,
      action: 'customer.password_changed',
      entityType: 'customer',
      entityId: customerId,
      description: 'Changed account password.',
    });

    mail
      .send({
        to: user.email,
        subject: 'Your password was changed',
        html: mail.wrapLayout({
          title: 'Your password was changed',
          body: `<p>Hi ${clean.str(user.name, 60)}, the password on your ${settings.get('site_name')} account was just changed.</p>
                 <p>If this was you, no action is needed. If it was not, contact us immediately.</p>`,
          ctaText: 'Contact support',
          ctaUrl: `${config.app.url}${res.locals.helpers.url('/contact')}`,
        }),
        text: 'Your password was changed.',
      })
      .catch(() => {});

    // Rotate the session so any stolen cookie stops working.
    req.session.regenerate((err) => {
      if (err) {
        req.session.flashSuccess = 'Your password has been changed.';
        return res.redirect(res.locals.helpers.url('/signin'));
      }
      req.session.flashSuccess = 'Your password has been changed. Please sign in again.';
      return res.redirect(res.locals.helpers.url('/signin'));
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect(res.locals.helpers.url('/'));
  });
};
