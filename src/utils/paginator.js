/**
 * Shared pagination helper.
 *
 * Every list screen returns the same shape so the pagination partial and the
 * admin tables can be written once.
 */
'use strict';

const db = require('../config/database');

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/**
 * Run a count and a page query.
 * @returns {{rows:Array, total:number, page:number, perPage:number, totalPages:number, from:number, to:number}}
 */
async function paginate({ countSql, countParams = [], rowSql, rowParams = [], page = 1, perPage = DEFAULT_PER_PAGE }) {
  const safePerPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(perPage, 10) || DEFAULT_PER_PAGE));

  const countRow = await db.queryOne(countSql, countParams);
  const total = countRow ? Number(countRow.total || 0) : 0;
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  const safePage = Math.min(totalPages, Math.max(1, parseInt(page, 10) || 1));
  const offset = (safePage - 1) * safePerPage;

  const rows = await db.query(rowSql, [...rowParams, safePerPage, offset]);

  return {
    rows,
    total,
    page: safePage,
    perPage: safePerPage,
    totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + safePerPage, total),
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
  };
}

/** Read page/perPage off a query string with sane defaults. */
function fromQuery(query, defaultPerPage = DEFAULT_PER_PAGE) {
  return {
    page: parseInt(query.page, 10) || 1,
    perPage: parseInt(query.per, 10) || defaultPerPage,
  };
}

module.exports = { paginate, fromQuery, DEFAULT_PER_PAGE, MAX_PER_PAGE };
