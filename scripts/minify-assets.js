/**
 * Minify the public CSS and JavaScript.
 *
 *   node scripts/minify-assets.js [--check]
 *
 * Writes theme.min.css, dashboard.min.css, main.min.js and dashboard.min.js
 * beside their sources. helpers.versioned() serves the minified file when it is
 * at least as new as the source, and falls back to the source otherwise - so a
 * forgotten rebuild degrades to the unminified file rather than serving a stale
 * one.
 *
 * `--check` reports what would change and exits non-zero if anything is out of
 * date, for a CI step that wants to catch a forgotten rebuild.
 *
 * ---------------------------------------------------------------------------
 * The minifiers are devDependencies, and this must not need them
 *
 * They are build tooling: nothing at runtime requires clean-css or terser, and
 * the outputs are committed. So a deployment that installs production
 * dependencies only - which is the correct thing for it to do - does not have
 * them, and used to fail here with "Cannot find module 'clean-css'" and take
 * the whole build down with it.
 *
 * That failure was pointless. The minified files are already in the checkout,
 * so the deploy already has what it needs; regenerating them there is a
 * convenience, not a requirement. And a stale build cannot be served even if
 * one exists, because versioned() compares the two mtimes and serves the source
 * whenever the minified file is older.
 *
 * So a missing minifier is reported and skipped, never fatal. Moving these two
 * packages into `dependencies` would also make the build pass, and would ship a
 * few megabytes of build tooling to production for a step production does not
 * need to run.
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

/** A minifier, or null when it is not installed. */
function loadTool(name) {
  try {
    return require(name);
  } catch (err) {
    return null;
  }
}

async function minifyCss(source) {
  const CleanCSS = loadTool('clean-css');
  if (!CleanCSS) throw Object.assign(new Error('clean-css is not installed'), { missingTool: 'clean-css' });

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

async function minifyJs(source) {
  const terser = loadTool('terser');
  if (!terser) throw Object.assign(new Error('terser is not installed'), { missingTool: 'terser' });

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
  const missingTools = new Set();
  let written = 0;
  let current = 0;
  let stale = 0;

  for (const target of TARGETS) {
    const fromPath = path.join(PUBLIC, target.from);
    const toPath = path.join(PUBLIC, target.to);

    if (!fs.existsSync(fromPath)) {
      console.log(`  · ${target.from} is missing - skipped`);
      continue;
    }

    const source = fs.readFileSync(fromPath, 'utf8');
    const existing = fs.existsSync(toPath) ? fs.readFileSync(toPath, 'utf8') : null;

    let minified;
    try {
      minified = target.kind === 'css' ? await minifyCss(source) : await minifyJs(source);
    } catch (err) {
      if (!err.missingTool) throw err;

      missingTools.add(err.missingTool);
      // Nothing is lost: the committed build is already here, and versioned()
      // will not serve it if it has fallen behind its source.
      console.log(
        existing
          ? `  · ${target.to} kept as committed (${kb(Buffer.byteLength(existing))}) - ${err.missingTool} not installed`
          : `  ! ${target.to} not built - ${err.missingTool} is not installed, and no committed build exists`
      );
      continue;
    }

    if (CHECK) {
      if (existing !== minified) {
        console.log(`  ✗ ${target.to} is out of date`);
        stale += 1;
      } else {
        console.log(`  ✓ ${target.to} is current`);
        current += 1;
      }
      continue;
    }

    if (existing === minified) {
      console.log(`  = ${target.to} unchanged (${kb(Buffer.byteLength(minified))})`);
      current += 1;
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
    const built = new Date(fs.statSync(fromPath).mtimeMs + 1);
    fs.utimesSync(toPath, built, built);

    const saved = 100 - Math.round((Buffer.byteLength(minified) / Buffer.byteLength(source)) * 100);
    console.log(`  + ${target.to.padEnd(30)} ${kb(Buffer.byteLength(source))} → ${kb(Buffer.byteLength(minified))}  (-${saved}%)`);
    written += 1;
  }

  if (missingTools.size) {
    // Deliberately not an error. See the note at the top: the outputs are
    // committed, and a stale one cannot be served.
    console.log(
      `\n  ${[...missingTools].join(' and ')} not installed - the committed builds are being used as they are.`
    );
    console.log('  Run "npm install" (with devDependencies) and "npm run build:assets" to regenerate them.');
  }

  if (CHECK) {
    if (stale) {
      console.error(`\n  ${stale} asset(s) need rebuilding. Run: npm run build:assets`);
      process.exit(1);
    }
    console.log(`\n  ${current} asset(s) up to date${missingTools.size ? ' (unverified ones skipped)' : ''}.`);
    return;
  }

  console.log(written ? `\n  ${written} asset(s) minified.` : '\n  Nothing to do.');
})().catch((err) => {
  console.error('\n  Minification failed:', err.message);
  process.exit(1);
});
