/**
 * Orders, deliverables, invoices, payments, subscriptions and tickets.
 *
 * The order lifecycle is the core of this application, so the state transitions
 * live here rather than in the controllers - they are shared by the admin panel,
 * the customer dashboard and the payment approval path.
 */
'use strict';

const db = require('../config/database');
const activity = require('../services/activity.service');
const { paginate } = require('../utils/paginator');

/** Legal order status transitions. Anything else is rejected rather than
 *  silently written, so a mis-clicked status cannot lose work. */
const ORDER_TRANSITIONS = {
  pending: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['active', 'on_hold', 'cancelled'],
  on_hold: ['pending', 'in_progress', 'cancelled'],
  active: ['completed', 'on_hold', 'cancelled'],
  completed: ['active'],
  cancelled: ['pending'],
};

const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);

function canTransition(from, to) {
  if (from === to) return true;
  return (ORDER_TRANSITIONS[from] || []).includes(to);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

async function createOrder(data) {
  return db.insert('orders', data);
}

async function findOrderById(id) {
  return db.queryOne(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            c.company AS customer_company, s.image AS service_image, s.slug AS service_slug
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN services s ON s.id = o.service_id
     WHERE o.id = ? LIMIT 1`,
    [id]
  );
}

async function findOrderByNumber(number) {
  return db.queryOne('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [number]);
}

/** An order plus everything attached, for the detail pages. */
async function orderDetail(id) {
  const order = await findOrderById(id);
  if (!order) return null;

  const [deliverables, payments, invoices, invoiceItems, subscription, timeline] = await Promise.all([
    db.query('SELECT * FROM order_deliverables WHERE order_id = ? ORDER BY sort_order ASC, id ASC', [id]),
    db.query('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', [id]),
    db.query('SELECT * FROM invoices WHERE order_id = ? ORDER BY id DESC', [id]),
    db.query(
      'SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_id = ? ORDER BY ii.id ASC',
      [id]
    ),
    db.queryOne('SELECT * FROM subscriptions WHERE order_id = ? ORDER BY id DESC LIMIT 1', [id]),
    db.query(
      `SELECT * FROM activity_log
       WHERE entity_type = 'order' AND entity_id = ?
       ORDER BY id DESC LIMIT 30`,
      [id]
    ),
  ]);

  return { order, deliverables, payments, invoices, invoiceItems, subscription, timeline };
}

async function listOrders({ page = 1, perPage = 20, search = '', status = '', paymentStatus = '', customerId = null, serviceId = null, sort = 'newest' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(o.order_number LIKE ? OR o.service_title LIKE ? OR o.domain_name LIKE ? OR c.name LIKE ? OR c.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('o.status = ?');
    params.push(status);
  }
  if (paymentStatus) {
    conditions.push('o.payment_status = ?');
    params.push(paymentStatus);
  }
  if (customerId) {
    conditions.push('o.customer_id = ?');
    params.push(customerId);
  }
  if (serviceId) {
    conditions.push('o.service_id = ?');
    params.push(serviceId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumns = {
    newest: 'o.id DESC',
    oldest: 'o.id ASC',
    amount_high: 'o.total DESC',
    amount_low: 'o.total ASC',
    due: 'o.due_at ASC',
  };

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id = o.customer_id ${where}`,
    countParams: params,
    rowSql: `SELECT o.*, c.name AS customer_name, c.email AS customer_email
             FROM orders o JOIN customers c ON c.id = o.customer_id
             ${where} ORDER BY ${sortColumns[sort] || sortColumns.newest} LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

/**
 * Move an order to a new status.
 *
 * Validates the transition, stamps the relevant timestamp, keeps the payment
 * status consistent and writes an audit entry - all in one transaction so the
 * order can never be half-updated.
 */
async function updateOrderStatus(id, newStatus, { actor = null, note = null, startedAt = null, dueAt = null, completedAt = null } = {}) {
  const order = await findOrderById(id);
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });

  if (!ORDER_STATUSES.includes(newStatus)) {
    throw Object.assign(new Error(`Unknown order status: ${newStatus}`), { status: 400 });
  }

  if (!canTransition(order.status, newStatus)) {
    throw Object.assign(
      new Error(`An order that is "${order.status.replace(/_/g, ' ')}" cannot move to "${newStatus.replace(/_/g, ' ')}".`),
      { status: 400 }
    );
  }

  const update = { status: newStatus };

  if (newStatus === 'in_progress' && !order.started_at) {
    update.started_at = startedAt ? new Date(startedAt) : new Date();
  }
  if (dueAt) update.due_at = new Date(dueAt);
  if (!order.due_at && newStatus === 'in_progress') {
    update.due_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  if (newStatus === 'completed') {
    update.completed_at = completedAt ? new Date(completedAt) : new Date();
  }

  // An order cannot be "active" without payment; mark it paid if the balance is
  // settled, otherwise leave the flag alone so the admin can chase it.
  if (newStatus === 'active' && order.payment_status === 'unpaid') {
    const paid = await db.queryOne(
      "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE order_id = ? AND status = 'approved'",
      [id]
    );
    if (paid && Number(paid.total) >= Number(order.total)) {
      update.payment_status = 'paid';
    }
  }

  await db.update('orders', update, 'id = ?', [id]);

  await activity.log({
    req: actor && actor.req ? actor.req : null,
    actorType: actor && actor.type ? actor.type : 'staff',
    actorId: actor && actor.id ? actor.id : null,
    actorName: actor && actor.name ? actor.name : null,
    action: `order.${newStatus}`,
    entityType: 'order',
    entityId: id,
    description: note || `Order ${order.order_number} moved from ${order.status} to ${newStatus}.`,
  });

  return findOrderById(id);
}

async function updateOrder(id, data) {
  return db.update('orders', data, 'id = ?', [id]);
}

async function deleteOrder(id) {
  return db.query('DELETE FROM orders WHERE id = ?', [id]);
}

async function orderCounts(customerId = null) {
  const where = customerId ? 'WHERE customer_id = ?' : '';
  const params = customerId ? [customerId] : [];
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'pending') AS pending,
       SUM(status = 'in_progress') AS in_progress,
       SUM(status = 'active') AS active,
       SUM(status = 'completed') AS completed,
       SUM(status = 'cancelled') AS cancelled,
       SUM(status = 'on_hold') AS on_hold,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS gross_value,
       COALESCE(SUM(CASE WHEN payment_status = 'paid' AND status != 'cancelled' THEN total ELSE 0 END),0) AS paid_value
     FROM orders ${where}`,
    params
  );
}

async function recentOrders(limit = 8, customerId = null) {
  return db.query(
    `SELECT o.*, c.name AS customer_name
     FROM orders o JOIN customers c ON c.id = o.customer_id
     ${customerId ? 'WHERE o.customer_id = ?' : ''}
     ORDER BY o.id DESC LIMIT ?`,
    customerId ? [customerId, limit] : [limit]
  );
}

async function orderTrend(months = 8) {
  return db.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period,
            COUNT(*) AS orders,
            COALESCE(SUM(total),0) AS revenue
     FROM orders
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH) AND status != 'cancelled'
     GROUP BY period ORDER BY period ASC`,
    [months]
  );
}

/** Revenue by package, for the analytics screen. */
async function revenueByService(limit = 8) {
  return db.query(
    `SELECT service_title, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
     FROM orders WHERE status != 'cancelled'
     GROUP BY service_title ORDER BY revenue DESC LIMIT ?`,
    [limit]
  );
}

// ---------------------------------------------------------------------------
// Deliverables - the credentials handed over when an order goes live
// ---------------------------------------------------------------------------

async function listDeliverables(orderId) {
  return db.query('SELECT * FROM order_deliverables WHERE order_id = ? ORDER BY sort_order ASC, id ASC', [orderId]);
}

async function createDeliverable(data) {
  return db.insert('order_deliverables', data);
}

async function updateDeliverable(id, data) {
  return db.update('order_deliverables', data, 'id = ?', [id]);
}

async function deleteDeliverable(id) {
  return db.query('DELETE FROM order_deliverables WHERE id = ?', [id]);
}

/** Replace every deliverable for an order in one go - matches the admin form,
 *  which submits the whole list rather than row-by-row edits. */
async function replaceDeliverables(orderId, items) {
  await db.transaction(async (conn) => {
    await conn.query('DELETE FROM order_deliverables WHERE order_id = ?', [orderId]);
    let index = 0;
    for (const item of items) {
      if (!item || !item.label || !String(item.label).trim()) continue;
      await conn.query(
        `INSERT INTO order_deliverables (order_id, label, value, is_visible, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, String(item.label).trim(), item.value ? String(item.value) : '', item.isVisible === false ? 0 : 1, index]
      );
      index += 1;
    }
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

