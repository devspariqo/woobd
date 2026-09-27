/**
 * SQL literal escaping.
 *
 * Shared by the admin backup download and the script that builds
 * database/install.sql, so a dump produced by either one is byte-identical in
 * how it quotes a value. Two copies of this would drift, and the failure mode
 * is a dump that restores with silently mangled data.
 */
'use strict';

/**
 * Render a JavaScript value as a MySQL literal.
 *
 * Deliberately not `mysql.escape` from the driver: that quotes for a prepared
 * statement's parameter binding, and this output goes into a text file that
 * somebody will paste into phpMyAdmin.
 */
function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';

  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }

  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;

  // mysql2 hands JSON columns back already parsed, so a plain object or array
  // arriving here is a JSON value, not something exotic.
  //
  // String() is the wrong tool for it: an empty array stringifies to '' and an
  // object to '[object Object]'. The first is rejected outright by MySQL as an
  // invalid JSON document, and the second is silently stored as the literal
  // text - which is how a dump restores with a portfolio gallery that contains
  // the word "object Object" instead of a list.
  const raw = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

  return `'${raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')}'`;
}

/** Escape an identifier. Backticks are doubled, which is how MySQL escapes them. */
function sqlIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

module.exports = { sqlValue, sqlIdent };
