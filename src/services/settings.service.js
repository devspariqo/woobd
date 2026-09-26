/**
 * Settings service.
 *
 * Loads every settings row once into memory, casts it to the declared type and
 * serves it from cache. Admin writes invalidate the cache. The public view of
 * settings is filtered so a secret key can never be rendered into a page.
 */
'use strict';

const db = require('../config/database');
const schema = require('../config/settings-schema');
const logger = require('../utils/logger');

let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

/** Cast a stored string to the type declared in the schema. */
function cast(def, raw) {
  if (raw === null || raw === undefined) return def.default;
  switch (def.type) {
    case 'boolean':
      return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase()) ? '1' : '0';
    case 'number':
      return String(parseInt(raw, 10) || 0);
    default:
      return String(raw);
  }
}

async function loadAll(force = false) {
  const fresh = cache && !force && Date.now() - cacheLoadedAt < CACHE_TTL_MS;
  if (fresh) return cache;

  const values = schema.defaults();
  try {
    const rows = await db.query('SELECT setting_key, setting_value FROM settings');
    for (const row of rows) {
      const def = schema.BY_KEY[row.setting_key];
      // Unknown keys are ignored rather than trusted - a typo'd row should not
      // silently become a live setting.
      if (def) values[row.setting_key] = cast(def, row.setting_value);
    }
  } catch (err) {
    // A settings read failure must not take the site down; fall back to defaults.
    logger.error('Failed to load settings, using defaults', err);
  }

  cache = values;
  cacheLoadedAt = Date.now();
  return cache;
}

function invalidate() {
  cache = null;
  cacheLoadedAt = 0;
}

function get(key, fallback) {
  if (cache && Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  const def = schema.BY_KEY[key];
  if (def) return def.default;
  return fallback;
}

function getBool(key, fallback = false) {
  const value = get(key);
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getInt(key, fallback = 0) {
  const parsed = parseInt(get(key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Everything the public templates are allowed to see. */
function publicValues() {
  const out = {};
  for (const def of schema.SETTINGS) {
    if (def.public) out[def.key] = get(def.key);
  }
  return out;
}

/** Persist a batch of settings in one transaction. */
async function saveMany(pairs) {
  if (!pairs || typeof pairs !== 'object') return 0;
  const keys = Object.keys(pairs).filter((k) => schema.BY_KEY[k]);
  if (!keys.length) return 0;

  await db.transaction(async (conn) => {
    for (const key of keys) {
      const def = schema.BY_KEY[key];
      const value = pairs[key] === undefined || pairs[key] === null ? '' : String(pairs[key]);
      await conn.query(
        `INSERT INTO settings (setting_key, setting_value, setting_group, setting_type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value, def.group, def.type]
      );
    }
  });

  // Repopulate immediately rather than leaving the cache empty.
  //
  // get() falls back to each setting's DEFAULT when the cache is empty, so a
  // window where the cache is null is a window where the whole site renders
  // from factory defaults. Reloading here means even code that runs outside a
  // request (a script, a queued job) sees the values that were just written.
  invalidate();
  await loadAll(true);
  return keys.length;
}

/** Seed every declared setting with its default (idempotent). */
async function seedDefaults() {
  let created = 0;
  for (const def of schema.SETTINGS) {
    const result = await db.query(
      `INSERT IGNORE INTO settings (setting_key, setting_value, setting_group, setting_type)
       VALUES (?, ?, ?, ?)`,
      [def.key, def.default, def.group, def.type]
    );
    if (result.affectedRows > 0) created += 1;
  }
  invalidate();
  return created;
}

/**
 * Runtime credentials, preferring a live admin value and falling back to the
 * environment. Lets the operator rotate keys from the panel without a redeploy.
 */
function secret(key, envFallback) {
  const stored = get(key);
  if (stored && stored.trim() && !/^CHANGE_ME/i.test(stored.trim())) return stored.trim();
  return envFallback || '';
}

module.exports = {
  loadAll,
  invalidate,
  get,
  getBool,
  getInt,
  publicValues,
  saveMany,
  seedDefaults,
  secret,
};
