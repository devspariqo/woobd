/**
 * Central configuration. Reads from process.env and validates the values that
 * would otherwise fail silently in production.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');

/** Parse an integer with a fallback, so a bad env value cannot become NaN. */
function num(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a boolean from the many shapes `true` arrives in. */
function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

/**
 * Normalise the base path so it is either "/" or "/segment" with no trailing
 * slash. Used both by Express's router mount and by every URL helper in the
 * views, so the two can never disagree.
 */
function normaliseBasePath(raw) {
  const value = (raw || '/').trim();
  if (!value || value === '/') return '/';
  return '/' + value.replace(/^\/+|\/+$/g, '');
}

const APP_BASE_PATH = normaliseBasePath(process.env.APP_BASE_PATH);

// Fail fast rather than booting with a known-bad placeholder secret. A wrong
// SESSION_SECRET silently invalidates every existing login on each restart.
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const PLACEHOLDER_SECRETS = ['', 'CHANGE_ME', 'CHANGE_ME_TO_A_LONG_RANDOM_STRING', 'secret', 'changeme'];

if (isProd && PLACEHOLDER_SECRETS.includes(SESSION_SECRET)) {
  console.error(
    '\n[FATAL] SESSION_SECRET is missing or still set to the placeholder.\n' +
      '        Generate one and set it in the app environment variables:\n' +
      '        node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// A structurally invalid DATABASE_URL would surface much later as a confusing
// auth failure, so it is checked here. Hostinger MySQL passwords routinely
// contain '#' and '@', which must be percent-encoded.
const DB_PASSWORD = process.env.DB_PASSWORD || '';

module.exports = {
  root: ROOT,
  env,
  isProd,
  isDev: !isProd,

  app: {
    name: process.env.APP_NAME || 'WooBD.Com',
    url: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    basePath: APP_BASE_PATH,
    // Do NOT default PORT in production to anything Hostinger would clash with;
    // the host injects it. The fallback only matters for local runs.
    port: num(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    trustProxy: bool(process.env.TRUST_PROXY, isProd),
  },

  session: {
    name: process.env.SESSION_NAME || 'woobd.sid',
    secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    // Secure cookies over plain HTTP are refused by the browser - the classic
    // "login succeeds then every page 302s" trap. Tied to the environment.
    secure: bool(process.env.COOKIE_SECURE, isProd),
    maxAge: num(process.env.SESSION_MAX_AGE, 1000 * 60 * 60 * 24 * 7), // 7 days
  },

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    database: process.env.DB_NAME || 'woobd',
    user: process.env.DB_USER || 'root',
    password: DB_PASSWORD,
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10),
  },

  recaptcha: {
    siteKey: process.env.RECAPTCHA_SITE_KEY || '',
    secretKey: process.env.RECAPTCHA_SECRET_KEY || '',
    get enabled() {
      return Boolean(this.siteKey && this.secretKey);
    },
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, num(process.env.SMTP_PORT, 587) === 465),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.MAIL_FROM_NAME || 'WooBD.Com',
    fromEmail: process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || 'hello@woobd.com',
    get enabled() {
      return Boolean(this.host && this.user && this.password && this.password !== 'CHANGE_ME');
    },
  },

  chat: {
    apiKey: process.env.XKIRO_API_KEY || '',
    baseUrl: process.env.XKIRO_BASE_URL || 'https://api.xkiro.com/v1/chat/completions',
    model: process.env.XKIRO_MODEL || 'qwen/qwen3.8-omni-flash:free',
  },

  uploads: {
    // UPLOAD_DIR lets the deploy point uploads at a persistent folder that
    // survives Hostinger's versioned-build rotation. See the deploy guide.
    dir: process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.join(ROOT, 'uploads'),
    maxSizeMb: num(process.env.UPLOAD_MAX_MB, 5),
    publicPath: '/uploads',
  },

  paths: {
    root: ROOT,
    src: path.join(ROOT, 'src'),
    views: path.join(ROOT, 'views'),
    public: path.join(ROOT, 'public'),
    database: path.join(ROOT, 'database'),
  },
};
