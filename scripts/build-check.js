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
// Deploy readiness
//
// Everything Hostinger's Web App host needs from the project, checked here so a
// broken deploy contract fails the build rather than the deployment. Each of
// these has a specific failure mode in production:
//
//   no start script      -> the host has nothing to run, the app never starts
//   no engines           -> an unsupported Node is picked, native deps break
//   fixed host/port      -> binds where the proxy cannot reach it, 502
//   no UPLOAD_DIR hook   -> uploads are wiped by the next build rotation
//   .env not ignored     -> credentials get committed
// ---------------------------------------------------------------------------
console.log('\nChecking deploy readiness…');

{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  if (pkg.scripts && pkg.scripts.start) {
    pass(`start script present ("${pkg.scripts.start}")`);
  } else {
    fail('package.json has no start script - the host would not know how to run the app');
  }

  if (pkg.engines && pkg.engines.node) {
    pass(`Node range declared (${pkg.engines.node})`);
  } else {
    fail('package.json declares no engines.node - the host may pick an unsupported Node');
  }

  // The app must not hardcode where it listens: the host injects PORT and the
  // proxy has to be able to reach it.
  const configSrc = fs.readFileSync(path.join(ROOT, 'src', 'config', 'index.js'), 'utf8');

  if (/process\.env\.PORT/.test(configSrc)) {
    pass('PORT is read from the environment');
  } else {
    fail('PORT is not read from process.env - the host-injected port would be ignored');
  }

  // A host defaulting to 127.0.0.1 is unreachable from the proxy.
  if (/host:.*process\.env\.HOST\s*\|\|\s*['"]0\.0\.0\.0['"]/.test(configSrc)) {
    pass('HOST defaults to 0.0.0.0');
  } else if (/process\.env\.HOST/.test(configSrc)) {
    warn('HOST is configurable - confirm it defaults to 0.0.0.0, not 127.0.0.1');
  } else {
    fail('HOST is not configurable - binding to 127.0.0.1 is unreachable behind the proxy');
  }

  if (/process\.env\.UPLOAD_DIR/.test(configSrc)) {
    pass('UPLOAD_DIR lets uploads survive a redeploy');
  } else {
    fail('uploads path is fixed - Hostinger build rotation would delete user uploads');
  }

  if (/process\.env\.TRUST_PROXY/.test(configSrc)) {
    pass('TRUST_PROXY is configurable (needed for secure cookies behind the proxy)');
  } else {
    fail('TRUST_PROXY is not configurable - sessions will not stick behind the proxy');
  }

  // A committed .env would publish every credential.
  const ignore = fs.existsSync(path.join(ROOT, '.gitignore'))
    ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    : '';

  const requiredIgnores = ['.env', 'node_modules'];
  const missing = requiredIgnores.filter((entry) => !new RegExp(`^${entry.replace('.', '\\.')}\\b`, 'm').test(ignore));

  if (!missing.length) {
    pass('.gitignore covers .env and node_modules');
  } else {
    fail(`.gitignore is missing: ${missing.join(', ')}`);
  }

  // .env.example must not carry real values.
  const examplePath = path.join(ROOT, '.env.example');
  if (fs.existsSync(examplePath)) {
    const example = fs.readFileSync(examplePath, 'utf8');
    // A populated secret-looking value that is not an obvious placeholder.
    const suspicious = [...example.matchAll(/^([A-Z_]*(?:SECRET|PASSWORD|KEY|TOKEN)[A-Z_]*)=(.+)$/gmi)]
      .filter(([, , value]) => {
        const v = value.replace(/^["']|["']$/g, '').trim();
        return v.length >= 8 && !/^(CHANGE_ME|your-|xxx|<|placeholder)/i.test(v);
      })
      .map(([, key]) => key);

    if (!suspicious.length) {
      pass('.env.example carries no real credentials');
    } else {
      fail(`.env.example looks like it has real values for: ${suspicious.join(', ')}`);
    }
  }

  // The health endpoint is what the host probes.
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (/healthz/.test(serverSrc)) {
    pass('a /healthz endpoint exists for the host to probe');
  } else {
    warn('no /healthz endpoint - the host has no way to tell a live app from a hung one');
  }
}

// ---------------------------------------------------------------------------
// Error-path renderability
//
// Every local the context middleware sets inside its try block must ALSO be
// defaulted before it. The try block reads the database; when that fails the
// error handler renders a template through a LAYOUT, which reads those same
// locals. If any is only set on the success path, the layout throws, the render
// fails, and Express falls through to its built-in handler - so the visitor
// sees a bare "Internal Server Error" and the real cause is buried.
//
// This is the worst failure mode there is: the one moment you need a readable
// error page is the moment you cannot render one.
// ---------------------------------------------------------------------------
console.log('\nChecking error-path renderability…');

{
  const ctxPath = path.join(ROOT, 'src', 'middleware', 'context.js');
  const src = fs.readFileSync(ctxPath, 'utf8');

  const handlerStart = src.indexOf('function viewContext');
  const tryAt = src.indexOf('try {', handlerStart);
  const catchAt = src.indexOf('} catch (err) {', tryAt);

  if (handlerStart < 0 || tryAt < 0 || catchAt < 0) {
    fail('could not locate the viewContext try/catch - the check needs updating');
  } else {
    const before = src.slice(handlerStart, tryAt);
    const inside = src.slice(tryAt, catchAt);

    const names = (text) =>
      new Set([...text.matchAll(/res\.locals\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]));

    const defaulted = names(before);
    const setInTry = names(inside);

    const unguarded = [...setInTry].filter((name) => !defaulted.has(name)).sort();

    if (!unguarded.length) {
      pass(`all ${setInTry.size} context locals are defaulted before the database is touched`);
    } else {
      fail(
        `these locals are set only inside viewContext's try block, so a failed database ` +
          `would leave them undefined and break the error page: ${unguarded.join(', ')}`
      );
    }
  }

  // The error templates must not read an unguarded local either.
  for (const name of ['403', '404', '500']) {
    const file = path.join(ROOT, 'views', 'errors', `${name}.ejs`);
    if (!fs.existsSync(file)) continue;

    const body = fs.readFileSync(file, 'utf8');
    const guards = new Set([
      ...[...body.matchAll(/typeof\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    ]);

    const reads = [...body.matchAll(/<%[=-]([\s\S]*?)%>/g)]
      .map((m) => m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""'))
      .join(' ')
      .match(/(?:^|[^.\w$])(currentUrl|requestedPath|message|stack|title)\b/g) || [];

    const bare = [...new Set(reads.map((r) => r.trim()))].filter((n) => !guards.has(n));

    if (!bare.length) {
      pass(`errors/${name}.ejs guards every local it reads`);
    } else {
      fail(`errors/${name}.ejs reads ${bare.join(', ')} without a typeof guard - the error page can throw`);
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
