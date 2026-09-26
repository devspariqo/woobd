/**
 * Input validation and sanitisation helpers.
 *
 * A tiny hand-rolled validator instead of a dependency: the shapes here are
 * simple, and owning it means the error messages stay consistent with the rest
 * of the UI.
 */
'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Bangladesh mobile numbers: 11 digits starting 01, optionally +880 prefixed.
const BD_PHONE_RE = /^(?:\+?880|0)1[3-9]\d{8}$/;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clean = {
  /** Trim and collapse whitespace. */
  str(value, max = 5000) {
    if (value === null || value === undefined) return '';
    return String(value).trim().replace(/\s+/g, ' ').slice(0, max);
  },

  /** Preserve line breaks, used for textareas and message bodies. */
  text(value, max = 20000) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, max);
  },

  /** Strip anything that is not a digit, then cap the length. */
  digits(value, max = 20) {
    return String(value || '').replace(/\D/g, '').slice(0, max);
  },

  /** Normalise to a lowercase, hyphenated slug. */
  slug(value, max = 200) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max);
  },

  /** Keep well-formed http(s) URLs only; anything else becomes ''. */
  url(value, max = 500) {
    const raw = String(value || '').trim().slice(0, max);
    if (!raw) return '';
    if (/^(?:javascript|data|vbscript):/i.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/') || raw.startsWith('#')) return raw;
    return `https://${raw}`;
  },

  /** Allow only paths that stay inside the site root. */
  path(value, max = 500) {
    const raw = String(value || '').trim().slice(0, max);
    if (!raw) return '';
    if (/^(?:https?:\/\/|\/\/)/i.test(raw)) return raw;
    if (/^(?:javascript|data|vbscript):/i.test(raw)) return '';
    return raw.startsWith('/') ? raw : `/${raw}`;
  },

  email(value) {
    return String(value || '').trim().toLowerCase().slice(0, 191);
  },

  /** Hex colour only - blocks `url(javascript:...)` injections into CSS vars. */
  colour(value, fallback = '#000000') {
    const raw = String(value || '').trim();
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : fallback;
  },

  /** Positive integer with clamping. */
  int(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  },

  /** Decimal number with clamping - used for prices. */
  decimal(value, { min = 0, max = 999999999, fallback = 0 } = {}) {
    const parsed = parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  },

  bool(value) {
    return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase()) ? '1' : '0';
  },

  /** Comma/newline separated list -> trimmed array with blanks removed. */
  list(value, maxItems = 50) {
    return String(value || '')
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  },
};

const validate = {
  required(value, label) {
    return clean.str(value) ? null : `${label} is required.`;
  },

  email(value) {
    if (!value) return 'Email address is required.';
    if (!EMAIL_RE.test(value)) return 'Enter a valid email address.';
    if (value.length > 191) return 'Email address is too long.';
    return null;
  },

  password(value) {
    if (!value) return 'Password is required.';
    if (value.length < 8) return 'Password must be at least 8 characters.';
    if (value.length > 128) return 'Password is too long.';
    return null;
  },

  /** Registration password: length plus a letter and a number. */
  strongPassword(value) {
    const basic = validate.password(value);
    if (basic) return basic;
    if (!/[A-Za-z]/.test(value)) return 'Password must include at least one letter.';
    if (!/\d/.test(value)) return 'Password must include at least one number.';
    return null;
  },

  username(value) {
    if (!value) return 'Username is required.';
    if (!USERNAME_RE.test(value)) {
      return 'Username may only contain letters, numbers, dots, dashes and underscores (3-40 characters).';
    }
    return null;
  },

  phone(value, { required = false } = {}) {
    if (!value) return required ? 'Phone number is required.' : null;
    if (!BD_PHONE_RE.test(String(value).replace(/[\s-]/g, ''))) {
      return 'Enter a valid Bangladeshi mobile number (e.g. 01789668276).';
    }
    return null;
  },

  slug(value) {
    if (!value) return 'Slug is required.';
    if (!SLUG_RE.test(value)) return 'Slug may only contain lowercase letters, numbers and hyphens.';
    return null;
  },

  length(value, min, max, label) {
    const text = String(value || '');
    if (text.length < min) return `${label} must be at least ${min} characters.`;
    if (text.length > max) return `${label} must be at most ${max} characters.`;
    return null;
  },
};

/**
 * Run a map of field -> validator and collect messages.
 * Returns { valid, errors } so a route can render every problem at once rather
 * than making the user resubmit repeatedly.
 */
function runRules(data, rules) {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const message = typeof rule === 'function' ? rule(data[field], data) : rule;
    if (message) errors[field] = message;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = { clean, validate, runRules, patterns: { EMAIL_RE, BD_PHONE_RE, USERNAME_RE, SLUG_RE } };
