/**
 * Minify the public CSS and JavaScript.
 *
 *   node scripts/minify-assets.js [--check]
 *
 * Writes theme.min.css, dashboard.min.css, main.min.js and dashboard.min.js
 * beside their sources. helpers.versioned() serves the minified file when it is
 * at least as new as the source, and falls back to the source otherwise - so a
 * forgotten rebuild degrades to the unminified file rather than serving a stale
 * one, and a deploy that never runs this still works.
 *
 * `--check` reports what would change and exits non-zero if anything is out of
 * date, for a CI step that wants to catch a forgotten rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const TARGETS = [
  { from: 'assets/css/theme.css', to: 'assets/css/theme.min.css', kind: 'css' },
  { from: 'assets/css/dashboard.css', to: 'assets/css/dashboard.min.css', kind: 'css' },
  { from: 'assets/js/main.js', to: 'assets/js/main.min.js', kind: 'js' },
  { from: 'assets/js/dashboard.js', to: 'assets/js/dashboard.min.js', kind: 'js' },
];

const CHECK = process.argv.includes('--check');

const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB';

async function minifyCss(source) {
  const CleanCSS = require('clean-css');

  const result = new CleanCSS({
    level: 2,
    // Every url() in these files is already root-relative, and rebasing them
    // would rewrite paths that the static handler expects verbatim.
    rebase: false,
  }).minify(source);

  if (result.errors && result.errors.length) {
    throw new Error(result.errors.join('; '));
  }

  return result.styles;
}

async function minifyJs(source, file) {
  const terser = require('terser');

  const result = await terser.minify(source, {
    // Keep it parseable and debuggable in a browser: no mangled top-level
    // names, and one line per statement is not worth the bytes here.
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
    // The files are plain scripts, not modules.
    sourceMap: false,
  });

  if (result.error) throw new Error(String(result.error));

  return result.code;
}

(async () => {
  const results = [];
  let stale = 0;

  for (const target of TARGETS) {
    const fromPath = path.join(PUBLIC, target.from);
    const toPath = path.join(PUBLIC, target.to);

    if (!fs.existsSync(fromPath)) {
      console.log(`  · ${target.from} is missing - skipped`);
      continue;
    }

    const source = fs.readFileSync(fromPath, 'utf8');
    const minified = target.kind === 'css' ? await minifyCss(source) : await minifyJs(source, target.from);

    const sourceStat = fs.statSync(fromPath);
    const existing = fs.existsSync(toPath) ? fs.readFileSync(toPath, 'utf8') : null;
    const upToDate = existing === minified;

    if (CHECK) {
      if (!upToDate) {
        console.log(`  ✗ ${target.to} is out of date`);
        stale += 1;
      } else {
        console.log(`  ✓ ${target.to} is current`);
      }
      continue;
    }

    if (upToDate) {
      console.log(`  = ${target.to} unchanged (${kb(Buffer.byteLength(minified))})`);
      continue;
    }

    fs.writeFileSync(toPath, minified);

    // Stamp the output one millisecond after the source.
    //
    // Matching the source's mtime exactly is what the "is the build current"
    // check wants, but utimesSync only writes millisecond precision while
    // statSync reports sub-millisecond - so an exact copy reads back as very
    // slightly OLDER than the source, and the check rejects a build that is
    // perfectly good. One millisecond forward is both honest (the build did
    // happen after the source was written) and unambiguous.
    const built = new Date(sourceStat.mtimeMs + 1);
    fs.utimesSync(toPath, built, built);

    const saved = 100 - Math.round((Buffer.byteLength(minified) / Buffer.byteLength(source)) * 100);
    console.log(`  + ${target.to.padEnd(30)} ${kb(Buffer.byteLength(source))} → ${kb(Buffer.byteLength(minified))}  (-${saved}%)`);
    results.push(target.to);
  }

  if (CHECK) {
    if (stale) {
      console.error(`\n  ${stale} asset(s) need rebuilding. Run: npm run build:assets`);
      process.exit(1);
    }
    console.log('\n  All assets are up to date.');
    return;
  }

  console.log(results.length ? `\n  ${results.length} asset(s) minified.` : '\n  Nothing to do.');
})().catch((err) => {
  console.error('\n  Minification failed:', err.message);
  process.exit(1);
});
