/**
 * Self-host the configured webfonts.
 *
 *   node scripts/fetch-fonts.js
 *
 * Reads the heading and body families from the settings table, asks Google for
 * the stylesheet, downloads the woff2 files for the subsets this site actually
 * needs, and writes public/assets/fonts/fonts.css pointing at them locally.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth doing
 *
 * Loading them from fonts.googleapis.com costs two extra origins before the
 * first paint: DNS, TLS and a round trip to googleapis.com for the stylesheet,
 * then the same again to gstatic.com for the font file. Measured against the
 * running site under Lighthouse's mobile throttling, removing the webfonts
 * entirely moved performance from 91 to 100, FCP from 2.8s to 0.9s and LCP from
 * 2.8s to 1.3s. Nothing else on the page was close to that.
 *
 * Self-hosting keeps the typeface and drops the third parties: same origin, so
 * no new connections, and the two files that matter can be preloaded because
 * their names are known in advance rather than discovered in a stylesheet.
 *
 * ---------------------------------------------------------------------------
 * Subsets
 *
 * Google returns seven subsets - latin, latin-ext, cyrillic, cyrillic-ext,
 * greek, greek-ext, vietnamese. A browser only downloads the ones whose
 * unicode-range its text needs, so the unused files cost nothing in bandwidth -
 * but their @font-face blocks are still parsed. Only latin and latin-ext are
 * kept, which is what this site's content can actually use.
 *
 * The output is committed, so a deployment never needs to reach Google.
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'fonts');

/** The subsets worth keeping. Everything else is parsed for nothing. */
const SUBSETS = ['latin', 'latin-ext'];

/** Weights to fetch, per family role. */
const HEADING_WEIGHTS = [400, 500, 600, 700, 800];
const BODY_WEIGHTS = [400, 500, 600];

/** Preloaded in the page head: the two the first paint is most likely to need. */
const PRELOAD = [400, 700];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** A filesystem-safe name for a font family. */
const slug = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function googleCssUrl(families) {
  const params = families
    .map((f) => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.weights.join(';')}`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * Split a Google stylesheet into blocks, keeping the subset each belongs to.
 *
 * The subset is in a comment above each block rather than in the rule, so the
 * comment has to be carried along - a block with no subset label is dropped
 * rather than guessed at.
 */
function parseBlocks(css) {
  const blocks = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    blocks.push({ subset: m[1], rule: m[2] });
  }
  return blocks;
}

const field = (rule, name) => {
  const m = rule.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
};

(async () => {
  // The fonts come from the database so this follows the admin setting rather
  // than a hardcoded list that drifts from it.
  const db = require('../src/config/database');
  const settings = require('../src/services/settings.service');

  await settings.loadAll(true);

  const heading = String(settings.get('font_heading') || 'Inter').trim();
  const body = String(settings.get('font_body') || 'Inter').trim();

  const families = [];
  if (heading) families.push({ name: heading, weights: HEADING_WEIGHTS });
  // The same family twice with different weights is one request, not two.
  if (body && body !== heading) families.push({ name: body, weights: BODY_WEIGHTS });

  console.log(`  families: ${families.map((f) => `${f.name} (${f.weights.join(',')})`).join(' + ')}`);

  const url = googleCssUrl(families);
  const res = await fetch(url, { headers: { 'user-agent': UA } });

  if (!res.ok) {
    console.error(`  Google returned ${res.status} for the stylesheet.`);
    process.exit(1);
  }

  const css = await res.text();
  const blocks = parseBlocks(css).filter((b) => SUBSETS.includes(b.subset));

  if (!blocks.length) {
    console.error('  No usable @font-face blocks came back. Nothing was written.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // A fresh directory each run, so a weight that is no longer configured does
  // not linger as a file nothing references.
  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (existing.endsWith('.woff2')) fs.unlinkSync(path.join(OUT_DIR, existing));
  }

  const out = [
    '/*',
    ' * Self-hosted webfonts - generated by scripts/fetch-fonts.js. Do not edit.',
    ' *',
    ' * Regenerate after changing the font in Settings -> Typography:',
    ' *',
    ' *   npm run build:fonts',
    ' */',
    '',
  ];

  const manifest = [];
  let downloaded = 0;
  let bytes = 0;

  for (const block of blocks) {
    const family = field(block.rule, 'font-family');
    const weight = field(block.rule, 'font-weight') || '400';
    const srcMatch = block.rule.match(/url\(([^)]+)\)/);
    if (!family || !srcMatch) continue;

    const remote = srcMatch[1].replace(/^['"]|['"]$/g, '');
    const file = `${slug(family)}-${block.subset}-${weight}.woff2`;

    const fontRes = await fetch(remote, { headers: { 'user-agent': UA } });
    if (!fontRes.ok) {
      console.warn(`  ! ${family} ${weight} ${block.subset}: ${fontRes.status}`);
      continue;
    }

    const buf = Buffer.from(await fontRes.arrayBuffer());
    fs.writeFileSync(path.join(OUT_DIR, file), buf);

    bytes += buf.length;
    downloaded += 1;

    // The rule is rewritten to point at the local file and nothing else
    // changed - the unicode-range and the metrics stay exactly as Google
    // served them.
    out.push(block.rule.replace(/url\([^)]+\)/, `url(${file})`).replace(/\s*\n\s*/g, ' ').trim());
    out.push('');

    if (block.subset === 'latin') {
      manifest.push({ file, weight: Number(weight), family });
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), out.join('\n'));

  // The head needs the preload list, and it has to match the files on disk
  // rather than a guess at what Google would have named them.
  const preload = manifest
    .filter((entry) => PRELOAD.includes(entry.weight))
    .map((entry) => entry.file);

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ preload }, null, 2) + '\n');

  console.log(`\n  ${downloaded} font file(s), ${(bytes / 1024).toFixed(0)} KB total`);
  console.log(`  preloading: ${preload.join(', ') || '(none)'}`);

  await db.close();
})().catch(async (err) => {
  console.error('\n  Font fetch failed:', err.message);
  try {
    const db = require('../src/config/database');
    await db.close();
  } catch (e) { /* nothing to close */ }
  process.exit(1);
});