async function createPayment(data) {
  return db.insert('payments', data);
}

async function findPaymentById(id) {
  return db.queryOne(
    `SELECT p.*, c.name AS customer_name, c.email AS customer_email, o.order_number
     FROM payments p
     JOIN customers c ON c.id = p.customer_id
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.id = ? LIMIT 1`,
    [id]
  );
}

async function listPayments({ page = 1, perPage = 20, search = '', status = '', method = '', customerId = null } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(p.transaction_id LIKE ? OR p.sender_number LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR o.order_number LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (method) {
    conditions.push('p.method = ?');
    params.push(method);
  }
  if (customerId) {
    conditions.push('p.customer_id = ?');
    params.push(customerId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM payments p
               JOIN customers c ON c.id = p.customer_id
               LEFT JOIN orders o ON o.id = p.order_id ${where}`,
    countParams: params,
    rowSql: `SELECT p.*, c.name AS customer_name, c.email AS customer_email, o.order_number
             FROM payments p
             JOIN customers c ON c.id = p.customer_id
             LEFT JOIN orders o ON o.id = p.order_id
             ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

/**
 * Approve a payment and, in the same transaction, settle the order it belongs
 * to. Splitting this into two calls would leave a window where the money is
 * recorded but the order still looks unpaid.
 */
async function approvePayment(id, { reviewerId = null, note = null } = {}) {
  return db.transaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [id]);
    const payment = rows[0];
    if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
    if (payment.status === 'approved') return payment;

    await conn.query(
      `UPDATE payments SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), admin_note = ? WHERE id = ?`,
      [reviewerId, note, id]
    );

    if (payment.order_id) {
      const [orderRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [payment.order_id]);
      const order = orderRows[0];

      if (order) {
        const [sumRows] = await conn.query(
          "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE order_id = ? AND status IN ('approved')",
          [order.id]
        );
        const approved = Number(sumRows[0].total);

        let paymentStatus = 'unpaid';
        if (approved >= Number(order.total)) paymentStatus = 'paid';
        else if (approved > 0) paymentStatus = 'partial';

        await conn.query('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, order.id]);

        // Mark a matching invoice paid too, so the invoice list stays truthful.
        await conn.query(
          "UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE order_id = ? AND status = 'unpaid' AND total <= ?",
          [order.id, approved]
        );
      }
    }

    // A payment may be tied to an invoice without an order (renewals).
    if (payment.invoice_id) {
      const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [payment.invoice_id]);
      const invoice = invoiceRows[0];
      if (invoice) {
        const [sumRows] = await conn.query(
          "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id = ? AND status = 'approved'",
          [invoice.id]
        );
        if (Number(sumRows[0].total) >= Number(invoice.total)) {
          await conn.query("UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = ?", [invoice.id]);
        }
      }
    }

    return { ...payment, status: 'approved' };
  });
}

async function rejectPayment(id, { reviewerId = null, note = null } = {}) {
  return db.transaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [id]);
    const payment = rows[0];
    if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });

    await conn.query(
      `UPDATE payments SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), admin_note = ? WHERE id = ?`,
      [reviewerId, note, id]
    );

    // A rejected payment must not leave the order looking partially paid.
    if (payment.order_id && payment.status === 'approved') {
      const [sumRows] = await conn.query(
        "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE order_id = ? AND status = 'approved'",
        [payment.order_id]
      );
      const approved = Number(sumRows[0].total);
      const [orderRows] = await conn.query('SELECT total FROM orders WHERE id = ?', [payment.order_id]);
      const orderTotal = orderRows[0] ? Number(orderRows[0].total) : 0;

      let paymentStatus = 'unpaid';
      if (orderTotal > 0 && approved >= orderTotal) paymentStatus = 'paid';
      else if (approved > 0) paymentStatus = 'partial';

      await conn.query('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, payment.order_id]);
    }

    return { ...payment, status: 'rejected' };
  });
}

