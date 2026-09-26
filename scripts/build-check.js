/**
 * Build verification for Hostinger.
 *
 * Hostinger runs `npm run build` before starting the app. Rather than
 * pretending to compile anything, this script proves the three things that
 * actually break this app on a fresh deploy:
 *
 *   1. every require() target resolves (a missing file is an instant 500)
 *   2. every EJS template compiles (a syntax error is an instant 500)
 *   3. every view compiles against the layouts it declares
 *
 * Catching these here turns a live 500 into a failed build with a file name.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const VIEWS = path.join(ROOT, 'views');

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

/** Recursively collect files with a given extension. */
function walk(dir, extension, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, extension, out);
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Module resolution
// ---------------------------------------------------------------------------
console.log('\nChecking module resolution…');

const jsFiles = [...walk(SRC, '.js'), path.join(ROOT, 'server.js')].filter((f) => fs.existsSync(f));

for (const file of jsFiles) {
  const source = fs.readFileSync(file, 'utf8');

  // Only relative requires are checked here; npm packages are left to node,
  // which resolves them at runtime and reports a clearer error than we could.
  const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    const target = path.resolve(path.dirname(file), match[1]);
    const candidates = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      fail(`${path.relative(ROOT, file)} requires "${match[1]}" which does not exist`);
    }
  }
}

if (failures === 0) pass(`${jsFiles.length} files, all relative imports resolve`);

// ---------------------------------------------------------------------------
// 2. Template compilation
// ---------------------------------------------------------------------------
console.log('\nChecking EJS templates…');

let ejs;
try {
  ejs = require('ejs');
} catch {
  fail('ejs is not installed - run npm install first');
  console.error('\nBuild check failed.\n');
  process.exit(1);
}

const templates = walk(VIEWS, '.ejs');
const compiled = [];

for (const file of templates) {
  const relative = path.relative(ROOT, file);
  try {
    // compile() parses the template without executing it, which is exactly the
    // level of check we want - no data is available at build time.
    ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file, client: false });
    compiled.push(relative);
  } catch (err) {
    fail(`${relative}: ${err.message.split('\n')[0]}`);
  }
}

if (compiled.length) pass(`${compiled.length} templates compile`);

// ---------------------------------------------------------------------------
// 3. Layout references
// ---------------------------------------------------------------------------
console.log('\nChecking layout references…');

const layoutDir = path.join(VIEWS, 'layouts');
const availableLayouts = fs.existsSync(layoutDir)
  ? fs.readdirSync(layoutDir).map((name) => `layouts/${name.replace(/\.ejs$/, '')}`)
  : [];

for (const file of templates) {
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /layout:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (!availableLayouts.includes(match[1])) {
      fail(`${path.relative(ROOT, file)} declares layout "${match[1]}" which does not exist`);
    }
  }
}

pass(`${availableLayouts.length} layouts available: ${availableLayouts.join(', ')}`);

// ---------------------------------------------------------------------------
// 4. Include references resolve
// ---------------------------------------------------------------------------
console.log('\nChecking partial includes…');

for (const file of templates) {
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /include\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) {
    const spec = match[1];
    // Skip dynamic includes such as include(page.ejs)
    if (!spec.startsWith('.') && !spec.startsWith('../')) continue;
    const base = path.resolve(path.dirname(file), spec);
    const candidates = [`${base}.ejs`, base];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      fail(`${path.relative(ROOT, file)} includes "${spec}" which does not exist`);
    }
  }
}

// ---------------------------------------------------------------------------
// Icon coverage
//
// A view referencing an icon id that the sprite does not define renders an
// empty <svg> - no error, no broken-image icon, just a blank space where an
// icon should be. That is easy to ship without noticing, so it is checked here.
// ---------------------------------------------------------------------------
console.log('\nChecking icon references…');

const spriteFile = path.join(ROOT, 'views', 'partials', 'icons.ejs');
if (!fs.existsSync(spriteFile)) {
  fail('views/partials/icons.ejs is missing');
} else {
  const sprite = fs.readFileSync(spriteFile, 'utf8');
  const defined = new Set([...sprite.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));

  const missing = new Map();
  for (const file of templates) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/href="#(i-[a-z0-9-]+)"/g)) {
      const id = match[1];
      if (defined.has(id)) continue;
      if (!missing.has(id)) missing.set(id, new Set());
      missing.get(id).add(path.relative(ROOT, file));
    }
  }

  if (missing.size === 0) {
    pass(`${defined.size} icons defined, every reference resolves`);
  } else {
    for (const [id, files] of missing) {
      fail(`icon "#${id}" is referenced but not defined (used in ${[...files].join(', ')})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Escaped attribute values
//
// The escaped output tag HTML-encodes its result, so using it to emit an
// attribute turns `target="_blank"` into `target=&#34;_blank&#34;`. The browser
// reads that as a broken attribute value: the attribute is present but does
// nothing. It is silent - the page renders, the link just does not open a new
// tab, the maxlength is just ignored.
//
// Emit attributes with a conditional block instead:
//   <% if (cond) { %>target="_blank"<% } %>
// ---------------------------------------------------------------------------
console.log('\nChecking for escaped attributes…');

{
  // Matches an escaped expression whose string literal contains an attribute.
  const pattern = /<%=\s*[^%]*?'[^']*?[a-z-]+="[^%]*?%>/g;
  const offenders = [];

  for (const file of templates) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      // Comments describing the trap are fine; only flag real output.
      const line = source.slice(0, match.index).split('\n').pop() || '';
      if (/^\s*<%#/.test(line)) continue;
      offenders.push(`${path.relative(ROOT, file)}: ${match[0].replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }

  if (offenders.length === 0) {
    pass('no attribute is emitted through an escaped output tag');
  } else {
    for (const offender of offenders.slice(0, 10)) {
      fail(`escaped attribute would be HTML-encoded: ${offender}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\nBuild check failed with ${failures} error(s).\n`);
  process.exit(1);
}

console.log('\nBuild check passed.\n');
