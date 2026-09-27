/**
 * Blank every credential value in database/install.sql.
 *
 * install.sql is a seed file: it is committed, and it is imported by anyone
 * setting the project up. The settings table stores secrets UNENCRYPTED, so a
 * dump of it - or a regeneration from it - carries live credentials into the
 * repository. That is how the reCAPTCHA, SMTP and Google keys left this repo
 * once already.
 *
 * The key names are kept so the rows still exist and the installer still seeds
 * them; only the values are emptied. An operator fills them in on
 * Settings -> Security, SMTP and Google.
 *
 *   node scripts/scrub-install-sql.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const schema = require('../src/config/settings-schema');

const FILE = path.join(__dirname, '..', 'database', 'install.sql');

const source = fs.readFileSync(FILE, 'utf8');
const lines = source.split('\n');
const scrubbed = [];

const output = lines.map((line) => {
  let next = line;

  for (const key of schema.SECRET_KEYS) {
    // Rows look like: (135, 'chat_api_key', 'the-value', 'chat', 'text', '...')
    // The leading ", " is what anchors the key - matching on "('" alone would
    // never fire, because the id sits between the bracket and the key.
    const pattern = new RegExp("(,\\s*'" + key + "',\\s*)'[^']*'");
    if (!pattern.test(next)) continue;

    const before = next;
    next = next.replace(pattern, "$1''");
    if (next !== before) scrubbed.push(key);
  }

  return next;
});

if (!scrubbed.length) {
  console.log('install.sql is already clean - no secret value to blank.');
} else {
  fs.writeFileSync(FILE, output.join('\n'));
  console.log('Blanked ' + scrubbed.length + ' secret value(s) in install.sql:');
  for (const key of [...new Set(scrubbed)]) console.log('  - ' + key);
}
