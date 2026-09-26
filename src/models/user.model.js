/**
 * Data access for staff and customers.
 *
 * Kept as explicit SQL rather than an ORM: the query shapes here are simple and
 * predictable, and it keeps the deployment free of a generate step that would
 * have to run on every Hostinger build.
 */
'use strict';

const db = require('../config/database');
const { paginate } = require('../utils/paginator');

const STAFF_COLUMNS = 'id, name, username, email, phone, role, status, avatar, google_id, last_login_at, last_login_ip, failed_attempts, locked_until, created_at, updated_at';
const CUSTOMER_COLUMNS = 'id, name, email, phone, company, avatar, google_id, email_verified_at, address, city, country, status, last_login_at, created_at, updated_at';

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

async function findStaffByLogin(identifier) {
  return db.queryOne(
    `SELECT * FROM users WHERE (username = ? OR email = ?) LIMIT 1`,
    [identifier, identifier]
  );
}

async function findStaffById(id) {
  return db.queryOne(`SELECT ${STAFF_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
}

async function findStaffByEmail(email) {
  return db.queryOne('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
}

async function listStaff({ page = 1, perPage = 20, search = '', role = '', status = '' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(name LIKE ? OR username LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM users ${where}`,
    countParams: params,
    rowSql: `SELECT ${STAFF_COLUMNS} FROM users ${where} ORDER BY FIELD(role,'admin','manager','editor'), id ASC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function createStaff(data) {
  return db.insert('users', data);
}

async function updateStaff(id, data) {
  return db.update('users', data, 'id = ?', [id]);
}

async function deleteStaff(id) {
  return db.query('DELETE FROM users WHERE id = ?', [id]);
}

async function countAdmins() {
  const row = await db.queryOne("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'");
  return row ? row.total : 0;
}

/** Track failed attempts and apply a lockout once the threshold is crossed. */
async function registerFailedLogin(id, { maxAttempts = 5, lockMinutes = 15 } = {}) {
  const staff = await db.queryOne('SELECT failed_attempts FROM users WHERE id = ? LIMIT 1', [id]);
  const attempts = (staff ? staff.failed_attempts : 0) + 1;

  const update = { failed_attempts: attempts };
  if (attempts >= maxAttempts) {
    update.locked_until = new Date(Date.now() + lockMinutes * 60 * 1000);
    update.failed_attempts = 0;
  }
  await db.update('users', update, 'id = ?', [id]);
  return attempts >= maxAttempts;
}

async function registerSuccessfulLogin(id, ip) {
  await db.update(
    'users',
    { failed_attempts: 0, locked_until: null, last_login_at: new Date(), last_login_ip: ip || null },
    'id = ?',
    [id]
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

async function findCustomerByEmail(email) {
  return db.queryOne('SELECT * FROM customers WHERE email = ? LIMIT 1', [email]);
}

async function findCustomerById(id) {
  return db.queryOne(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ? LIMIT 1`, [id]);
}

async function findCustomerByGoogleId(googleId) {
  return db.queryOne('SELECT * FROM customers WHERE google_id = ? LIMIT 1', [googleId]);
}

async function findCustomerByToken(field, token) {
  const allowed = ['verification_token', 'reset_token'];
  if (!allowed.includes(field)) throw new Error('Unsupported token field');
  return db.queryOne(`SELECT * FROM customers WHERE \`${field}\` = ? LIMIT 1`, [token]);
}

async function createCustomer(data) {
  return db.insert('customers', data);
}

async function updateCustomer(id, data) {
  return db.update('customers', data, 'id = ?', [id]);
}

async function deleteCustomer(id) {
  return db.query('DELETE FROM customers WHERE id = ?', [id]);
}

async function listCustomers({ page = 1, perPage = 20, search = '', status = '' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM customers ${where}`,
    countParams: params,
    rowSql: `SELECT ${CUSTOMER_COLUMNS},
               (SELECT COUNT(*) FROM orders o WHERE o.customer_id = customers.id) AS order_count,
               (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.customer_id = customers.id AND p.status = 'approved') AS total_paid
             FROM customers ${where}
             ORDER BY id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

/** A customer with their orders, payments and tickets - the admin detail view. */
async function customerProfile(id) {
  const customer = await db.queryOne(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ? LIMIT 1`, [id]);
  if (!customer) return null;

  const [orders, payments, tickets, subscriptions, stats] = await Promise.all([
    db.query(
      `SELECT o.*, s.image AS service_image
       FROM orders o LEFT JOIN services s ON s.id = o.service_id
       WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT 50`,
      [id]
    ),
    db.query('SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC LIMIT 50', [id]),
    db.query('SELECT * FROM tickets WHERE customer_id = ? ORDER BY id DESC LIMIT 50', [id]),
    db.query('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 50', [id]),
    db.queryOne(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE customer_id = ?) AS order_count,
         (SELECT COALESCE(SUM(total),0) FROM orders WHERE customer_id = ? AND status != 'cancelled') AS order_value,
         (SELECT COALESCE(SUM(amount),0) FROM payments WHERE customer_id = ? AND status = 'approved') AS total_paid,
         (SELECT COUNT(*) FROM tickets WHERE customer_id = ? AND status != 'closed') AS open_tickets`,
      [id, id, id, id]
    ),
  ]);

  return { customer, orders, payments, tickets, subscriptions, stats };
}

async function counts() {
  return db.queryOne(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'active') AS active,
       SUM(status = 'suspended') AS suspended,
       SUM(created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS last_30_days
     FROM customers`
  );
}

/** Monthly signups for the dashboard chart. */
async function signupTrend(months = 8) {
  return db.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS total
     FROM customers
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
     GROUP BY period ORDER BY period ASC`,
    [months]
  );
}

module.exports = {
  findStaffByLogin,
  findStaffById,
  findStaffByEmail,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  countAdmins,
  registerFailedLogin,
  registerSuccessfulLogin,

  findCustomerByEmail,
  findCustomerById,
  findCustomerByGoogleId,
  findCustomerByToken,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listCustomers,
  customerProfile,
  counts,
  signupTrend,
};