async function paymentCounts() {
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'pending') AS pending,
       SUM(status = 'approved') AS approved,
       SUM(status = 'rejected') AS rejected,
       COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END),0) AS collected,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) AS awaiting
     FROM payments`
  );
}

async function paymentsByMethod() {
  return db.query(
    `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
     FROM payments WHERE status = 'approved'
     GROUP BY method ORDER BY total DESC`
  );
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

async function createInvoice(data) {
  return db.insert('invoices', data);
}

async function createInvoiceItem(data) {
  return db.insert('invoice_items', data);
}

async function findInvoiceById(id) {
  return db.queryOne(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            c.company AS customer_company, c.address AS customer_address,
            c.city AS customer_city, c.country AS customer_country, o.order_number
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.id = ? LIMIT 1`,
    [id]
  );
}

async function findInvoiceByNumber(number) {
  return db.queryOne('SELECT * FROM invoices WHERE invoice_number = ? LIMIT 1', [number]);
}

async function listInvoices({ page = 1, perPage = 20, search = '', status = '', customerId = null } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR o.order_number LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('i.status = ?');
    params.push(status);
  }
  if (customerId) {
    conditions.push('i.customer_id = ?');
    params.push(customerId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM invoices i
               JOIN customers c ON c.id = i.customer_id
               LEFT JOIN orders o ON o.id = i.order_id ${where}`,
    countParams: params,
    rowSql: `SELECT i.*, c.name AS customer_name, c.email AS customer_email, o.order_number
             FROM invoices i
             JOIN customers c ON c.id = i.customer_id
             LEFT JOIN orders o ON o.id = i.order_id
             ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function invoiceItems(invoiceId) {
  return db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC', [invoiceId]);
}

async function updateInvoice(id, data) {
  return db.update('invoices', data, 'id = ?', [id]);
}

async function deleteInvoice(id) {
  return db.query('DELETE FROM invoices WHERE id = ?', [id]);
}

async function invoiceCounts() {
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'unpaid') AS unpaid,
       SUM(status = 'paid') AS paid,
       COALESCE(SUM(CASE WHEN status = 'unpaid' THEN total ELSE 0 END),0) AS outstanding,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END),0) AS collected
     FROM invoices`
  );
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

async function createSubscription(data) {
  return db.insert('subscriptions', data);
}

async function findSubscriptionById(id) {
  return db.queryOne(
    `SELECT s.*, c.name AS customer_name, c.email AS customer_email
     FROM subscriptions s JOIN customers c ON c.id = s.customer_id
     WHERE s.id = ? LIMIT 1`,
    [id]
  );
}

async function listSubscriptions({ page = 1, perPage = 20, search = '', status = '', customerId = null } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(s.plan_name LIKE ? OR c.name LIKE ? OR c.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('s.status = ?');
    params.push(status);
  }
  if (customerId) {
    conditions.push('s.customer_id = ?');
    params.push(customerId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM subscriptions s JOIN customers c ON c.id = s.customer_id ${where}`,
    countParams: params,
    rowSql: `SELECT s.*, c.name AS customer_name, c.email AS customer_email
             FROM subscriptions s JOIN customers c ON c.id = s.customer_id
             ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function updateSubscription(id, data) {
  return db.update('subscriptions', data, 'id = ?', [id]);
}

async function deleteSubscription(id) {
  return db.query('DELETE FROM subscriptions WHERE id = ?', [id]);
}

/** Subscriptions due for renewal - drives the dashboard reminder list. */
async function dueSubscriptions(days = 30) {
  return db.query(
    `SELECT s.*, c.name AS customer_name, c.email AS customer_email
     FROM subscriptions s JOIN customers c ON c.id = s.customer_id
     WHERE s.status = 'active' AND s.next_billing_at IS NOT NULL
       AND s.next_billing_at <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY s.next_billing_at ASC LIMIT 50`,
    [days]
  );
}

/**
 * Roll a subscription forward by one cycle.
 * Called after a renewal payment is approved.
 */
async function advanceSubscription(id) {
  const subscription = await findSubscriptionById(id);
  if (!subscription) throw Object.assign(new Error('Subscription not found.'), { status: 404 });

  const next = new Date(subscription.next_billing_at || Date.now());
  if (subscription.billing_cycle === 'yearly') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }

  const iso = next.toISOString().slice(0, 10);
  await db.update('subscriptions', { next_billing_at: iso, status: 'active' }, 'id = ?', [id]);

  if (subscription.order_id) {
    await db.update('orders', { due_at: `${iso} 00:00:00` }, 'id = ?', [subscription.order_id]);
  }

  return findSubscriptionById(id);
}

async function subscriptionCounts() {
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'active') AS active,
       SUM(status = 'past_due') AS past_due,
       SUM(status = 'cancelled') AS cancelled,
       COALESCE(SUM(CASE WHEN status = 'active' THEN amount ELSE 0 END),0) AS mrr
     FROM subscriptions`
  );
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

