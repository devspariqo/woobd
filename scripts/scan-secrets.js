#!/usr/bin/env node
/**
 * Scan everything git would commit for live credential values.
 *
 * Run this before every push. It exists because the settings table stores
 * secrets UNENCRYPTED, which means any dump of it - or any seed file generated
 * from one - carries live keys into the repository. That is how this repo's
 * reCAPTCHA, SMTP, Google and assistant keys leaked once already.
 *
 *   node scripts/scan-secrets.js
 *
 * Exits 1 when anything is found, so it can gate a release.
 *
 * It matches the REAL values rather than patterns like "looks like an API key".
 * A pattern produces noise and still misses things; searching for the actual
 * string produces zero false positives and catches credentials no pattern would
 * recognise. Values are read from `.env` and from the `settings` table, because
 * this project has credentials in both.
 *
 * Only the file, line and variable name are printed - never the value, since
 * this output ends up in terminals and chat logs.
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const schema = require('../src/config/settings-schema');

/** Values shorter than this turn up coincidentally and are not worth matching. */
const MIN_LENGTH = 8;

const BINARY = /\.(png|jpe?g|webp|ico|gif|bmp|svgz|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp4|webm|mp3|exe|dll)$/i;

/** Real values from `.env`. */
function fromEnvironment() {
  const found = [];
  let raw;
  try {
    raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  } catch (err) {
    return found;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '').trim();
    if (value.length >= MIN_LENGTH && /SECRET|PASSWORD|KEY|TOKEN|PWD/i.test(match[1])) {
      found.push({ label: 'env:' + match[1], value });
    }
  }
  return found;
}

/** Real values from the settings table - the source install.sql is built from. */
async function fromDatabase() {
  const found = [];
  let db;

  try {
    db = require('../src/config/database');
    const rows = await db.query('SELECT setting_key, setting_value FROM settings');

    for (const row of rows) {
      const value = String(row.setting_value || '').trim();
      if (value.length < MIN_LENGTH) continue;
      const isSecret = schema.SECRET_KEYS.has(row.setting_key) || /secret|password|api_key|token/i.test(row.setting_key);
      if (isSecret) found.push({ label: 'db:' + row.setting_key, value });
    }
  } catch (err) {
    console.warn('  (settings table not reachable - scanned .env values only)');
  } finally {
    if (db) await db.close().catch(() => {});
  }

  return found;
}

/** Turn one .gitignore line into a matcher, or null for blanks and comments. */
function compileRule(rawLine) {
  let line = rawLine.replace(/\r$/, '').trim();
  if (!line || line.startsWith('#')) return null;

  let negate = false;
  if (line.startsWith('!')) {
    negate = true;
    line = line.slice(1);
  }

  // A trailing slash means "directories only".
  const dirOnly = line.endsWith('/');
  if (dirOnly) line = line.slice(0, -1);

  // A leading slash anchors to the repository root; without one the pattern
  // matches at any depth.
  const anchored = line.startsWith('/');
  if (anchored) line = line.slice(1);

  const escaped = line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  const body = anchored ? '^' + escaped : '(^|/)' + escaped;

  return { re: new RegExp(body + '(/|$)', 'i'), negate, dirOnly, name: line };
}

function loadIgnoreRules(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  } catch (err) {
    return [];
  }
  return raw.split('\n').map(compileRule).filter(Boolean);
}

/**
 * Walk the tree, honouring .gitignore.
 *
 * `git ls-files` is the authoritative answer and is tried first. Spawning a
 * process is blocked in some sandboxes, so the walk is the fallback - and it
 * applies the same rules, last match winning, which is how git resolves them.
 */
function walkFiles(root) {
  const rules = loadIgnoreRules(root);
  const out = [];

  function ignored(relative, isDir) {
    let verdict = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.re.test(relative)) verdict = !rule.negate;
    }
    return verdict;
  }

  (function visit(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.name === '.git') continue;
      if (ignored(relative, entry.isDirectory())) continue;

      if (entry.isDirectory()) visit(path.join(dir, entry.name), relative);
      else out.push(relative);
    }
  })(root, '');

  return out;
}

/** The files git would actually commit. */
function committableFiles() {
  const root = path.join(__dirname, '..');
  let listed;

  try {
    listed = execSync('git ls-files --cached --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    listed = listed.split('\n');
  } catch (err) {
    // Process spawning is unavailable - fall back to walking the tree.
    listed = walkFiles(root);
  }

  return listed
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !BINARY.test(file));
}

(async () => {
  const secrets = [...fromEnvironment(), ...(await fromDatabase())];

  if (!secrets.length) {
    console.log('No credential values found to scan for. Is .env present?');
    return;
  }

  let files;
  try {
    files = committableFiles();
  } catch (err) {
    console.error('Could not list files from git: ' + err.message);
    process.exitCode = 1;
    return;
  }

  const leaks = new Map();

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    } catch (err) {
      continue;
    }

    for (const { label, value } of secrets) {
      const at = text.indexOf(value);
      if (at < 0) continue;
      const line = text.slice(0, at).split('\n').length;
      if (!leaks.has(file)) leaks.set(file, []);
      leaks.get(file).push({ line, label });
    }
  }

  console.log(`Scanned ${files.length} file(s) that git would commit, against ${secrets.length} real value(s).\n`);

  if (!leaks.size) {
    console.log('  Clean - no credential value found in any committed file.\n');
    return;
  }

  for (const [file, hits] of leaks) {
    for (const hit of hits) console.log(`  LEAK  ${file}:${hit.line}  (${hit.label})`);
  }

  console.log(`\n  ${[...leaks.values()].reduce((n, h) => n + h.length, 0)} leak(s).`);
  console.log('  Blank the value in the file. If it was ever pushed, rotate the credential -');
  console.log('  removing it from a later commit does not remove it from the history.\n');
  process.exitCode = 1;
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
