/**
 * Shared view/format helpers. Registered as `app.locals` so every template can
 * call them without each route passing them down.
 */
'use strict';

const config = require('../config');

/** Build an absolute URL that respects APP_BASE_PATH. Every link in every
 *  template goes through this, so there is exactly one place that knows how the
 *  app is mounted. */
function url(path = '/') {
  const base = config.app.basePath === '/' ? '' : config.app.basePath;
  if (!path || path === '/') return base || '/';
  if (/^https?:\/\//i.test(path) || path.startsWith('#')) return path;
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}

/** Absolute URL including scheme and host - for canonical tags and OG images. */
function absoluteUrl(path = '/') {
  const relative = url(path);
  if (/^https?:\/\//i.test(relative)) return relative;
  return `${config.app.url}${relative}`;
}

/** Escape for safe interpolation into HTML. */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a number as Bangladeshi Taka. */
function money(amount, symbol) {
  const numeric = Number(amount) || 0;
  const formatted = numeric.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol === undefined ? '৳' : symbol}${formatted}`;
}

/** "26 Sep 2026" */
function formatDate(value, opts = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opts,
  });
}

/** "26 Sep 2026, 14:30" */
function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)}, ${date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** "3 minutes ago" - used across dashboard and activity feeds. */
function timeAgo(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [label, secs] of units) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${label}${count > 1 ? 's' : ''} ago`;
  }
  return `${seconds} seconds ago`;
}

/** Human-readable file size. */
function fileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/** Truncate to a word boundary rather than mid-word. */
function excerpt(text, length = 160) {
  if (!text) return '';
  const clean = String(text).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, clean.lastIndexOf(' ', length))}…`;
}

/** "Md Mehedi Hasan" -> "MM" for avatar fallbacks. */
function initials(name) {
  if (!name) return '?';
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Colour-coded status pill, used by orders / payments / tickets. */
const STATUS_TONES = {
  pending: 'warning',
  in_progress: 'info',
  active: 'success',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'muted',
  unpaid: 'warning',
  partial: 'info',
  paid: 'success',
  refunded: 'muted',
  rejected: 'danger',
  approved: 'success',
  open: 'info',
  answered: 'success',
  closed: 'muted',
  draft: 'muted',
  published: 'success',
  past_due: 'danger',
  expired: 'muted',
  new: 'info',
  read: 'muted',
  replied: 'success',
  archived: 'muted',
  subscribed: 'success',
  unsubscribed: 'muted',
  suspended: 'danger',
  urgent: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'muted',
};

function statusTone(status) {
  return STATUS_TONES[String(status || '').toLowerCase()] || 'muted';
}

/** "in_progress" -> "In progress" */
function humanise(value) {
  if (!value) return '';
  const spaced = String(value).replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Parse a JSON column that may be null, a string or already an array. */
function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Render a relative date for a <time> element. Pair with the `data-relative`
 * attribute so the client can refresh it without a page reload.
 */
function paginationRange(current, total, window = 2) {
  const pages = [];
  const start = Math.max(1, current - window);
  const end = Math.min(total, current + window);
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < total) {
    if (end < total - 1) pages.push('...');
    pages.push(total);
  }
  return pages;
}

/**
 * Split a comma/newline separated settings string into a clean array.
 *
 * Settings store multi-value fields (hero bullets, typing words, footer links)
 * as a single string, so every template that renders one needs this. Defined
 * here rather than in each view to keep the parsing rule in one place.
 */
function clean_list(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Resolve an uploaded path to a public URL, falling back when unset. */
function assetUrl(path, fallback) {
  if (path && String(path).trim()) return url(String(path).trim());
  return fallback ? url(fallback) : '';
}

/**
 * Serialise a value for embedding inside
 * `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is NOT safe there. Structured data is built from
 * settings an admin can edit, and a value containing `</script>` would close
 * the block early - everything after it would then be parsed as markup, which
 * is a stored-XSS vector. Escaping `<`, `>` and `&` as \uXXXX keeps the payload
 * valid JSON (those are legal JSON escapes) while making breakout impossible.
 *
 * U+2028 and U+2029 are valid in JSON but not in a JavaScript string literal,
 * so they are escaped too - harmless here, and it keeps the output safe if the
 * payload is ever inlined as JS rather than JSON.
 */
function jsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = {
  url,
  absoluteUrl,
  assetUrl,
  escapeHtml,
  jsonLd,
  money,
  formatDate,
  formatDateTime,
  timeAgo,
  fileSize,
  excerpt,
  initials,
  statusTone,
  humanise,
  parseJson,
  paginationRange,
  clean_list,
};