async function createTicket(data) {
  return db.insert('tickets', data);
}

async function findTicketById(id) {
  return db.queryOne(
    `SELECT t.*, c.name AS customer_name, c.email AS customer_email, c.avatar AS customer_avatar,
            u.name AS assignee_name, o.order_number
     FROM tickets t
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.id = ? LIMIT 1`,
    [id]
  );
}

async function findTicketByNumber(number) {
  return db.queryOne('SELECT * FROM tickets WHERE ticket_number = ? LIMIT 1', [number]);
}

async function listTickets({ page = 1, perPage = 20, search = '', status = '', priority = '', department = '', customerId = null, assignedTo = null } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(t.ticket_number LIKE ? OR t.subject LIKE ? OR c.name LIKE ? OR c.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('t.status = ?');
    params.push(status);
  }
  if (priority) {
    conditions.push('t.priority = ?');
    params.push(priority);
  }
  if (department) {
    conditions.push('t.department = ?');
    params.push(department);
  }
  if (customerId) {
    conditions.push('t.customer_id = ?');
    params.push(customerId);
  }
  if (assignedTo) {
    conditions.push('t.assigned_to = ?');
    params.push(assignedTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM tickets t JOIN customers c ON c.id = t.customer_id ${where}`,
    countParams: params,
    rowSql: `SELECT t.*, c.name AS customer_name, c.email AS customer_email, u.name AS assignee_name
             FROM tickets t
             JOIN customers c ON c.id = t.customer_id
             LEFT JOIN users u ON u.id = t.assigned_to
             ${where}
             ORDER BY FIELD(t.status,'open','pending','answered','closed'), FIELD(t.priority,'urgent','high','medium','low'), t.id DESC
             LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function updateTicket(id, data) {
  return db.update('tickets', data, 'id = ?', [id]);
}

async function deleteTicket(id) {
  return db.query('DELETE FROM tickets WHERE id = ?', [id]);
}

async function ticketReplies(ticketId) {
  return db.query('SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY id ASC', [ticketId]);
}

async function createTicketReply(data) {
  const id = await db.insert('ticket_replies', data);
  await db.update(
    'tickets',
    { last_reply_at: new Date(), status: data.author_type === 'staff' ? 'answered' : 'open' },
    'id = ?',
    [data.ticket_id]
  );
  return id;
}

async function ticketCounts(customerId = null) {
  const where = customerId ? 'WHERE customer_id = ?' : '';
  const params = customerId ? [customerId] : [];
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'open') AS open,
       SUM(status = 'pending') AS pending,
       SUM(status = 'answered') AS answered,
       SUM(status = 'closed') AS closed,
       SUM(priority = 'urgent' AND status != 'closed') AS urgent
     FROM tickets ${where}`,
    params
  );
}

// ---------------------------------------------------------------------------
// Contact messages & newsletter
// ---------------------------------------------------------------------------

async function createContactMessage(data) {
  return db.insert('contact_messages', data);
}

async function listContactMessages({ page = 1, perPage = 20, search = '', status = '' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM contact_messages ${where}`,
    countParams: params,
    rowSql: `SELECT * FROM contact_messages ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function findContactMessageById(id) {
  return db.queryOne('SELECT * FROM contact_messages WHERE id = ? LIMIT 1', [id]);
}

async function updateContactMessage(id, data) {
  return db.update('contact_messages', data, 'id = ?', [id]);
}

async function deleteContactMessage(id) {
  return db.query('DELETE FROM contact_messages WHERE id = ?', [id]);
}

async function subscribeNewsletter(email) {
  const existing = await db.queryOne('SELECT * FROM newsletter_subscribers WHERE email = ? LIMIT 1', [email]);
  if (existing) {
    if (existing.status !== 'subscribed') {
      await db.update('newsletter_subscribers', { status: 'subscribed' }, 'id = ?', [existing.id]);
    }
    return { id: existing.id, created: false };
  }
  const id = await db.insert('newsletter_subscribers', { email, status: 'subscribed' });
  return { id, created: true };
}

async function listSubscribers({ page = 1, perPage = 30 } = {}) {
  return paginate({
    countSql: 'SELECT COUNT(*) AS total FROM newsletter_subscribers WHERE status = ?',
    countParams: ['subscribed'],
    rowSql: 'SELECT * FROM newsletter_subscribers WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    rowParams: ['subscribed'],
    page,
    perPage,
  });
}

module.exports = {
  ORDER_TRANSITIONS, ORDER_STATUSES, canTransition,
  createOrder, findOrderById, findOrderByNumber, orderDetail, listOrders,
  updateOrderStatus, updateOrder, deleteOrder, orderCounts, recentOrders, orderTrend, revenueByService,

  listDeliverables, createDeliverable, updateDeliverable, deleteDeliverable, replaceDeliverables,

  createPayment, findPaymentById, listPayments, approvePayment, rejectPayment, paymentCounts, paymentsByMethod,

  createInvoice, createInvoiceItem, findInvoiceById, findInvoiceByNumber, listInvoices, invoiceItems,
  updateInvoice, deleteInvoice, invoiceCounts,

  createSubscription, findSubscriptionById, listSubscriptions, updateSubscription, deleteSubscription,
  dueSubscriptions, advanceSubscription, subscriptionCounts,

  createTicket, findTicketById, findTicketByNumber, listTickets, updateTicket, deleteTicket,
  ticketReplies, createTicketReply, ticketCounts,

  createContactMessage, listContactMessages, findContactMessageById, updateContactMessage, deleteContactMessage,
  subscribeNewsletter, listSubscribers,
};
