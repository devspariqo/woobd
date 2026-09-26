/**
 * Post-install hook.
 *
 * Hostinger runs `npm install` on every deploy, so this must be fast, safe to
 * run repeatedly, and must never fail the install. It only creates the
 * directories the app writes to, which is the one thing that reliably does not
 * exist in a fresh checkout.
 *
 * It deliberately does NOT touch the database: schema creation is an explicit
 * `npm run setup` so a deploy cannot silently migrate production data.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function ensureDir(relative) {
  const target = path.join(ROOT, relative);
  try {
    fs.mkdirSync(target, { recursive: true });
    return target;
  } catch (err) {
    console.warn(`[postinstall] Could not create ${relative}: ${err.message}`);
    return null;
  }
}

// Subfolders must mirror storage.FOLDER_RULES, otherwise multer creates them
// lazily on first upload - which fails on hosts with a read-only build step.
const UPLOAD_SUBFOLDERS = [
  'uploads',
  'uploads/packages',
  'uploads/portfolio',
  'uploads/testimonials',
  'uploads/clients',
  'uploads/logos',
  'uploads/avatars',
  'uploads/media',
  'uploads/payments',
  'uploads/tickets',
  'uploads/posts',
];

function main() {
  for (const folder of UPLOAD_SUBFOLDERS) ensureDir(folder);

  // Uploaded files and local backups must never be committed, but the folders
  // themselves have to exist in git for the app to write into them.
  const keepFiles = ['uploads/.gitkeep'];
  for (const file of keepFiles) {
    const target = path.join(ROOT, file);
    if (!fs.existsSync(target)) {
      try {
        fs.writeFileSync(target, '');
      } catch {
        /* not fatal */
      }
    }
  }

  console.log('[postinstall] Upload directories ready.');

  // Point the operator at the next step without being noisy on a redeploy.
  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    console.log('[postinstall] No .env found. Copy .env.example to .env, then run: npm run setup');
  }
}

main();
