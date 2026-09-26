/**
 * Activity log and a handful of shared record-number generators.
 *
 * Every mutating admin/customer action writes one row here. The admin activity
 * feed, per-customer timelines and the reports screen all read from it, so the
 * write path needs to be cheap and never throw.
 */
'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Record an action. Never throws - an audit-trail failure must not fail the
 * action it was describing.
 */
async function log({ req, actorType = 'system', actorId = null, actorName = null, action, entityType = null, entityId = null, description = null }) {
  try {
    let resolvedType = actorType;
    let resolvedId = actorId;
    let resolvedName = actorName;

    if (req) {
      if (req.session && req.session.staff) {
        resolvedType = 'staff';
        resolvedId = req.session.staff.id;
        resolvedName = req.session.staff.name;
      } else if (req.session && req.session.customer) {
        resolvedType = 'customer';
        resolvedId = req.session.customer.id;
        resolvedName = req.session.customer.name;
      }
    }

    await db.insert('activity_log', {
      actor_type: resolvedType,
      actor_id: resolvedId,
      actor_name: resolvedName,
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
      ip_address: req ? req.ip : null,
      user_agent: req ? String(req.get('user-agent') || '').slice(0, 255) : null,
    });
  } catch (err) {
    logger.warn('Could not write activity log', { action, error: err.message });
  }
}

/** Recent entries for the dashboard feed. */
async function recent({ limit = 12, actorType = null, actorId = null, entityType = null, entityId = null } = {}) {
  const conditions = [];
  const params = [];
  if (actorType) {
    conditions.push('actor_type = ?');
    params.push(actorType);
  }
  if (actorId) {
    conditions.push('actor_id = ?');
    params.push(actorId);
  }
  if (entityType) {
    conditions.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    conditions.push('entity_id = ?');
    params.push(entityId);
  }
  params.push(limit);

  return db.query(
    `SELECT * FROM activity_log
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT ?`,
    params
  );
}

/** Paginated list for the admin Activity screen with optional filters. */
async function paginate({ page = 1, perPage = 30, actorType, action, search } = {}) {
  const conditions = [];
  const params = [];

  if (actorType) {
    conditions.push('actor_type = ?');
    params.push(actorType);
  }
  if (action) {
    conditions.push('action LIKE ?');
    params.push(`%${action}%`);
  }
  if (search) {
    conditions.push('(actor_name LIKE ? OR description LIKE ? OR action LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await db.queryOne(`SELECT COUNT(*) AS total FROM activity_log ${where}`, params);
  const total = countRow ? countRow.total : 0;
  const offset = (Math.max(1, page) - 1) * perPage;

  const rows = await db.query(
    `SELECT * FROM activity_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  );

  return { rows, total, page: Math.max(1, page), perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) };
}

// ---------------------------------------------------------------------------
// Record numbering
// ---------------------------------------------------------------------------

/** Zero-pad to a stable width so numbers sort sensibly as strings. */
function pad(value, width = 5) {
  return String(value).padStart(width, '0');
}

/**
 * Allocate the next order number, e.g. WBD-2026-00042.
 *
 * Uses MAX() + 1 rather than a counter table, inside the caller's transaction
 * where one exists. A duplicate is theoretically possible under heavy
 * concurrency; the UNIQUE index on order_number turns that into a clean retry
 * instead of a silent collision, and `nextNumber` retries once.
 */
async function nextNumber({ table, column, prefix, useYear = true }) {
  const year = new Date().getFullYear();
  const pattern = useYear ? `${prefix}${year}-%` : `${prefix}%`;

  const row = await db.queryOne(
    `SELECT MAX(\`${column}\`) AS latest FROM \`${table}\` WHERE \`${column}\` LIKE ?`,
    [pattern]
  );

  let sequence = 1;
  if (row && row.latest) {
    const parts = String(row.latest).split('-');
    const last = parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(last)) sequence = last + 1;
  }

  return useYear ? `${prefix}${year}-${pad(sequence)}` : `${prefix}${pad(sequence)}`;
}

/** Allocate a number with one retry if a race produced a duplicate. */
async function allocate({ table, column, prefix, useYear = true, attempt = 0 }) {
  const candidate = await nextNumber({ table, column, prefix, useYear });
  const existing = await db.queryOne(`SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`, [candidate]);
  if (!existing) return candidate;
  if (attempt >= 3) return `${candidate}-${Date.now().toString().slice(-4)}`;
  return allocate({ table, column, prefix, useYear, attempt: attempt + 1 });
}

const numbers = {
  order: () => allocate({ table: 'orders', column: 'order_number', prefix: 'WBD-' }),
  invoice: () => allocate({ table: 'invoices', column: 'invoice_number', prefix: 'INV-' }),
  ticket: () => allocate({ table: 'tickets', column: 'ticket_number', prefix: 'TKT-' }),
};

module.exports = { log, recent, paginate, numbers, pad };
