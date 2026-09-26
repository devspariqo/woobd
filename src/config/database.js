/**
 * MySQL connection pool.
 *
 * Note the default host is 127.0.0.1, never `localhost`. On Hostinger, PHP
 * reaches MySQL over a local socket so `localhost` works there, but Node
 * connects over TCP and `localhost` resolves to the IPv6 loopback ::1 - which
 * the database user is not granted. The result is `Access denied ...@'::1'`.
 */
'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../utils/logger');

let pool;

function createPool() {
    if (pool) return pool;

    pool = mysql.createPool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        waitForConnections: true,
        connectionLimit: config.db.connectionLimit,
        queueLimit: 0,
        charset: 'utf8mb4_unicode_ci',
        // Bangla product names and Arabic text require the full 4-byte range.
        timezone: 'Z',
        dateStrings: false,
        supportBigNumbers: true,
        bigNumberStrings: false,
        // Return DECIMAL as a number rather than a string; MySQL otherwise gives
        // back "1200.00" for prices and `+` concatenates instead of adding.
        decimalNumbers: true,
    });

    return pool;
}

/**
 * Get the pool, creating it on first use.
 *
 * Every helper below must call this rather than touching the module-level
 * `pool` variable directly: the pool is created lazily, so on the very first
 * query that variable is still undefined and `pool.query` throws
 * "Cannot read properties of undefined". The getter is the single entry point
 * that guarantees creation.
 */
function getPool() {
    return createPool();
}

/** Run a query and return the rows. */
async function query(sql, params = []) {
    const [rows] = await getPool().query(sql, params);
    return rows;
}

/** Run a query and return only the first row, or null. */
async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows.length ? rows[0] : null;
}

/**
 * Run a callback inside a transaction. Commits on success, rolls back on any
 * throw. Used for order creation, payment state changes and anything that
 * touches more than one table.
 */
async function transaction(handler) {
    const conn = await getPool().getConnection();
    try {
        await conn.beginTransaction();
        const result = await handler(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try {
            await conn.rollback();
        } catch (rollbackErr) {
            logger.error('Rollback failed', rollbackErr);
        }
        throw err;
    } finally {
        conn.release();
    }
}

/** Insert helper - returns the new auto-increment id. */
async function insert(table, data) {
    const keys = Object.keys(data);
    const columns = keys.map((k) => `\`${k}\``).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => data[k]);
    const result = await query(
        `INSERT INTO \`${table}\` (${columns}) VALUES (${placeholders})`,
        values
    );
    return result.insertId;
}

/** Update helper - builds a partial UPDATE from the supplied object. */
async function update(table, data, where, whereParams = []) {
    const keys = Object.keys(data);
    if (!keys.length) return 0;
    const assignments = keys.map((k) => `\`${k}\` = ?`).join(', ');
    const values = keys.map((k) => data[k]);
    const result = await query(
        `UPDATE \`${table}\` SET ${assignments} WHERE ${where}`,
        [...values, ...whereParams]
    );
    return result.affectedRows;
}

/** Verify connectivity at boot so a bad DB config is loud, not lazy. */
async function healthCheck() {
    const conn = await getPool().getConnection();
    try {
        await conn.query('SELECT 1');
        return true;
    } finally {
        conn.release();
    }
}

async function close() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    get pool() {
        return getPool();
    },
    query,
    queryOne,
    transaction,
    insert,
    update,
    healthCheck,
    close,
    /** Column list helper used by the admin CRUD tables. */
    escapeId: mysql.escapeId,
};
