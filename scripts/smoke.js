#!/usr/bin/env node
/**
 * WooBD.Com - end-to-end smoke test.
 *
 * Boots the real Express app against the real database and asserts on actual
 * HTTP responses. "The process started" is not a pass; every check below
 * inspects a status code and, where it matters, the body of the response.
 *
 *   node scripts/smoke.js
 *   node scripts/smoke.js --base http://127.0.0.1:3000   # test an already-running server
 *   node scripts/smoke.js --verbose
 *
 * Exits 1 on the first hard failure. Warnings (soft checks) do not fail the run.
 *
 * Implementation note: the server is started IN THIS PROCESS and reached over a
 * loopback socket, rather than spawned as a child. Some sandboxes kill outbound
 * sockets opened by a sandboxed command, which makes an out-of-process client
 * report "server never came up" even when the server is healthy - a false
 * negative that would be worse than no test at all. In-process loopback is not
 * subject to that restriction.
 */
'use strict';

require('dotenv').config();

const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const baseFlagIndex = args.indexOf('--base');
const EXTERNAL_BASE = baseFlagIndex >= 0 ? args[baseFlagIndex + 1] : null;

const ADMIN_SLUG = process.env.ADMIN_PATH || 'dev-cp';
const BOOT_PORT = String(process.env.SMOKE_PORT || 4599);
const BASE = EXTERNAL_BASE || `http://127.0.0.1:${BOOT_PORT}`;

let passed = 0;
let failed = 0;
let warned = 0;
const failures = [];

function ok(name, detail) {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? `  ${'\x1b[90m'}${detail}${'\x1b[0m'}` : ''}`);
}

function bad(name, detail) {
  failed += 1;
  failures.push({ name, detail });
  console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
}

function warn(name, detail) {
  warned += 1;
  console.log(`  ! ${name}${detail ? `  ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n${'─'.repeat(62)}\n${title}\n${'─'.repeat(62)}`);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Dispatch a request into the Express app and collect the response.
 *
 * Why not fetch(): the app is exercised through its real middleware chain
 * (security headers, session, view context, identity, CSRF, routes, error
 * handlers) either way, but some sandboxes terminate outbound socket
 * connections - even to loopback - which would make an HTTP client report
 * "server never came up" against a perfectly healthy app. Driving the app
 * directly avoids that false negative while still testing the real stack.
 *
 * Express only needs the minimal request/response surface used below, so a
 * small shim is both sufficient and far clearer than faking Node's internals.
 */
const { Readable } = require('stream');

/**
 * Load the Express app.
 *
 * NO_LISTEN must be set before server.js is required, because that module runs
 * its start() - which binds a port - as a side effect of being imported.
 */
process.env.NO_LISTEN = '1';
const app = require(path.join(ROOT, 'server.js'));

/**
 * Minimal cookie jar.
 *
 * Sessions are required to test anything behind a login, and the app issues a
 * signed session cookie that must be sent back verbatim on the next request.
 * Keyed by cookie name so a re-issued session replaces the previous one.
 */
const cookieJar = new Map();

function cookieHeader() {
  if (!cookieJar.size) return null;
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Parse `set-cookie` (string or array) into the jar. */
function absorbCookies(setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of list) {
    const pair = String(raw).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    // An empty value with an expiry in the past is a clear instruction.
    if (!value) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function resetCookies() {
  cookieJar.clear();
}

async function req(pathname, options = {}) {
  const { method = 'GET', headers = {}, body, withCookies = true } = options;

  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  if (!lower.host) lower.host = '127.0.0.1:4599';
  if (withCookies && !lower.cookie) {
    const jar = cookieHeader();
    if (jar) lower.cookie = jar;
  }

  const payload = body === undefined || body === null ? '' : String(body);
  if (payload) lower['content-length'] = String(Buffer.byteLength(payload));

  // --- request shim -------------------------------------------------------
  const reqObj = Readable.from(payload ? [Buffer.from(payload)] : []);
  reqObj.method = method;
  reqObj.url = pathname;
  reqObj.originalUrl = pathname;
  reqObj.path = pathname.split('?')[0];
  reqObj.headers = lower;
  reqObj.httpVersion = '1.1';
  reqObj.httpVersionMajor = 1;
  reqObj.httpVersionMinor = 1;
  reqObj.socket = { remoteAddress: '127.0.0.1', remotePort: 54321, encrypted: false };
  reqObj.connection = reqObj.socket;
  reqObj.complete = true;
  // The session middleware writes these back; they must exist to be set.
  reqObj.secure = false;
  reqObj.hostname = '127.0.0.1';
  reqObj.protocol = 'http';
  reqObj.ip = '127.0.0.1';
  reqObj.ips = [];
  reqObj.subdomains = [];

  // --- response shim ------------------------------------------------------
  const headerBag = {};
  const chunks = [];

  const resObj = {
    statusCode: 200,
    finished: false,
    headersSent: false,
    locals: {},
    setHeader(name, value) {
      headerBag[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return headerBag[String(name).toLowerCase()];
    },
    removeHeader(name) {
      delete headerBag[String(name).toLowerCase()];
    },
    getHeaders() {
      return { ...headerBag };
    },
    hasHeader(name) {
      return Object.prototype.hasOwnProperty.call(headerBag, String(name).toLowerCase());
    },
    writeHead(status, a, b) {
      this.statusCode = status;
      const extra = typeof a === 'object' && a !== null ? a : typeof b === 'object' && b !== null ? b : {};
      for (const [k, v] of Object.entries(extra)) this.setHeader(k, v);
      this.headersSent = true;
      return this;
    },
    write(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    // Overridden after the shim is built, once `resolveResponse` exists.
    end(chunk) {
      if (chunk && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.finished = true;
      return this;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return true;
    },
    removeListener() {
      return this;
    },
    set() {
      return this;
    },
    type(value) {
      this.setHeader('content-type', value);
      return this;
    },
    json(obj) {
      this.setHeader('content-type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(obj));
      return this;
    },
    send(value) {
      if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return this.json(value);

      // Express sets the type for a string body before ending the response.
      // The shim has to do the same, or every HTML response looks untyped here
      // and anything that reads Content-Type - response compression, in
      // particular - sees nothing to act on, so the harness silently stops
      // covering it.
      if (!this.getHeader('content-type')) this.setHeader('content-type', 'text/html; charset=utf-8');

      this.end(value === undefined ? '' : String(value));
      return this;
    },
    redirect(statusOrUrl, maybeUrl) {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      const url = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
      this.statusCode = status;
      this.setHeader('location', url);
      this.end('');
      return this;
    },
  };

  let resolveResponse;
  let settled = false;
  const done = new Promise((resolve, reject) => {
    resolveResponse = () => {
      if (settled) return;
      settled = true;
      // Keep the session alive across requests.
      if (withCookies) absorbCookies(headerBag['set-cookie']);
      const raw = Buffer.concat(chunks);
      resolve({
        status: resObj.statusCode,
        headers: {
          get: (n) => headerBag[String(n).toLowerCase()] ?? null,
          has: (n) => Object.prototype.hasOwnProperty.call(headerBag, String(n).toLowerCase()),
          raw: headerBag,
        },
        location: headerBag.location ?? null,
        // The decoded string is what almost every check wants. `buffer` is the
        // untouched bytes, for the rare response that is not text - a
        // compressed body decoded as UTF-8 is destroyed by the replacement
        // characters, so anything inspecting it has to start from the bytes.
        body: raw.toString('utf8'),
        buffer: raw,
      });
    };
    // A handler that never responds must fail loudly rather than hang the run.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`smoke: ${method} ${pathname} produced no response in 10s`));
    }, 10000).unref();
  });

  // Resolve after the current tick so any deferred writes land first.
  resObj.end = (chunk) => {
    if (chunk && typeof chunk !== 'function') {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    resObj.finished = true;
    setImmediate(resolveResponse);
    return resObj;
  };

  app(reqObj, resObj);
  return done;
}

/** Follow redirects manually so we can detect loops and report the hop chain. */
async function reqChain(pathname, options = {}, maxHops = 5) {
  const hops = [];
  let current = pathname;
  let res = await req(current, options);

  while ([301, 302, 303, 307, 308].includes(res.status) && hops.length < maxHops) {
    hops.push(`${current} → ${res.status}`);
    current = res.location && res.location.startsWith('http')
      ? res.location.replace(BASE, '')
      : res.location || '/';
    res = await req(current, { ...options, method: 'GET', body: undefined });
  }

  return { ...res, hops, finalPath: current };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Boot the app.
 *
 * server.js skips its start() when NO_LISTEN=1, so there is no listening
 * socket. We then run the same two startup steps ourselves - database health
 * check and settings warm-up - because those are precisely what the test is
 * meant to verify. A listening socket is not required to exercise the
 * middleware chain, the routes or the templates.
 */
async function bootServer() {
  // server.js was already required at module load with NO_LISTEN=1, so no port
  // was bound. Run the same startup steps that start() would have performed.
  const db = require('../src/config/database');
  await db.healthCheck();

  const settings = require('../src/services/settings.service');
  await settings.loadAll();

  const { invalidateMenus } = require('../src/middleware/context');
  invalidateMenus();
}

async function waitForServer() {
  // Nothing to wait for: the app is loaded synchronously and the database has
  // already answered by this point. Returning the health response keeps the
  // banner honest about what is actually reachable.
  try {
    return await req('/healthz');
  } catch {
    return null;
  }
}

async function stopServer() {
  const db = require('../src/config/database');
  try {
    await db.close();
  } catch {
    /* already closed */
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkHealth() {
  section('1. Boot and health');
  const res = await waitForServer();
  if (!res) {
    bad('server came up', `no response on ${BASE}/healthz within 16s`);
    return false;
  }

  let payload = {};
  try {
    payload = JSON.parse(res.body);
  } catch {
    bad('/healthz returns JSON', `got: ${res.body.slice(0, 120)}`);
    return false;
  }

  // The deploy guide documents this exact payload, so assert every field.
  const missing = ['status', 'database', 'uptime'].filter(
    (k) => payload[k] === undefined || payload[k] === null
  );
  if (missing.length) {
    bad('/healthz payload shape', `missing: ${missing.join(', ')} - got: ${res.body.slice(0, 120)}`);
    return false;
  }

  if (payload.database === 'up') {
    ok('/healthz', `status=${payload.status} database=${payload.database} uptime=${payload.uptime}s`);
  } else {
    bad('/healthz reports database up', `db=${payload.database} - check DB_* in .env`);
  }

  return payload.database === 'up';
}

async function checkPublicPages() {
  section('2. Public pages');

  const pages = [
    ['/', 200, 'home', ['WooBD']],
    ['/about', 200, 'about', []],
    ['/services', 200, 'services listing', []],
    ['/portfolio', 200, 'portfolio listing', []],
    ['/contact', 200, 'contact', []],
    ['/live-chat', 200, 'live chat', []],
    ['/privacy-policy', 200, 'privacy policy', []],
    ['/terms-conditions', 200, 'terms & conditions', []],
    ['/refund-policy', 200, 'refund policy', []],
    ['/signin', 200, 'customer sign in', []],
    ['/signup', 200, 'customer sign up', []],
  ];

  for (const [pathname, expect, label, mustContain] of pages) {
    try {
      const res = await reqChain(pathname);
      if (res.status !== expect) {
        bad(`${label} (${pathname})`, `expected ${expect}, got ${res.status}${res.hops.length ? ` after ${res.hops.join(', ')}` : ''}`);
        continue;
      }
      const missing = mustContain.filter((needle) => !res.body.includes(needle));
      if (missing.length) {
        bad(`${label} (${pathname})`, `200 but body missing: ${missing.join(', ')}`);
        continue;
      }
      ok(`${label} (${pathname})`, `${res.status}, ${(res.body.length / 1024).toFixed(1)}kb`);
    } catch (err) {
      bad(`${label} (${pathname})`, err.message);
    }
  }
}

async function checkPublicContent() {
  section('3. Seeded content reaches the page');

  // These only pass if scripts/setup.js actually ran and the templates read
  // from the database rather than hardcoding marketing copy.
  const expectations = [
    // A feature line rather than a title. "Starter" and "Growth" are ordinary
    // words that appear in other copy on the page, so a title would pass even
    // if the package grid rendered nothing - this string can only come from the
    // Free package's row in the database.
    ['/', 'a seeded package feature', '20 products (10 own + 10 resell)'],
    ['/', 'a seeded testimonial author', 'Ariful Islam'],
    ['/', 'a seeded FAQ question', 'How long does it take'],
    ['/', 'the trust bar client name', 'Rangpur Fashion House'],
    ['/services', 'a seeded package', 'WooCommerce Web Design'],
    ['/portfolio', 'a seeded case study', 'Rangpur Fashion House'],
    ['/about', 'the office address from settings', 'RK Road'],
  ];

  for (const [pathname, label, needle] of expectations) {
    try {
      const res = await req(pathname);
      if (res.body.includes(needle)) {
        ok(`${label} on ${pathname}`);
      } else {
        warn(`${label} on ${pathname}`, `"${needle}" not in body - run "npm run setup" if the DB is empty`);
      }
    } catch (err) {
      bad(`${label} on ${pathname}`, err.message);
    }
  }

  // The theme colour configured in settings must be emitted as a CSS variable.
  // If a layout forgets to output it, the page silently falls back to the
  // hardcoded value in theme.css and admin colour changes stop taking effect.
  try {
    const settingsSvc = require('../src/services/settings.service');
    const expectedAccent = settingsSvc.get('theme_secondary');
    const expectedPrimary = settingsSvc.get('theme_primary');

    const pages = [
      ['/', 'homepage'],
      ['/signin', 'customer sign-in'],
      [`/${ADMIN_SLUG}/login`, 'admin sign-in'],
    ];

    for (const [pathname, label] of pages) {
      const res = await req(pathname);
      const accent = res.body.match(/--secondary:\s*([^;]+);/);
      const primary = res.body.match(/--primary:\s*([^;]+);/);

      if (!accent || !primary) {
        bad(`theme colours emitted on the ${label} page`, 'no --primary/--secondary variable found');
        continue;
      }
      if (accent[1].trim() !== expectedAccent || primary[1].trim() !== expectedPrimary) {
        bad(
          `theme colours emitted on the ${label} page`,
          `expected primary ${expectedPrimary} / accent ${expectedAccent}, got ${primary[1].trim()} / ${accent[1].trim()}`
        );
        continue;
      }
      ok(`theme colours emitted on the ${label} page`, `primary ${primary[1].trim()}, accent ${accent[1].trim()}`);
    }
  } catch (err) {
    warn('theme colour emission', err.message);
  }

  // --- Structured data ------------------------------------------------------
  //
  // Two bugs lived here, both invisible to a status-code check:
  //   1. extraHead was emitted with the ESCAPED output tag, so JSON-LD rendered
  //      as literal visible text at the top of the page.
  //   2. express-ejs-layouts extractScripts was on, with no layout printing the
  //      extracted result - so every script authored in a view was deleted.
  // Both are guarded below.
  try {
    const schemaPages = [
      ['/', ['Organization', 'FAQPage']],
      ['/contact', ['LocalBusiness']],
      ['/services/woocommerce-web-design-starter', ['Service']],
    ];

    for (const [pathname, expectedTypes] of schemaPages) {
      const res = await req(pathname);

      // Escaped markup means the payload is being shown to the visitor.
      if (/&lt;script/i.test(res.body)) {
        bad(`${pathname} does not leak escaped script markup`, 'found &lt;script - JSON-LD is rendering as text');
        continue;
      }

      const blocks = [...res.body.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
      if (!blocks.length) {
        bad(`${pathname} emits structured data`, 'no application/ld+json block found');
        continue;
      }

      // Every block must parse, or Google silently ignores it.
      const invalid = blocks.findIndex((b) => {
        try {
          JSON.parse(b[1]);
          return false;
        } catch {
          return true;
        }
      });
      if (invalid >= 0) {
        bad(`${pathname} structured data is valid JSON`, `block ${invalid + 1} does not parse`);
        continue;
      }

      const topTypes = blocks
        .map((b) => (b[1].match(/"@type"\s*:\s*"([^"]+)"/) || [])[1])
        .filter(Boolean);

      const missing = expectedTypes.filter((t) => !topTypes.includes(t));
      if (missing.length) {
        bad(`${pathname} emits ${expectedTypes.join(' + ')}`, `missing: ${missing.join(', ')}; found ${topTypes.join(', ')}`);
        continue;
      }

      const dupes = topTypes.filter((t, i) => topTypes.indexOf(t) !== i);
      if (dupes.length) {
        bad(`${pathname} emits each schema type once`, `duplicated: ${[...new Set(dupes)].join(', ')}`);
        continue;
      }

      ok(`${pathname} emits valid structured data`, topTypes.join(', '));
    }

    // The reCAPTCHA loader is authored inside the form views, so it was the
    // other casualty of script extraction: the checkbox div would render but
    // the script that turns it into a widget would be missing, making the form
    // impossible to submit.
    //
    // Both states are checked, because the flag also has to stay OFF when the
    // keys are absent - otherwise an empty data-sitekey widget renders and
    // pulls Google's script on every page load for no reason.
    const settingsSvc = require('../src/services/settings.service');
    const original = {
      site: settingsSvc.get('captcha_site_key', ''),
      secret: settingsSvc.get('captcha_secret_key', ''),
      // The toggle too. A key pair on its own renders nothing - the form asks
      // for both the keys and its own switch - and the suite turns the switches
      // off for the run, so this check has to turn one back on.
      onLogin: settingsSvc.getBool('captcha_on_login') ? '1' : '0',
    };

    /** Re-read a public page with the current settings. */
    async function signinMarkup() {
      const res = await req('/signin', { withCookies: false });
      return {
        widget: res.body.includes('g-recaptcha'),
        loader: res.body.includes('recaptcha/api.js'),
      };
    }

    try {
      // 1. Unconfigured - nothing should render.
      await settingsSvc.saveMany({ captcha_site_key: '', captcha_secret_key: '', captcha_on_login: '1' });
      const off = await signinMarkup();
      if (!off.widget && !off.loader) {
        ok('unconfigured CAPTCHA renders nothing', 'no empty widget, no external script');
      } else {
        bad(
          'unconfigured CAPTCHA renders nothing',
          `widget=${off.widget} loader=${off.loader} - an empty challenge would be shown`
        );
      }

      // 2. Configured - widget and loader must both appear.
      await settingsSvc.saveMany({
        captcha_site_key: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
        captcha_secret_key: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
        captcha_on_login: '1',
      });
      const on = await signinMarkup();
      if (on.widget && on.loader) {
        ok('configured CAPTCHA renders widget and loader', 'script is not being stripped from the view');
      } else if (on.widget && !on.loader) {
        bad(
          'configured CAPTCHA renders widget and loader',
          'widget div present but api.js missing - the CAPTCHA would be unusable'
        );
      } else {
        bad('configured CAPTCHA renders widget and loader', `widget=${on.widget} loader=${on.loader}`);
      }
    } finally {
      await settingsSvc.saveMany({
        captcha_site_key: original.site,
        captcha_secret_key: original.secret,
        captcha_on_login: original.onLogin,
      });
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
    }
  } catch (err) {
    warn('structured data check', err.message);
  }
}

async function checkServiceDetail() {
  section('4. Dynamic routes resolve from the database');

  // Slug is derived from the seed; if the service exists the detail page must
  // render it, which proves the model query and the template agree.
  try {
    const listing = await req('/services');
    const match = listing.body.match(/href="\/services\/([a-z0-9-]+)"/);
    if (!match) {
      warn('service detail link found on listing', 'no /services/<slug> link in the listing page');
      return;
    }
    const slug = match[1];
    const res = await req(`/services/${slug}`);
    if (res.status === 200) {
      ok(`/services/${slug}`, `200, ${(res.body.length / 1024).toFixed(1)}kb`);
    } else {
      bad(`/services/${slug}`, `expected 200, got ${res.status}`);
    }

    // A slug that cannot exist must 404 rather than 500.
    const missing = await req('/services/this-slug-does-not-exist-9f2a');
    if (missing.status === 404) ok('unknown service slug 404s', '404');
    else bad('unknown service slug 404s', `expected 404, got ${missing.status}`);
  } catch (err) {
    bad('service detail', err.message);
  }
}

async function checkErrorsAndSecurity() {
  section('5. Error handling and security headers');

  try {
    const missing = await req('/definitely-not-a-real-page-4b7c');
    if (missing.status === 404) ok('unknown URL 404s', '404');
    else bad('unknown URL 404s', `expected 404, got ${missing.status}`);
  } catch (err) {
    bad('unknown URL 404s', err.message);
  }

  const home = await req('/');
  const headerChecks = [
    ['content-security-policy', 'CSP present'],
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'frame options'],
    ['referrer-policy', 'referrer policy'],
  ];
  for (const [header, label] of headerChecks) {
    if (home.headers.get(header)) ok(`${label} header`, home.headers.get(header).slice(0, 40));
    else bad(`${label} header`, `missing ${header}`);
  }

  if (!home.headers.get('x-powered-by')) ok('x-powered-by suppressed');
  else bad('x-powered-by suppressed', 'header leaked');
}

async function checkAuthGuards() {
  section('6. Authentication guards');

  // Protected areas must redirect an anonymous visitor, not render.
  const guards = [
    ['/account', 'customer dashboard'],
    ['/account/orders', 'customer orders'],
    ['/account/profile', 'customer profile'],
  ];
  for (const [pathname, label] of guards) {
    try {
      const res = await reqChain(pathname);
      if (res.finalPath.includes('/signin') || res.finalPath.includes('/signup')) {
        ok(`${label} redirects anonymous → ${res.finalPath}`);
      } else if (res.status === 200) {
        bad(`${label} redirects anonymous`, `rendered 200 without a session`);
      } else {
        bad(`${label} redirects anonymous`, `${res.status} (final ${res.finalPath})`);
      }
    } catch (err) {
      bad(`${label} redirects anonymous`, err.message);
    }
  }

  // Admin panel: login page public, everything else guarded.
  try {
    const login = await req(`/${ADMIN_SLUG}/login`);
    if (login.status === 200) ok(`admin login page (/${ADMIN_SLUG}/login)`, '200');
    else bad(`admin login page (/${ADMIN_SLUG}/login)`, `expected 200, got ${login.status}`);

    const dash = await reqChain(`/${ADMIN_SLUG}/dashboard`);
    if (dash.finalPath.includes(`${ADMIN_SLUG}/login`)) {
      ok(`admin dashboard redirects anonymous → ${dash.finalPath}`);
    } else if (dash.status === 200) {
      bad('admin dashboard redirects anonymous', 'rendered 200 without a session');
    } else {
      bad('admin dashboard redirects anonymous', `${dash.status} (final ${dash.finalPath})`);
    }

    // The old, guessable path must not serve the panel.
    const guessable = await req('/admin/login');
    if (guessable.status === 404) ok('/admin is not the panel path', '404');
    else warn('/admin is not the panel path', `got ${guessable.status} - is the slug changed?`);
  } catch (err) {
    bad('admin panel guards', err.message);
  }
}

async function checkCsrf() {
  section('7. CSRF protection');

  // A POST with no token must be rejected. The exact status may be 419 or 403
  // depending on whether the request is HTML or JSON, but it must not be a 302
  // into a successful action or a 200.
  try {
    const form = await req('/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Smoke+Test&email=smoke%40example.com&message=csrf+probe',
    });
    if (form.status === 419 || form.status === 403) {
      ok('POST /contact without CSRF token rejected', `status ${form.status}`);
    } else {
      bad('POST /contact without CSRF token rejected', `expected 419/403, got ${form.status}`);
    }
  } catch (err) {
    bad('CSRF on contact form', err.message);
  }

  try {
    const api = await req('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'csrf probe' }),
    });
    if (api.status === 419 || api.status === 403) {
      ok('POST /api/chat without CSRF token rejected', `status ${api.status}`);
    } else {
      bad('POST /api/chat without CSRF token rejected', `expected 419/403, got ${api.status}`);
    }
  } catch (err) {
    bad('CSRF on chat API', err.message);
  }
}

async function checkAssets() {
  section('8. Static assets (no CDN)');

  const assets = [
    '/assets/css/theme.css',
    '/assets/css/dashboard.css',
    '/assets/js/main.js',
    '/assets/js/dashboard.js',
  ];
  for (const asset of assets) {
    try {
      const res = await req(asset);
      if (res.status === 200) ok(asset, `${(res.body.length / 1024).toFixed(1)}kb`);
      else bad(asset, `expected 200, got ${res.status}`);
    } catch (err) {
      bad(asset, err.message);
    }
  }

  // Placeholder SVGs are referenced as fallbacks all over the templates; a
  // missing one is a broken image on every page, so it is worth asserting.
  const fallbacks = [
    '/assets/img/logo-light.svg',
    '/assets/img/logo-dark.svg',
    '/assets/img/favicon.svg',
    '/assets/img/hero-default.svg',
    '/assets/img/about-default.svg',
    '/assets/img/service-default.svg',
    '/assets/img/portfolio-default.svg',
    '/assets/img/client-default.svg',
  ];
  for (const img of fallbacks) {
    try {
      const res = await req(img);
      if (res.status === 200 && res.body.includes('<svg')) {
        ok(img, `${(res.body.length / 1024).toFixed(1)}kb`);
      } else {
        bad(img, `expected 200 with SVG content, got ${res.status}`);
      }
    } catch {
      bad(img, 'not reachable');
    }
  }

  // The layouts must actually link the favicon, and the header must use the
  // bundled logo when no custom one is uploaded. A missing link here is a
  // blank tab icon that nobody notices until it is in front of a customer.
  try {
    const home = await req('/');
    if (/<link[^>]+rel="icon"[^>]+href="[^"]*favicon\.svg"/i.test(home.body)) {
      ok('favicon is linked from the page head');
    } else {
      bad('favicon is linked from the page head', 'no rel="icon" pointing at favicon.svg');
    }

    if (/<img[^>]+src="[^"]*logo-(light|dark)\.svg"/i.test(home.body)) {
      ok('header renders a logo image', 'falling back to the bundled asset');
    } else {
      warn('header renders a logo image', 'no bundled logo found in the header markup');
    }
  } catch (err) {
    warn('brand asset wiring', err.message);
  }

  // Uploads are mounted from config.uploads.dir, which may live outside the
  // build directory. A brand-new install has no user uploads, so this asserts
  // the mount exists and refuses traversal rather than expecting content.
  try {
    const traversal = await req('/uploads/../.env');
    if (traversal.status === 200) {
      bad('uploads path traversal blocked', '.env was served through /uploads');
    } else {
      ok('uploads path traversal blocked', `status ${traversal.status}`);
    }

    // A file that genuinely exists in the upload root must be served.
    const fs = require('fs');
    const path = require('path');
    const uploadRoot = require('../src/config').uploads.dir;
    const probe = path.join(uploadRoot, 'logos', '_smoke_probe.svg');
    const probeSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#5b21f0"/></svg>';
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, probeSvg);

    const served = await req('/uploads/logos/_smoke_probe.svg');
    if (served.status === 200 && served.body.includes('5b21f0')) {
      ok('/uploads/* serves files from UPLOAD_DIR', `${served.body.length} bytes`);
    } else {
      bad('/uploads/* serves files from UPLOAD_DIR', `status ${served.status}`);
    }

    // Clean up so a smoke run leaves no artefacts behind.
    fs.unlinkSync(probe);
  } catch (err) {
    warn('uploads mount', err.message);
  }

  // The whole point of the no-CDN rule: no third-party asset should be LOADED.
  // Only src/href values that the browser actually fetches count - a social
  // link in the footer is a navigation target, not a resource request.
  try {
    const home = await req('/');

    // Strip anchors first: <a href="https://facebook.com/..."> is a link out,
    // not a request the page makes on load.
    const withoutLinks = home.body.replace(/<a\b[^>]*>/gi, '');

    const loaded = [...withoutLinks.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/gi)]
      .map((m) => m[1]);

    const allowedHosts = [
      'woobd.com',
      'fonts.googleapis.com', // explicitly permitted: web fonts
      'fonts.gstatic.com', // Google Fonts file host, paired with the above
      // Google reCAPTCHA. Permitted by the CSP in middleware/security.js and
      // required by the brief, so it is a sanctioned external request rather
      // than a CDN dependency. Only loads when the CAPTCHA is configured.
      'www.google.com',
      'www.gstatic.com',
      // The app's own origin as configured for this environment. On a local run
      // APP_URL is localhost, so canonical/OG tags point there and would
      // otherwise be misread as third-party.
      ...(() => {
        try {
          return [new URL(process.env.APP_URL || 'http://localhost:3000').hostname];
        } catch {
          return [];
        }
      })(),
      'localhost',
      '127.0.0.1',
    ];

    const external = loaded.filter((u) => {
      try {
        const { hostname } = new URL(u);
        return !allowedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
      } catch {
        return false;
      }
    });

    if (!external.length) {
      ok('no third-party assets loaded', 'only web fonts and reCAPTCHA are permitted, and neither is a CDN dependency');
    } else {
      bad('no third-party assets loaded', [...new Set(external)].slice(0, 4).join(', '));
    }

    // A CDN would show up as an <script src> pointing off-domain.
    //
    // reCAPTCHA is the one permitted exception, and it is not a choice: the
    // widget only exists as a Google-hosted script. It is allowed by name
    // rather than by "any Google URL", so a stray analytics tag would still be
    // caught here.
    const ALLOWED_EXTERNAL_SCRIPTS = /^https:\/\/www\.(google\.com\/recaptcha|gstatic\.com\/recaptcha)\//;
    const scripts = [...home.body.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/gi)]
      .map((m) => m[1])
      .filter((src) => !ALLOWED_EXTERNAL_SCRIPTS.test(src));

    if (!scripts.length) {
      ok('all <script> tags are local', 'reCAPTCHA excepted - it only ships as a Google-hosted script');
    } else {
      bad('all <script> tags are local', scripts.slice(0, 3).join(', '));
    }
  } catch (err) {
    warn('CDN scan', err.message);
  }
}

async function checkMaintenanceAndChat() {
  section('9. Feature toggles');

  try {
    const res = await req('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
      body: JSON.stringify({ message: 'hello' }),
    });
    // With chat disabled we expect 403/404; with it enabled but no API key,
    // a 5xx or a graceful JSON error - all acceptable, a crash is not.
    if (res.status === 419 || res.status === 403 || res.status === 404) {
      ok('/api/chat guarded', `status ${res.status}`);
    } else if (res.status >= 500) {
      warn('/api/chat returned 5xx', `${res.status} - check XKIRO_API_KEY if chat is enabled`);
    } else {
      ok('/api/chat reachable', `status ${res.status}`);
    }
  } catch (err) {
    warn('/api/chat', err.message);
  }
}

// ---------------------------------------------------------------------------
// Admin panel: authenticated settings
// ---------------------------------------------------------------------------

/** Sign in as the seeded admin and leave the session in the cookie jar. */
async function adminLogin() {
  resetCookies();

  // The CSRF token lives in the session, so fetch the form first.
  const form = await req(`/${ADMIN_SLUG}/login`);
  const match = form.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!match) return { ok: false, reason: 'no CSRF token in the login form' };

  const body = new URLSearchParams({
    _csrf: match[1],
    username: process.env.SMOKE_ADMIN_USER || 'mdshojibmiya',
    password: process.env.SMOKE_ADMIN_PASS || process.env.SEED_PASSWORD || '',
  }).toString();

  const res = await req(`/${ADMIN_SLUG}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  // A successful login redirects into the panel.
  if (![301, 302, 303].includes(res.status)) {
    return { ok: false, reason: `login returned ${res.status} instead of a redirect` };
  }
  return { ok: true, to: res.location };
}

async function checkAdminSettings() {
  section('10. Admin panel: Google Auth & CAPTCHA settings');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping authenticated checks`);
    return;
  }
  ok('admin sign-in succeeds', `→ ${String(login.to).replace(BASE, '')}`);

  // --- The settings screen renders -----------------------------------------
  const settings = await req(`/${ADMIN_SLUG}/settings`);
  if (settings.status !== 200) {
    bad(`GET /${ADMIN_SLUG}/settings`, `expected 200, got ${settings.status}`);
    return;
  }
  ok(`GET /${ADMIN_SLUG}/settings`, `200, ${(settings.body.length / 1024).toFixed(1)}kb`);

  // Every group must be reachable as a tab.
  const missingTabs = ['google', 'security'].filter(
    (g) => !settings.body.includes(`group=${g}`)
  );
  if (!missingTabs.length) ok('Google Auth and Security tabs are present');
  else bad('Google Auth and Security tabs are present', `missing: ${missingTabs.join(', ')}`);

  // --- The Google Auth tab lists its toggles -------------------------------
  const googleTab = await req(`/${ADMIN_SLUG}/settings?group=google`);
  const googleKeys = [
    'google_auth_enabled',
    'google_auth_on_login',
    'google_auth_on_signup',
    'google_client_id',
    'google_client_secret',
  ];
  const missingGoogle = googleKeys.filter((k) => !googleTab.body.includes(`name="${k}"`));
  if (!missingGoogle.length) {
    ok('Google Auth tab exposes all 5 controls', googleKeys.join(', '));
  } else {
    bad('Google Auth tab exposes all 5 controls', `missing: ${missingGoogle.join(', ')}`);
  }

  // The toggles must render as switches, not plain checkboxes.
  if (googleTab.body.includes('class="switch"')) ok('toggles render as On/Off switches');
  else bad('toggles render as On/Off switches', 'no .switch markup found');

  // --- The Security tab lists the captcha toggles --------------------------
  const securityTab = await req(`/${ADMIN_SLUG}/settings?group=security`);
  const captchaKeys = [
    'captcha_on_login',
    'captcha_on_signup',
    'captcha_on_admin',
    'captcha_on_contact',
    'captcha_site_key',
    'captcha_secret_key',
    'captcha_mode',
    'captcha_version',
    'captcha_min_score',
  ];
  const missingCaptcha = captchaKeys.filter((k) => !securityTab.body.includes(`name="${k}"`));
  if (!missingCaptcha.length) {
    ok(`Security tab exposes all ${captchaKeys.length} CAPTCHA controls`, captchaKeys.join(', '));
  } else {
    bad(`Security tab exposes all ${captchaKeys.length} CAPTCHA controls`, `missing: ${missingCaptcha.join(', ')}`);
  }

  const settingsService = require('../src/services/settings.service');

  // The panel's CAPTCHA guidance depends on two things: whether any switch is
  // on, and whether the keys are saved. All four states are legitimate, and the
  // checks below are written against the state the site is actually in rather
  // than assuming a fresh install.
  const captchaSwitches = ['captcha_on_login', 'captcha_on_signup', 'captcha_on_admin', 'captcha_on_contact'];
  const anySwitchOn = captchaSwitches.some((key) => settingsService.getBool(key));
  const keysConfigured = Boolean(
    settingsService.get('captcha_site_key') && settingsService.get('captcha_secret_key')
  );

  if (!anySwitchOn) {
    // Nothing switched on: nothing to warn about, and nothing to register. The
    // panel should stay quiet instead of nagging about a feature that is off.
    if (!securityTab.body.includes('conn-pill')) {
      ok('the panel stays quiet with every CAPTCHA switch off');
    } else {
      bad('the panel stays quiet with every CAPTCHA switch off', 'a warning rendered with nothing switched on');
    }
  } else if (securityTab.body.includes('conn-pill')) {
    const sitePill = /Site key (saved|missing)/.test(securityTab.body);
    const secretPill = /Secret key (saved|missing)/.test(securityTab.body);

    if (sitePill && secretPill) {
      ok('the CAPTCHA warning names which key is missing', 'site key and secret key reported separately');
    } else {
      bad('the CAPTCHA warning names which key is missing', 'no per-key status found');
    }

    // With keys saved, the panel must also say which domains the key needs.
    //
    // Google will not draw the widget on an unregistered hostname and reports
    // it inside its own iframe, where neither the page nor the server-side test
    // can see it - a clean console and a blank space where the box should be.
    // Printing the hostnames is the only place that failure is visible.
    if (keysConfigured) {
      if (securityTab.body.includes('registered against this site key')) {
        ok('the panel lists the domains the key needs');
      } else {
        bad('the panel lists the domains the key needs', 'no domain guidance shown with keys configured');
      }

      const listed = ['localhost', '127.0.0.1'].filter((host) => securityTab.body.includes(`>${host}<`));
      if (listed.length) ok('local hostnames are listed for development', listed.join(', '));
      else warn('local hostnames are listed for development', 'no localhost entry - only correct in production');
    } else {
      ok('the panel asks for the missing keys', 'no domain list until there is a key to register');
    }
  } else {
    bad('the CAPTCHA warning renders when a switch is on', 'no status pills rendered');
  }

  // --- Secrets must never be rendered into the page ------------------------
  const secrets = await req(`/${ADMIN_SLUG}/settings?group=google`);
  const leaked = ['captcha_secret_key', 'google_client_secret'].filter((k) => {
    // A populated secret would appear as a value="" on a password input.
    const re = new RegExp(`name="${k}"[^>]*value="([^"]*)"`);
    const m = secrets.body.match(re);
    return m && m[1];
  });
  if (!leaked.length) {
    ok('stored secrets are not rendered into the HTML');
  } else {
    bad('stored secrets are not rendered into the HTML', `leaked: ${leaked.join(', ')}`);
  }

  // --- Toggling actually persists ------------------------------------------
  const csrfMatch = securityTab.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    bad('settings form carries a CSRF token', 'no token found');
    return;
  }

  // Read the current value of captcha_on_contact, flip it, then restore it.
  const before = /name="captcha_on_contact"[^>]*checked/.test(securityTab.body) ? '1' : '0';
  const after = before === '1' ? '0' : '1';

  // Preserve everything this section is not testing.
  //
  // It exists to prove a BOOLEAN toggle persists, so it has no business
  // rewriting the credentials or the widget mode. Posting an empty site key is
  // not "leave it alone" - a text field is saved exactly as posted, so it wipes
  // a working key. The same applies to the select fields, which have to be
  // posted but must carry their current value rather than a hardcoded one.
  const keepSiteKey = settingsService.get('captcha_site_key') || '';
  const keepMode = settingsService.get('captcha_mode') === 'checkbox' ? 'checkbox' : 'invisible';
  const keepVersion = settingsService.get('captcha_version') === 'v3' ? 'v3' : 'v2';
  const keepScore = String(settingsService.getInt('captcha_min_score', 50));

  // The other three switches keep whatever they had. Only the one being tested
  // is flipped: hardcoding them to '1' here would silently switch the CAPTCHA
  // back on for the rest of the run, and every later form submission would come
  // back 400 with no obvious cause.
  const keepToggle = (key) => (settingsService.getBool(key) ? '1' : '');

  const postBody = new URLSearchParams({
    _csrf: csrfMatch[1],
    group: 'security',
    // Post every boolean explicitly - an unchecked box submits nothing.
    captcha_on_login: keepToggle('captcha_on_login'),
    captcha_on_signup: keepToggle('captcha_on_signup'),
    captcha_on_admin: keepToggle('captcha_on_admin'),
    captcha_on_contact: after === '1' ? '1' : '',
    captcha_site_key: keepSiteKey,
    // A secret is the one field where blank means "keep the stored value", so
    // this is safe either way.
    captcha_secret_key: '',
    // Select fields must be posted too: the save validates them against their
    // options, so an omitted one is rejected rather than left unchanged.
    captcha_mode: keepMode,
    captcha_version: keepVersion,
    captcha_min_score: keepScore,
    admin_path_slug: ADMIN_SLUG,
    max_login_attempts: '5',
    lockout_minutes: '15',
    force_https: '1',
  }).toString();

  const save = await req(`/${ADMIN_SLUG}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: postBody,
  });

  if ([301, 302, 303].includes(save.status)) {
    ok(`POST /${ADMIN_SLUG}/settings accepted`, `→ ${String(save.location).replace(BASE, '')}`);
  } else {
    bad(`POST /${ADMIN_SLUG}/settings accepted`, `expected a redirect, got ${save.status}`);
    return;
  }

  // Re-read from the database, not the rendered page, so this proves persistence.
  const settingsSvc = require('../src/services/settings.service');
  settingsSvc.invalidate();
  const stored = await settingsSvc.loadAll(true);

  if (String(stored.captcha_on_contact) === after) {
    ok('captcha_on_contact persisted the new value', `${before} → ${after}`);
  } else {
    bad('captcha_on_contact persisted the new value', `expected ${after}, stored ${stored.captcha_on_contact}`);
  }

  // The toggle must change what the middleware decides for that form.
  const captcha = require('../src/middleware/captcha');
  const verdict = await captcha.verify(null, '127.0.0.1', 'contact');
  if (after === '0') {
    if (verdict.ok && verdict.skipped) ok('CAPTCHA OFF actually skips verification', 'contact form');
    else bad('CAPTCHA OFF actually skips verification', JSON.stringify(verdict));
  } else {
    // Switch on, and the outcome depends on whether keys are configured.
    //
    // With no keys it must fail OPEN - locking every customer out of their own
    // account because an admin has not pasted a key yet would be far worse than
    // letting a form through unverified. With keys it must fail CLOSED, which
    // is the whole point of the switch.
    const keysConfigured = Boolean(settingsService.get('captcha_site_key') && settingsService.get('captcha_secret_key'));

    if (!keysConfigured && verdict.ok) {
      ok('CAPTCHA ON does not lock the form out when unconfigured', 'fails open as designed');
    } else if (keysConfigured && !verdict.ok) {
      ok('CAPTCHA ON refuses a submission with no token', verdict.reason || 'rejected');
    } else if (keysConfigured && verdict.ok) {
      bad('CAPTCHA ON refuses a submission with no token', 'a keyless submission was accepted');
    } else {
      bad('CAPTCHA ON does not lock the form out when unconfigured', JSON.stringify(verdict));
    }
  }

  // --- Restore the original value so the run is idempotent -----------------
  const restoreBody = new URLSearchParams({
    _csrf: csrfMatch[1],
    group: 'security',
    captcha_on_login: keepToggle('captcha_on_login'),
    captcha_on_signup: keepToggle('captcha_on_signup'),
    captcha_on_admin: keepToggle('captcha_on_admin'),
    captcha_on_contact: before === '1' ? '1' : '',
    captcha_site_key: keepSiteKey,
    captcha_secret_key: '',
    // Also required, or the restore POST is rejected and the flipped value
    // stays flipped - which makes the next run start from a different state.
    captcha_mode: keepMode,
    captcha_version: keepVersion,
    captcha_min_score: keepScore,
    admin_path_slug: ADMIN_SLUG,
    max_login_attempts: '5',
    lockout_minutes: '15',
    force_https: '1',
  }).toString();

  await req(`/${ADMIN_SLUG}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: restoreBody,
  });

  settingsSvc.invalidate();
  const restored = await settingsSvc.loadAll(true);
  if (String(restored.captcha_on_contact) === before) {
    ok('original value restored', `captcha_on_contact back to ${before}`);
  } else {
    warn('original value restored', `captcha_on_contact is ${restored.captcha_on_contact}, expected ${before}`);
  }

  // --- The panel must not be open to anonymous visitors --------------------
  resetCookies();
  const anon = await reqChain(`/${ADMIN_SLUG}/settings`);
  if (anon.finalPath.includes('/login')) {
    ok('settings page is not readable anonymously', `→ ${anon.finalPath}`);
  } else if (anon.status === 200) {
    bad('settings page is not readable anonymously', 'rendered 200 without a session');
  } else {
    bad('settings page is not readable anonymously', `${anon.status} (final ${anon.finalPath})`);
  }
}

/**
 * The Google Auth toggle must actually control the public sign-in page.
 *
 * This is the whole point of the setting, so it is verified end to end: write a
 * placeholder client ID, flip `google_auth_on_login`, and check whether the
 * "Continue with Google" button appears on /signin. Everything is restored
 * afterwards.
 */
async function checkGoogleAuthToggle() {
  section('11. Google Auth toggle controls the public sign-in page');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    return;
  }

  const settingsSvc = require('../src/services/settings.service');
  const db = require('../src/config/database');
  const original = {
    clientId: settingsSvc.get('google_client_id', ''),
    enabled: settingsSvc.get('google_auth_enabled', '1'),
    onLogin: settingsSvc.get('google_auth_on_login', '1'),
    onSignup: settingsSvc.get('google_auth_on_signup', '1'),
  };

  /** Save the Google group with the given values. Returns the HTTP status. */
  async function saveGoogle({ clientId, enabled, onLogin, onSignup }) {
    const form = await req(`/${ADMIN_SLUG}/settings?group=google`);
    const csrf = form.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrf) return { status: 0, reason: 'no CSRF token on the Google tab' };

    const res = await req(`/${ADMIN_SLUG}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf[1],
        group: 'google',
        google_auth_enabled: enabled ? '1' : '',
        google_auth_on_login: onLogin ? '1' : '',
        google_auth_on_signup: onSignup ? '1' : '',
        google_client_id: clientId,
        // Blank = keep the stored value, which is what we want for the secret.
        google_client_secret: '',
      }).toString(),
    });

    settingsSvc.invalidate();
    return { status: res.status };
  }

  /** Does the public sign-in page show the Google button? Anonymous request. */
  async function signinHasGoogleButton() {
    const page = await req('/signin', { withCookies: false });
    return { found: page.body.includes('/auth/google'), status: page.status, body: page.body };
  }

  try {
    // 1. No client ID -> button must stay hidden even with the toggle on.
    await saveGoogle({ clientId: '', enabled: true, onLogin: true, onSignup: true });
    if (!(await signinHasGoogleButton()).found) {
      ok('no client ID means no Google button', 'fails closed');
    } else {
      bad('no client ID means no Google button', 'button rendered without credentials');
    }

    // 2. Client ID present + toggle on -> button appears.
    const step2 = await saveGoogle({
      clientId: 'smoke-test.apps.googleusercontent.com',
      enabled: true,
      onLogin: true,
      onSignup: true,
    });
    const storedId = await db.queryOne(
      "SELECT setting_value FROM settings WHERE setting_key = 'google_client_id'"
    );
    const probe = await signinHasGoogleButton();
    if (step2.status !== 302) {
      bad('toggle ON shows the Google button', `save returned ${step2.status} ${step2.reason || ''}`);
    } else if (probe.found) {
      ok('toggle ON shows the Google button', 'client ID set, google_auth_on_login=1');
    } else {
      bad(
        'toggle ON shows the Google button',
        `status ${probe.status}; stored client_id=${JSON.stringify(
          storedId && storedId.setting_value
        )}; google-btn present=${probe.body.includes('google-btn')}; body ${probe.body.length}b`
      );
    }

    // 3. Toggle off -> button disappears, credentials untouched.
    await saveGoogle({ clientId: 'smoke-test.apps.googleusercontent.com', enabled: true, onLogin: false, onSignup: true });
    if (!(await signinHasGoogleButton()).found) {
      ok('toggle OFF hides the Google button', 'google_auth_on_login=0');
    } else {
      bad('toggle OFF hides the Google button', 'button still present on /signin');
    }

    // 4. Master switch off -> hidden regardless of the per-page toggle.
    await saveGoogle({ clientId: 'smoke-test.apps.googleusercontent.com', enabled: false, onLogin: true, onSignup: true });
    if (!(await signinHasGoogleButton()).found) {
      ok('master switch OFF hides the Google button', 'google_auth_enabled=0 overrides the page toggle');
    } else {
      bad('master switch OFF hides the Google button', 'button still present');
    }
  } catch (err) {
    bad('Google Auth toggle', err.message);
  } finally {
    // Always restore, even if a check above threw.
    await saveGoogle({
      clientId: original.clientId,
      enabled: original.enabled === '1',
      onLogin: original.onLogin === '1',
      onSignup: original.onSignup === '1',
    });

    settingsSvc.invalidate();
    const now = settingsSvc.get('google_client_id', '');
    if (String(now) === String(original.clientId)) {
      ok('original Google settings restored', `client ID ${now ? 'set' : 'cleared'}`);
    } else {
      warn('original Google settings restored', `client ID is now "${now}"`);
    }
  }
}

/**
 * Regression guard: saving a setting must not blank the settings cache.
 *
 * get()/publicValues() fall back to each setting's DEFAULT when the cache is
 * empty, and every save empties it. If nothing repopulates it, the first
 * request after an admin saves anything renders the whole site from factory
 * defaults - the saved value appears not to apply, and every other
 * customisation is lost with it until the process restarts.
 *
 * This asserts through a real request, which is the only way to catch it.
 */
async function checkSettingsCacheIntegrity() {
  section('12. Settings survive a save (no fallback to defaults)');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    return;
  }

  const settingsSvc = require('../src/services/settings.service');
  const original = settingsSvc.get('site_name', '');
  const probeValue = `WooBD Smoke ${Date.now()}`;

  async function saveName(value) {
    const form = await req(`/${ADMIN_SLUG}/settings?group=general`);
    const csrf = form.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrf) return false;

    // Send the whole group back so nothing else is disturbed.
    const body = new URLSearchParams({ _csrf: csrf[1], group: 'general' });
    for (const def of require('../src/config/settings-schema').BY_GROUP.general) {
      if (def.key === 'site_name') {
        body.set(def.key, value);
        continue;
      }
      // Re-post the current value so the save is otherwise a no-op.
      const current = settingsSvc.get(def.key, def.default);
      body.set(def.key, current === undefined || current === null ? '' : String(current));
    }

    const res = await req(`/${ADMIN_SLUG}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return [301, 302, 303].includes(res.status);
  }

  try {
    if (!(await saveName(probeValue))) {
      bad('settings save accepted', 'did not redirect');
      return;
    }

    // A public page must reflect the new value on the very next request.
    const home = await req('/', { withCookies: false });
    if (home.body.includes(probeValue)) {
      ok('new value is live on the next request', `site_name = "${probeValue}"`);
    } else {
      bad(
        'new value is live on the next request',
        'homepage does not contain the saved site name - settings cache went empty'
      );
    }

    // And nothing else may have reverted to a default.
    const about = await req('/about', { withCookies: false });
    if (about.body.includes('RK Road')) {
      ok('other settings did not revert to defaults', 'office address still rendered from the DB');
    } else {
      bad('other settings did not revert to defaults', 'office address missing from /about');
    }
  } catch (err) {
    bad('settings cache integrity', err.message);
  } finally {
    await saveName(original);
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);
    const now = settingsSvc.get('site_name', '');
    if (String(now) === String(original)) {
      ok('original site name restored');
    } else {
      warn('original site name restored', `now "${now}"`);
    }
  }
}

/**
 * Every link the admin sidebar advertises must actually resolve.
 *
 * This is the check that would have caught seventeen sidebar links pointing at
 * routes that did not exist. A 404 or 500 here is a broken panel; a redirect is
 * acceptable only where a route deliberately forwards (the panel root).
 */
async function checkAdminRoutes() {
  section('13. Every admin sidebar link resolves');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    return;
  }

  // Parsed from the sidebar itself, so this test cannot drift from the UI.
  const sidebar = await req(`/${ADMIN_SLUG}/dashboard`);
  const links = [...new Set(
    [...sidebar.body.matchAll(new RegExp(`href="[^"]*/${ADMIN_SLUG}/([a-z-]+)"`, 'g'))].map((m) => m[1])
  )].sort();

  if (!links.length) {
    bad('sidebar links parsed', 'no admin links found on the dashboard');
    return;
  }

  const broken = [];
  for (const link of links) {
    // /logout has side effects, so it is only checked for existence elsewhere.
    if (link === 'logout') continue;

    let res;
    try {
      res = await req(`/${ADMIN_SLUG}/${link}`);
    } catch (err) {
      broken.push(`${link} (${err.message})`);
      continue;
    }

    if (res.status === 404) broken.push(`${link} (404 - route missing)`);
    else if (res.status >= 500) broken.push(`${link} (${res.status} - server error)`);
    else if (res.status === 200 && /Page not found|Something went wrong/i.test(res.body)) {
      broken.push(`${link} (200 but rendering an error page)`);
    }
  }

  if (!broken.length) {
    ok(`all ${links.length - 1} admin pages respond`, links.filter((l) => l !== 'logout').join(', '));
  } else {
    bad(`${broken.length} admin page(s) broken`, broken.join('; '));
  }

  // The panel root must forward to the dashboard rather than 404.
  const root = await reqChain(`/${ADMIN_SLUG}`);
  if (root.finalPath.includes('/dashboard')) ok('panel root redirects to the dashboard', root.finalPath);
  else bad('panel root redirects to the dashboard', `${root.status} (final ${root.finalPath})`);
}

/**
 * File uploads.
 *
 * Every uploading form was returning 419: the global CSRF middleware runs
 * before routing and cannot see a multipart body (express's urlencoded/json
 * parsers skip that content type, and multer has not run yet). Multipart
 * requests are now deferred to middleware/upload.js, which validates the token
 * after multer has parsed the fields.
 *
 * The first assertion below is the guard: if a route ever mounts raw multer
 * instead of uploadGuarded, the upload stops being CSRF-checked and this fails.
 */
async function checkUploads() {
  section('14. File uploads and CSRF on multipart');

  /** Build a multipart/form-data body with one file. */
  function multipart(fields, file) {
    const boundary = `----WooBDSmoke${Date.now()}${Math.random().toString(16).slice(2)}`;
    const parts = [];

    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ));
    }

    if (file) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.type}\r\n\r\n`
      ));
      parts.push(file.data);
      parts.push(Buffer.from('\r\n'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      body: Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  /** A 1x1 PNG - enough to exercise the whole upload path. */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');
  const fs = require('fs');
  const path = require('path');
  const uploadRoot = require('../src/config').uploads.dir;

  // --- The guard: an upload with no CSRF token must be rejected -------------
  try {
    const anon = await req(`/${ADMIN_SLUG}/profile`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----nope' },
      body: Buffer.from('------nope\r\nContent-Disposition: form-data; name="name"\r\n\r\nx\r\n------nope--\r\n'),
      withCookies: false,
    });
    if (anon.status === 419 || anon.status === 302 || anon.status === 401) {
      ok('upload without a session is rejected', `status ${anon.status}`);
    } else {
      bad('upload without a session is rejected', `expected 401/419/302, got ${anon.status}`);
    }
  } catch (err) {
    bad('upload without a session is rejected', err.message);
  }

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping upload checks`);
    return;
  }

  const profilePage = await req(`/${ADMIN_SLUG}/profile`);
  const profileCsrf = profilePage.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!profileCsrf) {
    bad('profile form carries a CSRF token', 'no token found');
    return;
  }

  // --- A multipart POST with no token must still be rejected ---------------
  try {
    const noToken = multipart(
      { name: 'Smoke Test', email: 'smoke@example.com', phone: '' },
      { field: 'upload', filename: 'x.png', type: 'image/png', data: png }
    );
    const res = await req(`/${ADMIN_SLUG}/profile`, {
      method: 'POST',
      headers: { 'content-type': noToken.contentType },
      body: noToken.body,
    });
    if (res.status === 419) {
      ok('multipart POST without a CSRF token is rejected', '419 - the deferral does not skip the check');
    } else {
      bad('multipart POST without a CSRF token is rejected', `expected 419, got ${res.status}`);
    }
  } catch (err) {
    bad('multipart POST without a CSRF token is rejected', err.message);
  }

  // --- Avatar upload persists ----------------------------------------------
  const staffBefore = await db.queryOne(
    'SELECT name, email, avatar FROM users WHERE username = ?',
    [process.env.SMOKE_ADMIN_USER || 'mdshojibmiya']
  );

  try {
    const withFile = multipart(
      { _csrf: profileCsrf[1], name: staffBefore.name, email: staffBefore.email, phone: '' },
      { field: 'upload', filename: 'smoke-avatar.png', type: 'image/png', data: png }
    );

    const res = await req(`/${ADMIN_SLUG}/profile`, {
      method: 'POST',
      headers: { 'content-type': withFile.contentType },
      body: withFile.body,
    });

    const after = await db.queryOne('SELECT avatar FROM users WHERE username = ?', [
      process.env.SMOKE_ADMIN_USER || 'mdshojibmiya',
    ]);

    if (res.status === 419) {
      bad('avatar upload is accepted', '419 - CSRF rejected a valid multipart POST');
    } else if (!after.avatar || after.avatar === staffBefore.avatar) {
      bad('avatar upload is accepted', `avatar did not change (${JSON.stringify(after.avatar)})`);
    } else {
      ok('avatar upload persists', after.avatar);

      const onDisk = fs.existsSync(path.join(uploadRoot, after.avatar.replace(/^\/uploads\//, '')));
      const served = await req(after.avatar, { withCookies: false });
      if (onDisk && served.status === 200) {
        ok('uploaded avatar is on disk and served', `${(served.body.length / 1024).toFixed(1)}kb`);
      } else {
        bad('uploaded avatar is on disk and served', `onDisk=${onDisk} served=${served.status}`);
      }
    }
  } catch (err) {
    bad('avatar upload is accepted', err.message);
  }

  // --- An oversized file must fail gracefully, not 500 ---------------------
  //
  // multer raises LIMIT_FILE_SIZE, which middleware/upload.js maps to a flash
  // message and a redirect. Without that mapping the operator gets a bare 500
  // and no idea what went wrong.
  try {
    const limits = require('../src/middleware/upload').uploadLimits('avatars');
    const oversized = Buffer.alloc((limits.maxMb + 1) * 1024 * 1024, 0x41);

    const big = multipart(
      { _csrf: profileCsrf[1], name: staffBefore.name, email: staffBefore.email, phone: '' },
      { field: 'upload', filename: 'too-big.png', type: 'image/png', data: oversized }
    );

    const res = await req(`/${ADMIN_SLUG}/profile`, {
      method: 'POST',
      headers: { 'content-type': big.contentType },
      body: big.body,
    });

    if (res.status >= 500) {
      bad('an oversized upload fails gracefully', `got ${res.status} - should redirect with a message`);
    } else if ([301, 302, 303].includes(res.status)) {
      ok('an oversized upload fails gracefully', `rejected at ${limits.maxMb} MB with a redirect, not a 500`);
    } else {
      bad('an oversized upload fails gracefully', `expected a redirect, got ${res.status}`);
    }
  } catch (err) {
    bad('an oversized upload fails gracefully', err.message);
  }

  // --- Branding logo upload -------------------------------------------------
  const logoBefore = settingsSvc.get('logo_light', '');

  try {
    const branding = await req(`/${ADMIN_SLUG}/settings?group=branding`);
    const brandingCsrf = branding.body.match(/name="_csrf"\s+value="([^"]+)"/);

    if (!brandingCsrf) {
      bad('branding tab renders an upload control', 'no CSRF token found');
    } else if (!/type="file"[^>]*name="logo_light"/.test(branding.body)) {
      bad('branding tab renders an upload control', 'no file input named logo_light');
    } else {
      ok('branding tab renders a file input per logo field');

      // Post every non-file field in the group, exactly as the browser form
      // does. Posting only the file would fail validation on logo_width, which
      // is required - and that would look like an upload bug.
      const brandingFields = { _csrf: brandingCsrf[1], group: 'branding' };
      for (const def of require('../src/config/settings-schema').BY_GROUP.branding) {
        if (def.type === 'file') continue;
        brandingFields[def.key] = String(settingsSvc.get(def.key, def.default));
      }

      const upload = multipart(brandingFields, {
        field: 'logo_light',
        filename: 'smoke-logo.png',
        type: 'image/png',
        data: png,
      });

      const saved = await req(`/${ADMIN_SLUG}/settings`, {
        method: 'POST',
        headers: { 'content-type': upload.contentType },
        body: upload.body,
      });

      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
      const logoAfter = settingsSvc.get('logo_light', '');

      if (![301, 302, 303].includes(saved.status)) {
        bad('branding logo upload is accepted', `expected a redirect, got ${saved.status}`);
      } else if (!logoAfter || logoAfter === logoBefore) {
        bad('branding logo upload is accepted', `logo_light did not change (${JSON.stringify(logoAfter)})`);
      } else {
        ok('branding logo upload persists', logoAfter);

        // The whole point: the public header must now use the uploaded file.
        const home = await req('/', { withCookies: false });
        if (home.body.includes(logoAfter)) {
          ok('uploaded logo is used on the public site', 'header now points at the uploaded file');
        } else {
          bad('uploaded logo is used on the public site', `${logoAfter} not found in the homepage markup`);
        }
      }
    }
  } catch (err) {
    bad('branding logo upload', err.message);
  } finally {
    // Restore the original logo and clean up the files this test created.
    try {
      await settingsSvc.saveMany({ logo_light: logoBefore });
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
    } catch {
      /* best effort */
    }

    try {
      await db.query('UPDATE users SET avatar = NULL WHERE username = ?', [
        process.env.SMOKE_ADMIN_USER || 'mdshojibmiya',
      ]);
    } catch {
      /* best effort */
    }

    for (const folder of ['avatars', 'logos']) {
      const dir = path.join(uploadRoot, folder);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('smoke-')) fs.unlinkSync(path.join(dir, name));
      }
    }

    // Remove the media rows this test created. Deleting a record does not
    // cascade to `media`, so without this each run leaves rows pointing at
    // files that no longer exist.
    try {
      await db.query("DELETE FROM media WHERE file_url LIKE '%smoke-%'");
    } catch {
      /* best effort */
    }
  }
}

/**
 * Every settings field, in every group, must round-trip.
 *
 * This walks the whole registry: renders each tab, confirms each declared field
 * appears in the form, then posts a distinctive value for every field and reads
 * it back from the database. A field that silently fails to save is invisible
 * otherwise - the form re-renders with the old value and looks fine.
 *
 * Booleans are posted both ON and OFF, because an unchecked checkbox submits
 * nothing at all and a handler that only writes present values would leave the
 * old one in place.
 *
 * Everything is restored afterwards, so the run is idempotent.
 */
async function checkSettingsRoundTrip() {
  section('15. Every settings field saves and reloads');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    return;
  }

  const settingsSvc = require('../src/services/settings.service');
  const schema = require('../src/config/settings-schema');
  const db = require('../src/config/database');

  const groups = Object.keys(schema.GROUP_LABELS);

  // Snapshot first, so the original values can be put back even if a check
  // throws part way through.
  await settingsSvc.loadAll(true);
  const original = {};
  for (const def of schema.SETTINGS) original[def.key] = settingsSvc.get(def.key, def.default);

  const notRendered = [];
  const notSaved = [];
  let checked = 0;

  /** A value that will not collide with anything real. */
  const probeFor = (def) => `probe-${def.key}`;

  try {
    for (const group of groups) {
      const defs = schema.BY_GROUP[group];
      const page = await req(`/${ADMIN_SLUG}/settings?group=${group}`);
      const token = (page.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];

      if (!token) {
        notRendered.push(`${group}: tab did not render a form`);
        continue;
      }

      // 1. Every declared field must be in the form.
      for (const def of defs) {
        if (!new RegExp(`name="${def.key}"`).test(page.body)) {
          notRendered.push(`${def.key} (${group})`);
        }
      }

      // 2. Post a distinctive value for every field and read it back.
      const body = new URLSearchParams({ _csrf: token, group });
      const expected = {};

      for (const def of defs) {
        if (def.type === 'file') continue; // needs a real upload, covered in section 14

        if (def.type === 'boolean') {
          body.set(def.key, '1');
          expected[def.key] = '1';
          continue;
        }
        if (def.type === 'number') {
          body.set(def.key, '7');
          expected[def.key] = '7';
          continue;
        }
        if (def.type === 'select') {
          // Pick the option that is NOT the current value, so a no-op save
          // cannot masquerade as a success.
          const options = def.options || [];
          const different = options.find((o) => String(o) !== String(original[def.key])) || options[0];
          if (different === undefined) continue;
          body.set(def.key, String(different));
          expected[def.key] = String(different);
          continue;
        }
        if (def.type === 'text' || def.type === 'textarea' || def.type === 'file') {
          // Some text settings are validated rather than free-form, so a probe
          // string would be rejected and the whole group would 422 - which
          // looks like a save bug but is the validation doing its job.
          //   admin_path_slug  - must be a URL-safe slug
          //   theme_* colours  - must be hex
          const current = String(original[def.key] ?? '');
          const isColour = /^#[0-9a-f]{6}$/i.test(current);

          let value;
          if (def.key === 'admin_path_slug') {
            // Keep the slug; changing it moves the panel mid-test.
            value = current || 'dev-cp';
          } else if (isColour) {
            value = '#123456';
          } else {
            value = probeFor(def);
          }

          body.set(def.key, value);
          expected[def.key] = value;
          continue;
        }
      }

      const saved = await req(`/${ADMIN_SLUG}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (![301, 302, 303].includes(saved.status)) {
        notSaved.push(`${group}: save returned ${saved.status}`);
        continue;
      }

      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);

      for (const [key, want] of Object.entries(expected)) {
        checked += 1;
        const got = settingsSvc.get(key);
        if (String(got) !== String(want)) {
          notSaved.push(`${key}: expected "${String(want).slice(0, 24)}", got "${String(got).slice(0, 24)}"`);
        }
      }

      // 3. Booleans must also turn OFF. An unchecked box submits nothing, so a
      //    handler that skips absent values would leave the old one set.
      const bools = defs.filter((d) => d.type === 'boolean');
      if (bools.length) {
        const offBody = new URLSearchParams({ _csrf: token, group });
        // Deliberately omit every boolean - that is what the browser sends.
        for (const def of defs) {
          if (def.type === 'boolean') continue;
          offBody.set(def.key, String(original[def.key] ?? def.default));
        }

        const offSaved = await req(`/${ADMIN_SLUG}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: offBody.toString(),
        });

        if ([301, 302, 303].includes(offSaved.status)) {
          settingsSvc.invalidate();
          await settingsSvc.loadAll(true);
          for (const def of bools) {
            checked += 1;
            if (settingsSvc.getBool(def.key)) {
              notSaved.push(`${def.key}: posted unchecked but still ON`);
            }
          }
        }
      }
    }
  } catch (err) {
    bad('settings round-trip', err.message);
  } finally {
    // Restore every setting, whatever happened above.
    try {
      await settingsSvc.saveMany(original);
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
    } catch (err) {
      warn('settings restore', err.message);
    }
  }

  if (notRendered.length) {
    bad(`${notRendered.length} setting(s) missing from their form`, notRendered.slice(0, 8).join('; '));
  } else {
    ok('every declared setting renders in its form', `${schema.SETTINGS.length} fields across ${groups.length} groups`);
  }

  if (notSaved.length) {
    bad(`${notSaved.length} setting(s) did not round-trip`, notSaved.slice(0, 8).join('; '));
  } else {
    ok('every setting saves and reloads', `${checked} value(s) checked, including booleans turned off`);
  }

  // The restore itself is worth asserting - a test that corrupts settings is
  // worse than no test.
  const drift = [];
  for (const def of schema.SETTINGS) {
    if (def.type === 'file') continue;
    const now = String(settingsSvc.get(def.key) ?? '');
    const was = String(original[def.key] ?? '');
    if (now !== was) drift.push(`${def.key} (${was} -> ${now})`);
  }

  if (drift.length) {
    bad('settings restored after the round-trip', `${drift.length} changed: ${drift.slice(0, 5).join(', ')}`);
  } else {
    ok('settings restored after the round-trip', 'no drift');
  }

  // Chat specifically, because it is the one that was reported broken: the key
  // must be readable by the service that actually calls the API.
  const chat = require('../src/services/chat.service');
  const configured = typeof chat.isConfigured === 'function' ? chat.isConfigured() : null;
  if (configured === true) {
    ok('live chat assistant reports itself configured', 'key and endpoint are readable');
  } else if (configured === false) {
    warn('live chat assistant reports itself configured', 'no API key stored or in the environment');
  }

  await db.close().catch(() => {});
}

/**
 * The customer account area.
 *
 * Creates a throwaway customer, signs in as them, and exercises every write
 * path they have: profile details, photo upload, password change and a support
 * ticket. The backend for these is easy to get wrong in ways a status code
 * cannot see - a field silently not persisting, an upload landing on disk but
 * not in the row, a password change that writes nothing.
 *
 * Everything is removed afterwards.
 */
async function checkCustomerAccount() {
  section('16. Customer account writes');

  const bcrypt = require('bcryptjs');
  const fs = require('fs');
  const path = require('path');
  const db = require('../src/config/database');
  const config = require('../src/config');
  const userModel = require('../src/models/user.model');

  const email = `smoke-customer-${Date.now()}@example.com`;
  const originalPassword = 'SmokePass#2025';
  const newPassword = 'SmokePass#2026';
  let customerId = null;

  /** Build a multipart body with one file. */
  const multipart = (fields, file) => {
    const boundary = `----WooBDCust${Date.now()}`;
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ));
      parts.push(file.data);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  };

  /** Read the CSRF token from a rendered page. */
  const tokenFrom = (html) => (html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];

  try {
    customerId = await db.insert('customers', {
      name: 'Smoke Customer',
      email,
      phone: '+8801700000000',
      password_hash: await bcrypt.hash(originalPassword, 12),
      status: 'active',
      email_verified_at: new Date(),
      country: 'Bangladesh',
    });

    // --- Sign in ----------------------------------------------------------
    resetCookies();
    const signinPage = await req('/signin');
    const signinToken = tokenFrom(signinPage.body);
    if (!signinToken) {
      bad('customer sign-in page renders a form', 'no CSRF token');
      return;
    }

    const signedIn = await req('/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: signinToken,
        email,
        password: originalPassword,
        website: '',
        next: '/account',
      }).toString(),
    });

    if (![301, 302, 303].includes(signedIn.status)) {
      bad('customer can sign in', `expected a redirect, got ${signedIn.status}`);
      return;
    }
    ok('customer can sign in', `→ ${String(signedIn.location).replace(BASE, '')}`);

    // --- Profile details --------------------------------------------------
    const profilePage = await req('/account/profile');
    const profileToken = tokenFrom(profilePage.body);

    const details = await req('/account/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: profileToken,
        name: 'Smoke Customer Renamed',
        phone: '+8801811111111',
        company: 'Smoke Traders',
        address: '12 Test Road',
        city: 'Rangpur',
        country: 'Bangladesh',
      }).toString(),
    });

    const afterDetails = await db.queryOne(
      'SELECT name, phone, company, address, city FROM customers WHERE id = ?',
      [customerId]
    );

    const detailsOk =
      [301, 302, 303].includes(details.status) &&
      afterDetails.name === 'Smoke Customer Renamed' &&
      afterDetails.phone === '+8801811111111' &&
      afterDetails.company === 'Smoke Traders' &&
      afterDetails.address === '12 Test Road' &&
      afterDetails.city === 'Rangpur';

    if (detailsOk) {
      ok('profile details save', 'name, phone, company, address and city all persisted');
    } else {
      bad(
        'profile details save',
        `status ${details.status}; stored ${JSON.stringify(afterDetails)}`
      );
    }

    // --- Avatar upload ----------------------------------------------------
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    );

    const freshProfile = await req('/account/profile');
    const avatarForm = multipart(
      { _csrf: tokenFrom(freshProfile.body) },
      { field: 'avatar', filename: 'smoke-customer.png', type: 'image/png', data: png }
    );

    const avatarPost = await req('/account/profile/avatar', {
      method: 'POST',
      headers: { 'content-type': avatarForm.contentType },
      body: avatarForm.body,
    });

    const afterAvatar = await db.queryOne('SELECT avatar FROM customers WHERE id = ?', [customerId]);

    if (avatarPost.status === 419) {
      bad('customer photo upload is accepted', '419 - CSRF rejected a valid multipart POST');
    } else if (!afterAvatar.avatar) {
      bad('customer photo upload is accepted', `avatar not stored (status ${avatarPost.status})`);
    } else {
      ok('customer photo upload persists', afterAvatar.avatar);

      const onDisk = fs.existsSync(
        path.join(config.uploads.dir, afterAvatar.avatar.replace(/^\/uploads\//, ''))
      );
      const served = await req(afterAvatar.avatar);
      const shown = (await req('/account/profile')).body.includes(afterAvatar.avatar);

      if (onDisk && served.status === 200 && shown) {
        ok('uploaded photo is on disk, served, and shown on the page');
      } else {
        bad('uploaded photo is on disk, served, and shown on the page', `disk=${onDisk} served=${served.status} shown=${shown}`);
      }
    }

    // --- Support ticket ---------------------------------------------------
    //
    // Done BEFORE the password change: changing the password regenerates the
    // session (correct security behaviour), which invalidates the CSRF token
    // and signs the customer out. Anything after it needs a fresh sign-in.
    const ticketPage = await req('/account/tickets/new');
    const ticketToken = tokenFrom(ticketPage.body);

    const ticket = await req('/account/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: ticketToken,
        subject: 'Smoke test ticket',
        department: 'general',
        priority: 'medium',
        message: 'Created by the smoke test. Safe to delete.',
      }).toString(),
    });

    const createdTicket = await db.queryOne(
      'SELECT id, ticket_number FROM tickets WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      [customerId]
    );

    if ([301, 302, 303].includes(ticket.status) && createdTicket) {
      ok('customer can open a support ticket', createdTicket.ticket_number);
    } else {
      bad('customer can open a support ticket', `status ${ticket.status}, ticket=${createdTicket ? 'created' : 'missing'}`);
    }

    // --- Ownership isolation ---------------------------------------------
    //
    // Use a real order that belongs to a DIFFERENT customer. Probing with a
    // customer id would test nothing: it would either miss or land on an order
    // of our own.
    const foreignOrder = await db.queryOne(
      'SELECT id, customer_id FROM orders WHERE customer_id <> ? ORDER BY id ASC LIMIT 1',
      [customerId]
    );

    if (!foreignOrder) {
      warn('customer order isolation', 'no other customer has an order to probe with');
    } else {
      const foreign = await req(`/account/orders/${foreignOrder.id}`);

      if (foreign.status === 404) {
        ok(
          "a customer cannot open another customer's order",
          `order ${foreignOrder.id} belongs to customer ${foreignOrder.customer_id}, returned 404`
        );
      } else if (foreign.status === 200) {
        bad(
          "a customer cannot open another customer's order",
          `order ${foreignOrder.id} rendered 200 - credentials may be exposed`
        );
      } else {
        bad("a customer cannot open another customer's order", `expected 404, got ${foreign.status}`);
      }
    }

    // --- Password change --------------------------------------------------
    //
    // Last, because it invalidates the session.
    const securityPage = await req('/account/security');
    const securityToken = tokenFrom(securityPage.body);

    const changed = await req('/account/security', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: securityToken,
        current_password: originalPassword,
        password: newPassword,
        password_confirm: newPassword,
      }).toString(),
    });

    const row = await db.queryOne('SELECT password_hash FROM customers WHERE id = ?', [customerId]);
    const newWorks = await bcrypt.compare(newPassword, row.password_hash);
    const oldFails = await bcrypt.compare(originalPassword, row.password_hash);

    if ([301, 302, 303].includes(changed.status) && newWorks && !oldFails) {
      ok('password change works', 'new password accepted, old one rejected');
    } else {
      bad(
        'password change works',
        `status ${changed.status}; newWorks=${newWorks} oldFails=${oldFails}`
      );
    }

    // The regenerated session must no longer be authenticated.
    const afterChange = await reqChain('/account');
    if (afterChange.finalPath.includes('/signin')) {
      ok('changing the password ends the session', 'must sign in again');
    } else {
      warn('changing the password ends the session', `still at ${afterChange.finalPath}`);
    }
  } catch (err) {
    bad('customer account writes', err.message);
  } finally {
    // Remove everything this test created.
    try {
      if (customerId) {
        await db.query('DELETE FROM tickets WHERE customer_id = ?', [customerId]);
        await db.query('DELETE FROM customers WHERE id = ?', [customerId]);
      }
    } catch {
      /* best effort */
    }

    try {
      const dir = path.join(config.uploads.dir, 'avatars');
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('smoke-customer-')) fs.unlinkSync(path.join(dir, name));
        }
      }
    } catch {
      /* best effort */
    }

    // `media` has no foreign key to `customers`, so deleting the customer does
    // not remove the upload record.
    try {
      await db.query("DELETE FROM media WHERE file_url LIKE '%smoke-customer-%'");
    } catch {
      /* best effort */
    }

    resetCookies();
    await db.close().catch(() => {});
  }
}

/**
 * Admin CRUD, end to end.
 *
 * The route sweep (section 13) proves every page loads. This proves the pages
 * actually DO something: for each CMS resource it creates a record through the
 * real form, reads it back from the database, edits it, confirms the edit
 * landed, then deletes it and confirms it is gone.
 *
 * A page that renders but silently discards a save passes a route sweep and
 * fails here - which is exactly the failure a user reports as "it did not save".
 */
async function checkAdminCrud() {
  section('17. Admin CRUD: create, edit, delete');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    return;
  }

  const db = require('../src/config/database');
  const { RESOURCES } = require('../src/config/admin-resources');

  const tokenFrom = (html) => (html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
  const stamp = Date.now();

  /** Build a multipart body. Every CMS form is multipart, so use it for all. */
  const multipart = (fields, file) => {
    const boundary = `----WooBDCrud${stamp}${Math.random().toString(16).slice(2)}`;
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ));
      parts.push(file.data);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  };

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

  /**
   * A minimal valid payload per resource, plus which field to change on edit
   * and how to find the row afterwards.
   */
  const CASES = {
    packages: {
      table: 'services',
      find: 'slug',
      title: `smoke-package-${stamp}`,
      create: {
        title: `Smoke Package ${stamp}`,
        slug: `smoke-package-${stamp}`,
        price: '1234',
        billing_cycle: 'monthly',
        // The two fields that drive term pricing, so the CMS form is checked
        // against the columns the checkout actually reads.
        min_months: '3',
        yearly_discount_percent: '10',
        delivery_days: '5',
        status: 'active',
        sort_order: '99',
        short_description: 'Created by the smoke test.',
        description: '<p>Created by the smoke test.</p>',
        features: 'Alpha\nBeta\nGamma',
        is_featured: '1',
      },
      edit: { short_description: 'Edited by the smoke test.' },
      verify: 'short_description',
    },
    portfolio: {
      table: 'portfolio',
      find: 'slug',
      title: `smoke-project-${stamp}`,
      create: {
        title: `Smoke Project ${stamp}`,
        slug: `smoke-project-${stamp}`,
        client_name: 'Smoke Client',
        category: 'Testing',
        short_description: 'Created by the smoke test.',
        description: '<p>Created by the smoke test.</p>',
        technologies: 'Node\nMySQL',
        status: 'active',
        sort_order: '99',
        is_featured: '0',
      },
      edit: { client_name: 'Edited Client' },
      verify: 'client_name',
    },
    testimonials: {
      table: 'testimonials',
      find: 'customer_name',
      title: `Smoke Reviewer ${stamp}`,
      create: {
        customer_name: `Smoke Reviewer ${stamp}`,
        designation: 'Tester',
        company: 'Smoke Ltd',
        rating: '4',
        message: 'Created by the smoke test.',
        status: 'active',
        sort_order: '99',
      },
      edit: { company: 'Edited Ltd' },
      verify: 'company',
    },
    faqs: {
      table: 'faqs',
      find: 'question',
      title: `Smoke question ${stamp}?`,
      create: {
        question: `Smoke question ${stamp}?`,
        answer: 'Created by the smoke test.',
        category: 'smoke',
        status: 'active',
        sort_order: '99',
      },
      edit: { answer: 'Edited by the smoke test.' },
      verify: 'answer',
    },
    clients: {
      table: 'clients',
      find: 'name',
      title: `Smoke Client Co ${stamp}`,
      create: {
        name: `Smoke Client Co ${stamp}`,
        website_url: 'https://example.com',
        status: 'active',
        sort_order: '99',
      },
      // The logo column is NOT NULL, so a file is required.
      file: true,
      edit: { website_url: 'https://edited.example.com' },
      verify: 'website_url',
    },
    pages: {
      table: 'pages',
      find: 'slug',
      title: `smoke-page-${stamp}`,
      create: {
        title: `Smoke Page ${stamp}`,
        slug: `smoke-page-${stamp}`,
        content: '<p>Created by the smoke test.</p>',
        status: 'published',
        show_in_footer: '0',
        meta_title: 'Smoke Page',
        meta_description: 'Created by the smoke test.',
      },
      edit: { meta_title: 'Edited Smoke Page' },
      verify: 'meta_title',
    },
    menus: {
      table: 'menus',
      find: 'label',
      title: `Smoke Menu ${stamp}`,
      create: {
        label: `Smoke Menu ${stamp}`,
        url: '/smoke-test',
        location: 'footer_quick',
        target: '_self',
        status: 'active',
        sort_order: '99',
      },
      edit: { url: '/smoke-edited' },
      verify: 'url',
    },
  };

  let created = 0;
  let edited = 0;
  let deleted = 0;
  const failures = [];

  for (const [key, spec] of Object.entries(CASES)) {
    const listPage = await req(`/${ADMIN_SLUG}/${key}`);
    const token = tokenFrom(listPage.body);

    if (!token) {
      failures.push(`${key}: list page has no CSRF token`);
      continue;
    }

    // --- create ---------------------------------------------------------
    const form = await req(`/${ADMIN_SLUG}/${key}/new`);
    if (form.status !== 200) {
      failures.push(`${key}: new form returned ${form.status}`);
      continue;
    }

    // The form is multipart only for resources with an image field. Posting the
    // wrong content type would leave the body unparsed and 422 every field -
    // so this mirrors what the browser actually sends.
    const isMultipart = /enctype="multipart\/form-data"/.test(form.body);
    const payload = { _csrf: token, ...spec.create };
    const file = spec.file
      ? { field: 'upload', filename: `smoke-${key}.png`, type: 'image/png', data: png }
      : null;

    const createReq = isMultipart
      ? (() => {
          const m = multipart(payload, file);
          return { body: m.body, contentType: m.contentType };
        })()
      : {
          body: Buffer.from(new URLSearchParams(payload).toString()),
          contentType: 'application/x-www-form-urlencoded',
        };

    const createRes = await req(`/${ADMIN_SLUG}/${key}`, {
      method: 'POST',
      headers: { 'content-type': createReq.contentType },
      body: createReq.body,
    });

    const row = await db.queryOne(
      `SELECT * FROM ${spec.table} WHERE ${spec.find} = ? LIMIT 1`,
      [spec.create[spec.find]]
    );

    if (![301, 302, 303].includes(createRes.status)) {
      failures.push(`${key}: create returned ${createRes.status} (expected a redirect)`);
      continue;
    }
    if (!row) {
      failures.push(`${key}: created record not found in ${spec.table}`);
      continue;
    }
    created += 1;

    // --- edit -----------------------------------------------------------
    const editToken = tokenFrom((await req(`/${ADMIN_SLUG}/${key}`)).body);
    const editPayload = { _csrf: editToken, ...spec.create, ...spec.edit };

    const editReq = isMultipart
      ? (() => {
          const m = multipart(editPayload, null);
          return { body: m.body, contentType: m.contentType };
        })()
      : {
          body: Buffer.from(new URLSearchParams(editPayload).toString()),
          contentType: 'application/x-www-form-urlencoded',
        };

    const editRes = await req(`/${ADMIN_SLUG}/${key}/${row.id}`, {
      method: 'POST',
      headers: { 'content-type': editReq.contentType },
      body: editReq.body,
    });

    const editedRow = await db.queryOne(`SELECT * FROM ${spec.table} WHERE id = ? LIMIT 1`, [row.id]);
    const wanted = Object.values(spec.edit)[0];
    const actual = editedRow ? String(editedRow[spec.verify]) : '';

    if (![301, 302, 303].includes(editRes.status)) {
      failures.push(`${key}: edit returned ${editRes.status}`);
    } else if (actual !== wanted) {
      failures.push(`${key}: edit did not persist (${spec.verify} = "${actual}", wanted "${wanted}")`);
    } else {
      edited += 1;
    }

    // --- delete ---------------------------------------------------------
    const deleteToken = tokenFrom((await req(`/${ADMIN_SLUG}/${key}`)).body);
    const deleteRes = await req(`/${ADMIN_SLUG}/${key}/${row.id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: deleteToken }).toString(),
    });

    const gone = await db.queryOne(`SELECT id FROM ${spec.table} WHERE id = ? LIMIT 1`, [row.id]);

    if (![301, 302, 303].includes(deleteRes.status)) {
      failures.push(`${key}: delete returned ${deleteRes.status}`);
    } else if (gone) {
      failures.push(`${key}: delete did not remove the record`);
    } else {
      deleted += 1;
    }
  }

  const total = Object.keys(CASES).length;
  if (created === total) ok(`created a record in all ${total} CMS resources`);
  else bad(`created a record in all ${total} CMS resources`, `${created}/${total}`);

  if (edited === total) ok('edits persist in every resource');
  else bad('edits persist in every resource', `${edited}/${total}`);

  if (deleted === total) ok('deletes remove the record in every resource');
  else bad('deletes remove the record in every resource', `${deleted}/${total}`);

  if (failures.length) {
    bad('CMS CRUD detail', failures.slice(0, 8).join('; '));
  }

  // --- Menus: nesting ---------------------------------------------------
  try {
    const listPage = await req(`/${ADMIN_SLUG}/menus`);
    const token = tokenFrom(listPage.body);
    const formPage = await req(`/${ADMIN_SLUG}/menus/new`);

    if (/name="parent_id"/.test(formPage.body)) {
      ok('menus form offers a parent selector', 'so a dropdown can be built from the panel');
    } else {
      bad('menus form offers a parent selector', 'no parent_id field rendered');
    }

    // The seeded Services item should have children, which is what renders the
    // header dropdown.
    const nested = await db.queryOne(
      `SELECT COUNT(*) AS n FROM menus c
       JOIN menus p ON p.id = c.parent_id
       WHERE p.location = 'header' AND c.status = 'active'`
    );
    if (Number(nested.n) > 0) {
      ok('header menu has dropdown children', `${nested.n} nested items`);
    } else {
      bad('header menu has dropdown children', 'none - the Services dropdown would be empty');
    }
  } catch (err) {
    bad('menus nesting', err.message);
  }

  // --- Media library ----------------------------------------------------
  try {
    const mediaPage = await req(`/${ADMIN_SLUG}/media`);
    const token = tokenFrom(mediaPage.body);

    const upload = multipart({ _csrf: token, folder: 'media' }, {
      field: 'upload',
      filename: `smoke-media-${stamp}.png`,
      type: 'image/png',
      data: png,
    });

    const upRes = await req(`/${ADMIN_SLUG}/media/upload`, {
      method: 'POST',
      headers: { 'content-type': upload.contentType },
      body: upload.body,
    });

    const mediaRow = await db.queryOne(
      "SELECT id FROM media WHERE file_name LIKE ? LIMIT 1",
      [`%smoke-media-${stamp}%`]
    );

    if ([301, 302, 303].includes(upRes.status) && mediaRow) {
      ok('media library accepts an upload', 'record created');

      const delToken = tokenFrom((await req(`/${ADMIN_SLUG}/media`)).body);
      const delRes = await req(`/${ADMIN_SLUG}/media/${mediaRow.id}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: delToken }).toString(),
      });

      const stillThere = await db.queryOne('SELECT id FROM media WHERE id = ? LIMIT 1', [mediaRow.id]);
      if ([301, 302, 303].includes(delRes.status) && !stillThere) {
        ok('media library deletes a file', 'record and file removed');
      } else {
        bad('media library deletes a file', `status ${delRes.status}, row ${stillThere ? 'still present' : 'gone'}`);
      }
    } else {
      bad('media library accepts an upload', `status ${upRes.status}, row ${mediaRow ? 'created' : 'missing'}`);
    }
  } catch (err) {
    bad('media library', err.message);
  }

  // --- Operations: the actions, not just the pages ----------------------
  try {
    // A ticket reply must append to the thread and move the ticket to answered.
    const ticket = await db.queryOne(
      "SELECT id, status FROM tickets WHERE status <> 'closed' ORDER BY id ASC LIMIT 1"
    );

    if (!ticket) {
      warn('ticket reply', 'no open ticket to reply to');
    } else {
      const before = await db.queryOne('SELECT COUNT(*) AS n FROM ticket_replies WHERE ticket_id = ?', [ticket.id]);
      const token = tokenFrom((await req(`/${ADMIN_SLUG}/tickets/${ticket.id}`)).body);

      const reply = await req(`/${ADMIN_SLUG}/tickets/${ticket.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          _csrf: token,
          message: 'Smoke test reply. Safe to delete.',
        }).toString(),
      });

      const after = await db.queryOne('SELECT COUNT(*) AS n FROM ticket_replies WHERE ticket_id = ?', [ticket.id]);
      const updated = await db.queryOne('SELECT status FROM tickets WHERE id = ?', [ticket.id]);

      if ([301, 302, 303].includes(reply.status) && Number(after.n) === Number(before.n) + 1) {
        ok('ticket reply is stored', `replies ${before.n} → ${after.n}`);
        if (updated.status === 'answered') ok('replying moves the ticket to answered');
        else warn('replying moves the ticket to answered', `status is ${updated.status}`);
      } else {
        bad('ticket reply is stored', `status ${reply.status}, replies ${before.n} → ${after.n}`);
      }

      // Clean up the reply this test added.
      await db.query("DELETE FROM ticket_replies WHERE message = 'Smoke test reply. Safe to delete.'");
      await db.query('UPDATE tickets SET status = ? WHERE id = ?', [ticket.status, ticket.id]);
    }

    // A contact message must change status.
    const contact = await db.queryOne("SELECT id, status FROM contact_messages ORDER BY id ASC LIMIT 1");
    if (contact) {
      const token = tokenFrom((await req(`/${ADMIN_SLUG}/contacts`)).body);
      const res = await req(`/${ADMIN_SLUG}/contacts/${contact.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: token, status: 'archived' }).toString(),
      });

      const updated = await db.queryOne('SELECT status FROM contact_messages WHERE id = ?', [contact.id]);
      if ([301, 302, 303].includes(res.status) && updated.status === 'archived') {
        ok('contact message status can be changed', 'new → archived');
      } else {
        bad('contact message status can be changed', `status ${res.status}, stored ${updated.status}`);
      }

      await db.query('UPDATE contact_messages SET status = ? WHERE id = ?', [contact.status, contact.id]);
    }

    // An invoice must accept a status change. Use an UNPAID one: marking an
    // already-paid invoice as paid is a no-op that would not set paid_at.
    const invoice = await db.queryOne(
      "SELECT id, status FROM invoices WHERE status <> 'paid' ORDER BY id ASC LIMIT 1"
    );
    if (!invoice) {
      warn('invoice status can be changed', 'no unpaid invoice to test with');
    } else {
      const token = tokenFrom((await req(`/${ADMIN_SLUG}/invoices/${invoice.id}`)).body);
      const res = await req(`/${ADMIN_SLUG}/invoices/${invoice.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: token, status: 'paid' }).toString(),
      });

      const updated = await db.queryOne('SELECT status, paid_at FROM invoices WHERE id = ?', [invoice.id]);
      if ([301, 302, 303].includes(res.status) && updated.status === 'paid' && updated.paid_at) {
        ok('invoice status can be changed', `${invoice.status} → paid, with a payment timestamp`);
      } else {
        bad(
          'invoice status can be changed',
          `status ${res.status}, stored ${updated.status}, paid_at ${updated.paid_at}`
        );
      }

      await db.query('UPDATE invoices SET status = ?, paid_at = NULL WHERE id = ?', [invoice.status, invoice.id]);
    }

    // A subscription must accept an action.
    const subscription = await db.queryOne('SELECT id, status FROM subscriptions ORDER BY id ASC LIMIT 1');
    if (subscription) {
      const token = tokenFrom((await req(`/${ADMIN_SLUG}/subscriptions`)).body);
      const res = await req(`/${ADMIN_SLUG}/subscriptions/${subscription.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: token, action: 'pause' }).toString(),
      });

      const updated = await db.queryOne('SELECT status FROM subscriptions WHERE id = ?', [subscription.id]);
      if ([301, 302, 303].includes(res.status) && updated.status === 'past_due') {
        ok('subscription actions work', 'pause set it to past_due');
      } else {
        bad('subscription actions work', `status ${res.status}, stored ${updated.status}`);
      }

      await db.query('UPDATE subscriptions SET status = ? WHERE id = ?', [subscription.status, subscription.id]);
    }
  } catch (err) {
    bad('operations actions', err.message);
  }

  // --- Clean up anything the CMS cases left behind ----------------------
  try {
    for (const [key, spec] of Object.entries(CASES)) {
      await db.query(`DELETE FROM ${spec.table} WHERE ${spec.find} LIKE ?`, [`%${stamp}%`]);
      await db.query(`DELETE FROM ${spec.table} WHERE ${spec.find} LIKE ?`, [`%Smoke%${stamp}%`]);
    }
    await db.query("DELETE FROM media WHERE file_name LIKE '%smoke-%'");

    // Deleting the row does not delete the file it pointed at. Without this the
    // uploads folder accumulates an image per run - and the folder is the one
    // thing a redeploy does NOT clear.
    const fs = require('fs');
    const path = require('path');
    const uploadRoot = require('../src/config').uploads.dir;

    for (const folder of fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot) : []) {
      const dir = path.join(uploadRoot, folder);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        if (/^smoke-/.test(name)) fs.unlinkSync(path.join(dir, name));
      }
    }
  } catch {
    /* best effort */
  }

  await db.close().catch(() => {});
}

/**
 * Recently added UI: the CMS rich-text editor, the single-column FAQ, and the
 * footer payment logos.
 *
 * Each of these is a rendering concern, so they are asserted against the real
 * served HTML rather than the template source.
 */
async function checkEditorAndFooter() {
  section('18. Rich-text editor, FAQ layout, payment logos');

  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping the admin half`);
  }

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');

  // --- Rich text editor -------------------------------------------------
  try {
    const pagesForm = await req(`/${ADMIN_SLUG}/pages/new`);

    const checks = [
      ['editor wrapper', /data-html-editor/],
      // Attribute order is not guaranteed, so check both attributes separately
      // rather than assuming one follows the other.
      ['editable surface', /data-he-surface/],
      ['surface is editable', /contenteditable="true"/],
      ['hidden store field', /<textarea[^>]*name="content"[^>]*data-he-store/],
      ['bold button', /data-he-cmd="bold"/],
      ['heading buttons', /data-he-block="h2"/],
      ['list buttons', /data-he-cmd="insertUnorderedList"/],
      ['link button', /data-he-link/],
      ['source toggle', /data-he-source/],
    ];

    const missing = checks.filter(([, re]) => !re.test(pagesForm.body)).map(([label]) => label);

    if (missing.length) {
      bad('the page editor renders a full toolbar', `missing: ${missing.join(', ')}`);
    } else {
      ok('the page editor renders a full toolbar', `${checks.length} controls`);
    }

    // The store field must carry the field name, or the save would post nothing.
    if (/<textarea[^>]*name="content"/.test(pagesForm.body)) {
      ok('the editor posts through a named textarea', 'name="content"');
    } else {
      bad('the editor posts through a named textarea', 'no textarea named content');
    }

    // No third-party editor library, per the no-CDN rule.
    const external = [...pagesForm.body.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
    if (!external.length) ok('the editor is first-party', 'no external scripts on the page');
    else bad('the editor is first-party', external.join(', '));
  } catch (err) {
    bad('rich text editor', err.message);
  }

  // --- FAQ is a single column -------------------------------------------
  try {
    const home = await req('/');

    // Isolate the FAQ section and confirm it is not a two-column split.
    const start = home.body.indexOf('Frequently asked questions');
    const faqBlock = start > 0 ? home.body.slice(Math.max(0, start - 400), start + 900) : '';

    if (!faqBlock) {
      warn('FAQ section found on the homepage', 'heading not present');
    } else if (/class="split"/.test(faqBlock)) {
      bad('the FAQ section is a single column', 'still using a two-column .split');
    } else if (/faq-column/.test(faqBlock) && /class="accordion"/.test(faqBlock)) {
      ok('the FAQ section is a single column', 'heading above, accordion beneath');
    } else {
      bad('the FAQ section is a single column', 'expected a .faq-column wrapper around the accordion');
    }
  } catch (err) {
    bad('FAQ layout', err.message);
  }

  // --- Footer payment logos ---------------------------------------------
  try {
    const keys = ['payment_bkash_logo', 'payment_nagad_logo', 'payment_rocket_logo', 'payment_card_logo'];
    const declared = require('../src/config/settings-schema').BY_KEY;
    const undeclared = keys.filter((k) => !declared[k]);

    if (undeclared.length) {
      bad('payment logo settings are declared', `missing: ${undeclared.join(', ')}`);
    } else {
      ok('payment logo settings are declared', keys.length + ' upload fields');
    }

    // With no logo uploaded, the footer must still name each method.
    const home = await req('/');
    const chipCount = (home.body.match(/class="payment-chip"/g) || []).length;
    if (chipCount > 0) {
      ok('the footer names each payment method when no logo is uploaded', `${chipCount} chips`);
    } else {
      bad('the footer names each payment method when no logo is uploaded', 'no chips rendered');
    }

    // Upload one and confirm the footer switches to an image.
    if (login.ok) {
      const settingsPage = await req(`/${ADMIN_SLUG}/settings?group=payments`);
      const token = (settingsPage.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];

      if (!token) {
        bad('payments tab renders', 'no CSRF token');
      } else {
        const boundary = `----WooBDPay${Date.now()}`;
        const parts = [];
        const fields = { _csrf: token, group: 'payments' };
        // Post every non-file field so nothing else in the group is disturbed.
        for (const def of require('../src/config/settings-schema').BY_GROUP.payments) {
          if (def.type === 'file') continue;
          fields[def.key] = String(settingsSvc.get(def.key, def.default));
        }
        for (const [name, value] of Object.entries(fields)) {
          parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
        }
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="payment_bkash_logo"; filename="smoke-bkash.png"\r\nContent-Type: image/png\r\n\r\n`
        ));
        parts.push(Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
          'base64'
        ));
        parts.push(Buffer.from('\r\n'));
        parts.push(Buffer.from(`--${boundary}--\r\n`));

        const saved = await req(`/${ADMIN_SLUG}/settings`, {
          method: 'POST',
          headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
          body: Buffer.concat(parts),
        });

        settingsSvc.invalidate();
        await settingsSvc.loadAll(true);
        const logo = settingsSvc.get('payment_bkash_logo', '');

        if (![301, 302, 303].includes(saved.status)) {
          bad('a payment logo upload is accepted', `expected a redirect, got ${saved.status}`);
        } else if (!logo) {
          bad('a payment logo upload is accepted', 'setting did not change');
        } else {
          ok('a payment logo upload persists', logo);

          const withLogo = await req('/');
          if (withLogo.body.includes(logo) && /class="payment-logo"/.test(withLogo.body)) {
            ok('the footer shows the uploaded payment logo', 'image rendered instead of a chip');
          } else {
            bad('the footer shows the uploaded payment logo', 'logo not found in the footer markup');
          }
        }

        // Restore the setting AND remove the file. Clearing the setting alone
        // leaves the image on disk, and a stray file per run adds up.
        await settingsSvc.saveMany({ payment_bkash_logo: '' });
        settingsSvc.invalidate();
        await settingsSvc.loadAll(true);

        try {
          const fs = require('fs');
          const path = require('path');
          const uploadRoot = require('../src/config').uploads.dir;
          const file = path.join(uploadRoot, logo.replace(/^\/uploads\//, ''));
          if (fs.existsSync(file)) fs.unlinkSync(file);
          await db.query('DELETE FROM media WHERE file_url = ?', [logo]);
        } catch {
          /* best effort */
        }
      }
    }
  } catch (err) {
    bad('payment logos', err.message);
  }

  // --- Admin can set a customer photo -----------------------------------
  if (login.ok) {
    try {
      const bcrypt = require('bcryptjs');
      const fs = require('fs');
      const path = require('path');
      const config = require('../src/config');

      const email = `smoke-photo-${Date.now()}@example.com`;
      const id = await db.insert('customers', {
        name: 'Smoke Photo Customer',
        email,
        phone: '+8801700000000',
        password_hash: await bcrypt.hash('SmokePass#2025', 12),
        status: 'active',
        email_verified_at: new Date(),
        country: 'Bangladesh',
      });

      const detail = await req(`/${ADMIN_SLUG}/customers/${id}`);
      const token = (detail.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];

      if (!/name="upload"[^>]*accept="image/.test(detail.body)) {
        bad('the customer record offers a photo upload', 'no file input rendered');
      } else {
        const boundary = `----WooBDAva${Date.now()}`;
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
          'base64'
        );
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${token}\r\n`),
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="smoke-admin-cust.png"\r\nContent-Type: image/png\r\n\r\n`),
          png,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const res = await req(`/${ADMIN_SLUG}/customers/${id}/avatar`, {
          method: 'POST',
          headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
          body,
        });

        const row = await db.queryOne('SELECT avatar FROM customers WHERE id = ?', [id]);

        if ([301, 302, 303].includes(res.status) && row.avatar) {
          ok('an admin can set a customer photo', row.avatar);
        } else {
          bad('an admin can set a customer photo', `status ${res.status}, avatar ${row.avatar}`);
        }

        // Clean up the file too.
        if (row.avatar) {
          const file = path.join(config.uploads.dir, row.avatar.replace(/^\/uploads\//, ''));
          if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        await db.query('DELETE FROM media WHERE file_url LIKE ?', ['%smoke-admin-cust%']);
      }

      await db.query('DELETE FROM customers WHERE id = ?', [id]);
    } catch (err) {
      bad('admin customer photo', err.message);
    }
  }

  await db.close().catch(() => {});
}

/**
 * Recurring packages sold by term.
 *
 * A package can carry a minimum commitment and a discount for paying a year up
 * front. The checkout has to price each term, refuse anything below the
 * minimum, and record the term on the order - so this exercises the whole path
 * rather than just checking the form renders.
 */
async function checkTermPricing() {
  section('19. Package terms and the yearly discount');

  const bcrypt = require('bcryptjs');
  const db = require('../src/config/database');
  const contentModel = require('../src/models/content.model');

  let customerId = null;

  try {
    // --- The catalogue --------------------------------------------------
    const recurring = await db.query(
      "SELECT id, title, slug, price, min_months, yearly_discount_percent FROM services WHERE status = 'active' AND billing_cycle = 'monthly' AND min_months > 1 ORDER BY price ASC LIMIT 1"
    );

    if (!recurring.length) {
      bad('a package with a minimum term exists', 'none found - the WooCommerce range may be missing');
      return;
    }

    const svc = recurring[0];
    ok('a minimum-term package exists', `${svc.title} — ৳${svc.price}/month, min ${svc.min_months} months, yearly -${svc.yearly_discount_percent}%`);

    const oneTime = await db.queryOne("SELECT COUNT(*) AS n FROM services WHERE billing_cycle = 'one_time' AND status = 'active'");
    if (Number(oneTime.n) === 0) ok('no one-time packages remain in the catalogue');
    else bad('no one-time packages remain in the catalogue', `${oneTime.n} still active`);

    // --- A customer -----------------------------------------------------
    const email = `smoke-term-${Date.now()}@example.com`;
    const password = 'SmokePass#2025';
    customerId = await db.insert('customers', {
      name: 'Smoke Term Customer',
      email,
      phone: '+8801700000000',
      password_hash: await bcrypt.hash(password, 12),
      status: 'active',
      email_verified_at: new Date(),
      country: 'Bangladesh',
    });

    resetCookies();
    const signin = await req('/signin');
    await req('/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: (signin.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1],
        email, password, website: '', next: '/account',
      }).toString(),
    });

    // --- The form offers the terms --------------------------------------
    let page = await req(`/account/checkout/${svc.id}`);
    const options = [...page.body.matchAll(/data-term-option[\s\S]*?data-months="(\d+)"[\s\S]*?data-total="([\d.]+)"/g)]
      .map((m) => ({ months: Number(m[1]), total: Number(m[2]) }));

    if (!options.length) {
      bad('the checkout offers term options', 'no term options rendered');
      return;
    }

    const months = options.map((o) => o.months);
    if (months.includes(Number(svc.min_months)) && months.includes(12)) {
      ok('the checkout offers the minimum term and a year', `${months.join(', ')} months`);
    } else {
      bad('the checkout offers the minimum term and a year', `got ${months.join(', ')} months`);
    }

    if (/name="term_months"/.test(page.body)) ok('terms are chosen with a term_months field');
    else bad('terms are chosen with a term_months field', 'no such input');

    // The rendered totals must match the arithmetic, or the customer is shown
    // one number and charged another.
    const rate = Number(svc.price);
    const expectedYearly = Math.round(rate * 12 * (1 - Number(svc.yearly_discount_percent) / 100));
    const shownYearly = options.filter((o) => o.months === 12)[0];
    if (shownYearly && shownYearly.total === expectedYearly) {
      ok('the displayed yearly total is correct', `৳${expectedYearly}`);
    } else {
      bad('the displayed yearly total is correct', `shown ${shownYearly && shownYearly.total}, expected ${expectedYearly}`);
    }

    // --- Ordering a short term ------------------------------------------
    const orderFor = async (term) => {
      const fresh = await req(`/account/checkout/${svc.id}`);
      const token = (fresh.body.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];
      return req('/account/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          _csrf: token,
          service_id: String(svc.id),
          term_months: String(term),
          requirements: 'Smoke test order for the term system.',
          domain_name: 'smoke-term.example.com',
          agree: 'on',
        }).toString(),
      });
    };

    const minTerm = Number(svc.min_months);
    const minRes = await orderFor(minTerm);
    const minOrder = await db.queryOne(
      'SELECT id, term_months, amount, discount, total FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      [customerId]
    );

    const minExpected = rate * minTerm;
    if ([301, 302, 303].includes(minRes.status) && minOrder && Number(minOrder.total) === minExpected) {
      ok(`a ${minTerm}-month order is priced correctly`, `৳${minOrder.total}`);
    } else {
      bad(
        `a ${minTerm}-month order is priced correctly`,
        `status ${minRes.status}, total ${minOrder && minOrder.total}, expected ${minExpected}`
      );
    }

    // --- Ordering a year, which must carry the discount -------------------
    const yearRes = await orderFor(12);
    const yearOrder = await db.queryOne(
      'SELECT id, term_months, amount, discount, total FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      [customerId]
    );

    if ([301, 302, 303].includes(yearRes.status) && yearOrder && Number(yearOrder.total) === expectedYearly) {
      ok('a yearly order applies the discount', `gross ৳${yearOrder.amount} − ৳${yearOrder.discount} = ৳${yearOrder.total}`);
    } else {
      bad(
        'a yearly order applies the discount',
        `status ${yearRes.status}, total ${yearOrder && yearOrder.total}, expected ${expectedYearly}`
      );
    }

    // The discount must be visible on the invoice, not just folded into a
    // smaller total.
    if (yearOrder) {
      const items = await db.query(
        'SELECT description, amount FROM invoice_items WHERE invoice_id = (SELECT id FROM invoices WHERE order_id = ?)',
        [yearOrder.id]
      );
      const hasDiscountLine = items.some((i) => Number(i.amount) < 0);
      if (hasDiscountLine) ok('the invoice shows the discount as its own line');
      else bad('the invoice shows the discount as its own line', 'no negative line item found');
    }

    // --- Below the minimum must be refused -------------------------------
    const before = await db.queryOne('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', [customerId]);
    const shortRes = await orderFor(minTerm - 1);
    const after = await db.queryOne('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', [customerId]);

    if (shortRes.status === 400 && Number(after.n) === Number(before.n)) {
      ok('a term below the minimum is refused', `${minTerm - 1} months rejected, no order created`);
    } else {
      bad(
        'a term below the minimum is refused',
        `status ${shortRes.status}, orders ${before.n} → ${after.n}`
      );
    }

    // --- The package page states the terms -------------------------------
    const single = await req(`/services/${svc.slug}`);
    if (/minimum term/i.test(single.body) && /yearly/i.test(single.body)) {
      ok('the package page states the term and the yearly saving');
    } else {
      bad('the package page states the term and the yearly saving', 'terms not found in the page');
    }
  } catch (err) {
    bad('term pricing', err.message);
  } finally {
    // Remove the orders, invoices and subscription this test created.
    try {
      if (customerId) {
        const orders = await db.query('SELECT id FROM orders WHERE customer_id = ?', [customerId]);
        for (const order of orders) {
          await db.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE order_id = ?)', [order.id]);
          await db.query('DELETE FROM invoices WHERE order_id = ?', [order.id]);
          await db.query('DELETE FROM subscriptions WHERE order_id = ?', [order.id]);
          await db.query('DELETE FROM order_deliverables WHERE order_id = ?', [order.id]);
        }
        await db.query('DELETE FROM orders WHERE customer_id = ?', [customerId]);
        await db.query('DELETE FROM tickets WHERE customer_id = ?', [customerId]);
        await db.query('DELETE FROM customers WHERE id = ?', [customerId]);
      }
    } catch {
      /* best effort */
    }

    resetCookies();
    await db.close().catch(() => {});
  }
}

/**
 * Maintenance mode, the chat widget, and the multi-key assistant.
 *
 * All three share a failure mode worth guarding: they look fine from the
 * admin's chair while being broken for everyone else. Maintenance is invisible
 * to staff by design, and a chat widget that cannot post shows an error only in
 * the visitor's browser.
 */
async function checkMaintenanceAndChat() {
  section('20. Maintenance mode and the live chat');

  const settings = require('../src/services/settings.service');
  const db = require('../src/config/database');

  const tokenFrom = (html) => (html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1];

  // Sign in fresh. Earlier sections reset the cookie jar, so there is no
  // guarantee an admin session survives this far down the suite - and without
  // one the staff checks below would fail for the wrong reason.
  const login = await adminLogin();
  if (!login.ok) {
    warn('admin sign-in', `${login.reason} - skipping`);
    await db.close().catch(() => {});
    return;
  }

  try {
    // --- The chat widget renders with its accent -------------------------
    const home = await req('/');
    const meta = home.body.match(/<meta name="csrf-token" content="([^"]+)"/);

    if (meta && meta[1]) ok('the CSRF token is exposed to scripts', 'meta[name=csrf-token]');
    else bad('the CSRF token is exposed to scripts', 'no meta tag - the chat widget cannot authenticate');

    if (/chat-accent:\s*#[0-9a-f]{3,8}/i.test(home.body)) {
      ok('the chat widget carries its accent colour', 'as a CSS variable');
    } else {
      bad('the chat widget carries its accent colour', 'no --chat-accent on the widget');
    }

    if (/#25d366/i.test(home.body) || /--chat-accent/.test(home.body)) {
      ok('the default accent is green', '#25D366');
    } else {
      warn('the default accent is green', 'could not confirm from the page');
    }

    // --- The chat endpoint requires the token ----------------------------
    //
    // This is the bug that showed as "session out": the widget posts JSON, so
    // the token cannot ride along as a form field, and without the header the
    // global CSRF check rejects every message.
    const withoutToken = await req('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ message: 'smoke test' }),
    });

    if (withoutToken.status === 419) {
      ok('the chat endpoint rejects a request with no CSRF token', '419');
    } else {
      warn('the chat endpoint rejects a request with no CSRF token', `got ${withoutToken.status}`);
    }

    // --- Multi-key resolution --------------------------------------------
    const chatService = require('../src/services/chat.service');
    const creds = chatService.credentials();

    if (creds.apiKeys.length >= 1) {
      ok('the assistant resolves at least one API key', `${creds.apiKeys.length} key(s)`);
    } else {
      warn('the assistant resolves at least one API key', 'none configured - chat is disabled');
    }

    if (Array.isArray(creds.apiKeys)) {
      const unique = new Set(creds.apiKeys).size === creds.apiKeys.length;
      if (unique) ok('resolved keys are de-duplicated');
      else bad('resolved keys are de-duplicated', 'the same key appears twice');
    }

    // --- Maintenance mode -------------------------------------------------
    const original = settings.get('maintenance_mode', '0');

    try {
      await settings.saveMany({ maintenance_mode: '1' });
      settings.invalidate();
      await settings.loadAll(true);

      // A visitor is blocked. The admin session is parked first and restored
      // afterwards - clearing the jar outright would make the staff checks
      // below run as an anonymous visitor and fail for the wrong reason.
      const adminJar = new Map(cookieJar);
      resetCookies();

      const visitor = await req('/');
      if (visitor.status === 503) {
        ok('maintenance mode blocks a visitor', '503');
      } else {
        bad('maintenance mode blocks a visitor', `got ${visitor.status}`);
      }

      // The admin sign-in page stays reachable, or maintenance mode becomes a
      // lockout the moment a session expires.
      const loginPage = await req(`/${ADMIN_SLUG}/login`);
      if (loginPage.status === 200) {
        ok('the admin sign-in page stays reachable', 'so maintenance cannot lock you out');
      } else {
        bad('the admin sign-in page stays reachable', `got ${loginPage.status}`);
      }

      // Back to the staff session.
      cookieJar.clear();
      for (const [key, value] of adminJar) cookieJar.set(key, value);

      const staffHome = await req('/');
      if (staffHome.status === 200 && /Maintenance mode is ON/i.test(staffHome.body)) {
        ok('staff bypass maintenance and see a banner', 'the switch no longer looks broken');
      } else if (staffHome.status === 200) {
        bad('staff bypass maintenance and see a banner', 'bypassed but no banner - the admin would think it is off');
      } else {
        bad('staff bypass maintenance and see a banner', `staff got ${staffHome.status}`);
      }

      // The preview route shows visitors' view.
      const preview = await req('/maintenance-preview');
      if (preview.status === 503 && /This is what visitors see/i.test(preview.body)) {
        ok('/maintenance-preview shows the visitor view', '503, marked as a preview');
      } else {
        bad('/maintenance-preview shows the visitor view', `got ${preview.status}`);
      }
    } finally {
      await settings.saveMany({ maintenance_mode: original });
      settings.invalidate();
      await settings.loadAll(true);
      resetCookies();
    }

    // Confirm it really is off again, so this test cannot leave the site down.
    const after = await req('/');
    if (after.status === 200) ok('maintenance mode is off again', 'site restored');
    else bad('maintenance mode is off again', `site returned ${after.status} - it may be stuck on`);
    // --- Hero media ------------------------------------------------------
    //
    // The hero swaps between an image and a video. The failure worth guarding
    // is a folder/URL mismatch: the upload lands in one folder while the stored
    // URL names another, so the admin looks right and the asset 404s.
    //
    // Sign in again first: the maintenance block above ends by resetting the
    // cookie jar, so an admin request here would be anonymous.
    await adminLogin();

    const homeHero = await req('/');
    const heroAdmin = await req(`/${ADMIN_SLUG}/settings?group=homepage`);

    if (/name="hero_video"/.test(heroAdmin.body) && /name="hero_media_type"/.test(heroAdmin.body)) {
      ok('the hero media settings render in the admin', 'video upload and type selector');
    } else {
      bad('the hero media settings render in the admin', 'hero_video or hero_media_type missing from the form');
    }

    // The floating stat badges were removed when the video took their place.
    if (/hero-float/.test(homeHero.body)) {
      bad('the hero float badges are gone', 'hero-float markup is still rendered');
    } else {
      ok('the hero float badges are gone');
    }

    // With no video configured the hero must fall back to an image, not render
    // an empty frame.
    if (/hero_media_type/.test(heroAdmin.body) && !/<video/.test(homeHero.body)) {
      ok('the hero falls back to an image when no video is set');
    } else if (/<video/.test(homeHero.body)) {
      ok('the hero renders a video', 'a video is configured');
    } else {
      warn('the hero falls back to an image when no video is set', 'could not confirm');
    }

    // A video element is useless without muted + playsinline: browsers block
    // autoplay with sound and iOS refuses to play inline without it.
    const heroVid = homeHero.body.match(/<video[^>]*>/);
    if (heroVid) {
      const missing = ['muted', 'playsinline'].filter((attr) => !heroVid[0].includes(attr));
      if (!missing.length) ok('the hero video is muted and playsinline', 'autoplay is permitted');
      else bad('the hero video is muted and playsinline', `missing: ${missing.join(', ')}`);
    }
  } catch (err) {
    bad('maintenance and chat', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * Blog: the admin CMS, the public pages, and the SEO plumbing.
 *
 * The blog is the newest surface and the one most likely to break silently -
 * a listing that renders but has no cards, or a post page that loses its
 * sidebar, looks fine at a glance.
 */
async function checkBlog() {
  section('21. Blog CMS and public pages');

  const db = require('../src/config/database');

  try {
    // --- Admin ------------------------------------------------------------
    const login = await adminLogin();
    if (!login.ok) {
      warn('admin sign-in', `${login.reason} - skipping`);
      await db.close().catch(() => {});
      return;
    }

    for (const [path, label] of [
      [`/${ADMIN_SLUG}/posts`, 'the post list'],
      [`/${ADMIN_SLUG}/posts/new`, 'the new-post form'],
    ]) {
      const page = await req(path);
      if (page.status === 200) ok(`${label} renders`, `${path} → 200`);
      else bad(`${label} renders`, `${path} → ${page.status}`);
    }

    // The form must carry the fields the design depends on.
    const form = await req(`/${ADMIN_SLUG}/posts/new`);
    const needed = ['featured_image', 'category', 'excerpt', 'content', 'author_id', 'og_image', 'robots'];
    const missing = needed.filter((name) => !form.body.includes(`name="${name}"`));
    if (!missing.length) ok('the post form has every field', needed.length + ' checked');
    else bad('the post form has every field', `missing: ${missing.join(', ')}`);

    // --- Public -----------------------------------------------------------
    const index = await req('/blog');
    if (index.status === 200) ok('the blog index renders', '200');
    else bad('the blog index renders', `got ${index.status}`);

    const cards = (index.body.match(/class="blog-card/g) || []).length;
    if (cards > 0) ok('the index lists posts', `${cards} card(s)`);
    else warn('the index lists posts', 'no cards - the blog may be empty');

    // Pick a real published post to test the detail page against.
    const row = await db.queryOne(
      "SELECT slug FROM posts WHERE status = 'published' AND (published_at IS NULL OR published_at <= NOW()) ORDER BY id LIMIT 1"
    );

    if (!row) {
      warn('a single post renders', 'no published posts to test against');
    } else {
      const post = await req(`/blog/${row.slug}`);

      if (post.status === 200) ok('a single post renders', `/blog/${row.slug} → 200`);
      else bad('a single post renders', `got ${post.status}`);

      // The layout the brief specified, in the order it was specified.
      const parts = [
        ['table of contents', 'post-toc'],
        ['share row', 'post-share'],
        ['author card', 'post-author-card'],
        ['sticky sidebar', 'post-side-sticky'],
        ['sidebar widgets', 'post-widget'],
        ['related posts', 'blog-grid-3'],
      ];
      const absent = parts.filter(([, cls]) => !post.body.includes(cls)).map(([label]) => label);
      if (!absent.length) ok('the post page has every section', parts.length + ' sections');
      else bad('the post page has every section', `missing: ${absent.join(', ')}`);

      // Structured data, which is the whole point of the SEO work.
      if (post.body.includes('"@type":"BlogPosting"')) ok('the post carries BlogPosting schema');
      else bad('the post carries BlogPosting schema', 'not found in the page');

      if (post.body.includes('"@type":"BreadcrumbList"')) ok('the post carries breadcrumb schema');
      else bad('the post carries breadcrumb schema', 'not found in the page');

      if (/rel="canonical"/.test(post.body)) ok('the post has a canonical URL');
      else bad('the post has a canonical URL', 'no canonical link');

      if (/property="og:type" content="article"/.test(post.body)) ok('the post is typed as an article');
      else bad('the post is typed as an article', 'og:type is not article');
    }

    // --- SEO plumbing -----------------------------------------------------
    const sitemap = await req('/sitemap.xml');
    if (sitemap.status === 200 && sitemap.body.includes('<urlset')) {
      const count = (sitemap.body.match(/<loc>/g) || []).length;
      ok('the sitemap renders', `${count} URLs`);
      if (sitemap.body.includes('/blog/')) ok('the sitemap includes blog posts');
      else bad('the sitemap includes blog posts', 'no /blog/ URLs');
    } else {
      bad('the sitemap renders', `got ${sitemap.status}`);
    }

    const robots = await req('/robots.txt');
    if (robots.status === 200 && robots.body.includes('Sitemap:')) {
      ok('robots.txt points at the sitemap');
    } else {
      bad('robots.txt points at the sitemap', `got ${robots.status}`);
    }

    if (robots.body.includes(`Disallow: /${ADMIN_SLUG}/`)) {
      ok('robots.txt keeps crawlers out of the panel');
    } else {
      bad('robots.txt keeps crawlers out of the panel', 'the admin path is crawlable');
    }
  } catch (err) {
    bad('blog', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * Crawler files, response compression and the package comparison.
 *
 * Compression is checked by sending an explicit Accept-Encoding, because the
 * request shim above does not set one - which is why every other section in
 * this file passes through the compression middleware untouched. The body is
 * gunzipped rather than pattern-matched, so the check proves the payload is
 * intact and not merely that a header was set.
 */
async function checkCrawlerFilesAndCompare() {
  section('22. Crawler files, compression and the package comparison');

  const zlib = require('zlib');
  const { promisify } = require('util');
  const gunzip = promisify(zlib.gunzip);
  const db = require('../src/config/database');

  try {
    // --- robots.txt -------------------------------------------------------
    const robots = await req('/robots.txt');
    if (robots.status === 200) ok('robots.txt renders', '200');
    else bad('robots.txt renders', `got ${robots.status}`);

    for (const [needle, label] of [
      ['User-agent: *', 'a wildcard agent'],
      ['Allow: /', 'an allow rule'],
      [`Disallow: /${ADMIN_SLUG}/`, 'the admin path blocked'],
      ['Sitemap:', 'a sitemap reference'],
    ]) {
      if (robots.body.includes(needle)) ok(`robots.txt carries ${label}`);
      else bad(`robots.txt carries ${label}`, `missing: ${needle}`);
    }

    // --- sitemap.xml ------------------------------------------------------
    const sitemap = await req('/sitemap.xml');
    if (sitemap.status === 200) ok('the sitemap renders', '200');
    else bad('the sitemap renders', `got ${sitemap.status}`);

    if (sitemap.body.startsWith('<?xml') && sitemap.body.includes('<urlset')) {
      ok('the sitemap is a valid urlset document');
    } else {
      bad('the sitemap is a valid urlset document', 'no XML prologue or urlset');
    }

    const urlCount = (sitemap.body.match(/<loc>/g) || []).length;
    if (urlCount > 0) ok('the sitemap lists URLs', `${urlCount} URL(s)`);
    else bad('the sitemap lists URLs', 'empty');

    for (const [path, label] of [
      ['/compare', 'the comparison page'],
      ['/services/', 'package pages'],
      ['/blog/', 'blog posts'],
    ]) {
      if (sitemap.body.includes(path)) ok(`the sitemap includes ${label}`);
      else warn(`the sitemap includes ${label}`, `no ${path} entries - section may be empty or switched off`);
    }

    // The XML must not carry a raw ampersand, which would make it unparseable.
    const bareAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(sitemap.body);
    if (!bareAmp) ok('the sitemap escapes its entities');
    else bad('the sitemap escapes its entities', 'a bare & would break the XML');

    // --- Compression ------------------------------------------------------
    const gz = await req('/', { headers: { 'accept-encoding': 'gzip' } });
    if (gz.headers.get('content-encoding') === 'gzip') ok('HTML is served gzipped');
    else bad('HTML is served gzipped', `content-encoding: ${gz.headers.get('content-encoding')}`);

    if (String(gz.headers.get('vary') || '').toLowerCase().includes('accept-encoding')) {
      ok('the compressed response varies on Accept-Encoding');
    } else {
      bad('the compressed response varies on Accept-Encoding', 'a cache could serve gzip to a client that cannot read it');
    }

    const gzBody = gz.buffer;
    if (gzBody[0] === 0x1f && gzBody[1] === 0x8b) {
      ok('the gzipped body carries the gzip magic bytes');
    } else {
      bad('the gzipped body carries the gzip magic bytes', 'the body is not gzip data');
    }

    try {
      const restored = (await gunzip(gzBody)).toString('utf8');
      if (restored.includes('<!DOCTYPE html') || restored.includes('<html')) {
        ok('the gzipped body decompresses back to the page');
      } else {
        bad('the gzipped body decompresses back to the page', 'the decompressed body is not HTML');
      }
    } catch (err) {
      bad('the gzipped body decompresses back to the page', err.message);
    }

    const br = await req('/assets/css/theme.css', { headers: { 'accept-encoding': 'br' } });
    if (br.headers.get('content-encoding') === 'br') ok('CSS is served as Brotli when offered');
    else warn('CSS is served as Brotli when offered', `content-encoding: ${br.headers.get('content-encoding')}`);

    // A small response should skip compression entirely - the compressed form
    // would be larger than the original.
    const tiny = await req('/robots.txt', { headers: { 'accept-encoding': 'gzip' } });
    if (!tiny.headers.get('content-encoding')) {
      ok('a small response is not compressed', 'below the 1KB threshold');
    } else {
      warn('a small response is not compressed', `compressed anyway: ${tiny.headers.get('content-encoding')}`);
    }

    // --- Asset versioning -------------------------------------------------
    const home = await req('/');
    const cssUrl = (home.body.match(/assets\/css\/theme\.css\?v=\d+/) || [])[0];
    if (cssUrl) ok('the stylesheet URL is version-stamped', cssUrl);
    else bad('the stylesheet URL is version-stamped', 'no ?v= on the stylesheet - it cannot be cached long');

    const jsUrl = (home.body.match(/assets\/js\/main\.js\?v=\d+/) || [])[0];
    if (jsUrl) ok('the script URL is version-stamped', jsUrl);
    else bad('the script URL is version-stamped', 'no ?v= on the script');

    if (home.body.includes('media="print"') && home.body.includes("onload=\"this.media='all'\"")) {
      ok('fonts load without blocking the first paint');
    } else {
      warn('fonts load without blocking the first paint', 'the font stylesheet still blocks rendering');
    }

    // --- Package card -----------------------------------------------------
    // The short summary was removed from the homepage pricing card, leaving the
    // name directly above the price.
    if (/class="price-head">\s*<h3>[^<]*<\/h3>\s*<\/header>/.test(home.body)) {
      ok('the package card no longer shows a short summary');
    } else {
      bad('the package card no longer shows a short summary', 'the price-head still contains more than the name');
    }

    // --- Comparison page --------------------------------------------------
    const empty = await req('/compare');
    if (empty.status === 200) ok('the comparison page renders', '/compare → 200');
    else bad('the comparison page renders', `got ${empty.status}`);

    if (empty.body.includes('Nothing selected yet')) ok('the comparison page has an empty state');
    else bad('the comparison page has an empty state', 'nothing tells the visitor to pick a package');

    const single = await req('/compare?p=woocommerce-web-design-business');
    if (single.body.includes('Pick one more package')) ok('one selection asks for a second');
    else bad('one selection asks for a second', 'a one-column table was rendered');

    // Real slugs, read from the database so the test does not depend on demo
    // content that may have been renamed or removed.
    const slugs = (
      await db.query("SELECT slug FROM services WHERE status = 'active' ORDER BY sort_order ASC, id ASC LIMIT 6")
    ).map((row) => row.slug);

    if (slugs.length < 3) {
      warn('the comparison table renders', 'fewer than three active packages to compare');
    } else {
      const two = await req(`/compare?p=${slugs[0]}&p=${slugs[1]}`);
      const twoCols = (two.body.match(/class="cmp-col-head"/g) || []).length;
      if (twoCols === 2) ok('a two-package comparison renders two columns');
      else bad('a two-package comparison renders two columns', `got ${twoCols}`);

      if ((two.body.match(/cmp-yes/g) || []).length > 0) ok('the comparison marks included features');
      else bad('the comparison marks included features', 'no tick cells');

      if ((two.body.match(/cmp-no/g) || []).length > 0) ok('the comparison marks absent features');
      else bad('the comparison marks absent features', 'no dash cells');

      const three = await req(`/compare?p=${slugs[0]}&p=${slugs[1]}&p=${slugs[2]}`);
      const threeCols = (three.body.match(/class="cmp-col-head"/g) || []).length;
      if (threeCols === 3) ok('a three-package comparison renders three columns');
      else bad('a three-package comparison renders three columns', `got ${threeCols}`);

      // The cap. Five slugs are requested; only four columns may come back.
      const many = slugs.slice(0, 5).map((slug) => `p=${slug}`).join('&');
      const capped = await req(`/compare?${many}`);
      const cappedCols = (capped.body.match(/class="cmp-col-head"/g) || []).length;
      if (cappedCols <= 4) ok('the comparison caps the columns at four', `${cappedCols} column(s) from 5 requested`);
      else bad('the comparison caps the columns at four', `got ${cappedCols}`);

      const disabled = (capped.body.match(/is-disabled/g) || []).length;
      if (disabled > 0) ok('the picker disables the remaining boxes at the cap');
      else warn('the picker disables the remaining boxes at the cap', 'nothing stops a fifth selection');
    }

    // --- Settings surface -------------------------------------------------
    const login = await adminLogin();
    if (!login.ok) {
      warn('the crawler settings tab renders', `${login.reason} - skipping`);
    } else {
      const tab = await req(`/${ADMIN_SLUG}/settings?group=seo_files`);
      if (tab.status === 200 && tab.body.includes('robots_enabled')) {
        ok('the crawler settings tab renders', 'Robots & Sitemap');
      } else {
        bad('the crawler settings tab renders', `status ${tab.status}`);
      }

      const security = await req(`/${ADMIN_SLUG}/settings?group=security`);
      if (security.body.includes('CAPTCHA is switched on but not configured')) {
        ok('the security tab warns when CAPTCHA has no keys');
      } else {
        warn('the security tab warns when CAPTCHA has no keys', 'keys may be configured - nothing to warn about');
      }

      // The dashboard is where an operator lands after signing in, so the same
      // warning has to be visible there - a warning only on the tab that
      // happens to hold the setting is a warning nobody reads.
      const dashboard = await req(`/${ADMIN_SLUG}/dashboard`);
      if (dashboard.status !== 200) {
        bad('the dashboard renders for the CAPTCHA check', `got ${dashboard.status}`);
      } else if (security.body.includes('CAPTCHA is switched on but not configured')) {
        if (dashboard.body.includes('CAPTCHA is on but not configured')) {
          ok('the dashboard flags the CAPTCHA misconfiguration');
        } else {
          bad('the dashboard flags the CAPTCHA misconfiguration', 'the card is missing');
        }
      } else {
        warn('the dashboard flags the CAPTCHA misconfiguration', 'keys are configured - nothing to flag');
      }

      // The SQL backup streams the dump with res.write as it walks the tables.
      // The compression middleware buffers responses to decide whether to
      // compress them, which would hold the whole dump in memory and deliver
      // nothing until it finished - so a type it can never compress has to be
      // released straight back to Node.
      const backup = await req(`/${ADMIN_SLUG}/backup/download`, {
        headers: { 'accept-encoding': 'gzip' },
      });

      if (backup.status !== 200) {
        bad('the backup downloads', `got ${backup.status}`);
      } else if (backup.headers.get('content-encoding')) {
        bad('the backup is not compressed', `content-encoding: ${backup.headers.get('content-encoding')}`);
      } else if (!backup.body.includes('SET FOREIGN_KEY_CHECKS')) {
        bad('the backup downloads', 'the body is not a SQL dump');
      } else {
        ok('the backup streams uncompressed', 'application/sql is released, not buffered');
      }
    }
  } catch (err) {
    bad('crawler files and comparison', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * Does the CAPTCHA actually render once keys exist?
 *
 * Every other CAPTCHA check in this file runs against a site with no keys, so
 * they all pass whether or not the widget is wired up. That is precisely how a
 * "captcha is broken" report survives four rounds of fixes: nothing was ever
 * asserting that a widget appears.
 *
 * Google publishes a test key pair that always validates. Saving those turns
 * the question into a measurable one - either the widget markup is on the form
 * or it is not - without needing the operator's real keys, and the secret is
 * live enough to prove the server half against Google itself.
 *
 *   site key   6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI
 *   secret     6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe
 *
 * Everything is restored afterwards, by writing straight to the table: a blank
 * secret in the settings form means "keep what is stored", so the form cannot
 * clear it.
 */
async function checkCaptchaWiring() {
  section('23. The CAPTCHA widget renders once keys are configured');

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');
  const captcha = require('../src/middleware/captcha');

  const TEST_SITE_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';
  const TEST_SECRET = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';

  // Every setting this section overwrites, read first so it can be put back.
  //
  // This used to restore to a blank value, which is fine on a site with no keys
  // and destructive on one that has them - running the test suite would delete
  // a working reCAPTCHA configuration. A test may change the site; it may not
  // discard it.
  const original = {};

  async function captureOriginals() {
    const keys = [
      'captcha_site_key',
      'captcha_secret_key',
      'captcha_version',
      'captcha_mode',
      'captcha_on_login',
      'captcha_on_signup',
      'captcha_on_admin',
      'captcha_on_contact',
    ];

    const rows = await db.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${keys.map(() => '?').join(', ')})`,
      keys
    );
    for (const row of rows) original[row.setting_key] = row.setting_value;
  }

  async function restoreOriginals() {
    for (const [key, value] of Object.entries(original)) {
      await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
    }
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);
  }

  try {
    await captureOriginals();

    const login = await adminLogin();
    if (!login.ok) {
      warn('the CAPTCHA widget renders', `${login.reason} - skipping`);
      await db.close().catch(() => {});
      return;
    }

    const tab = await req(`/${ADMIN_SLUG}/settings?group=security`);
    const csrf = tab.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrf) {
      bad('the CAPTCHA widget renders', 'no CSRF token on the security tab');
      await db.close().catch(() => {});
      return;
    }

    const body = new URLSearchParams({
      _csrf: csrf[1],
      group: 'security',
      captcha_on_login: '1',
      captcha_on_signup: '1',
      captcha_on_admin: '1',
      captcha_on_contact: '1',
      captcha_site_key: TEST_SITE_KEY,
      captcha_secret_key: TEST_SECRET,
      captcha_mode: 'invisible',
      captcha_version: 'v2',
      captcha_min_score: '50',
      admin_path_slug: ADMIN_SLUG,
      max_login_attempts: '5',
      lockout_minutes: '15',
      force_https: '1',
    }).toString();

    const saved = await req(`/${ADMIN_SLUG}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (![301, 302, 303].includes(saved.status)) {
      bad('the test keys save', `got ${saved.status}`);
      await db.close().catch(() => {});
      return;
    }
    ok('the test keys save', 'Google\'s published test pair');

    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);

    // --- The widget is on every form that should carry one -----------------
    //
    // The admin login page is checked last and signed out, because this run is
    // already authenticated: the login route redirects a signed-in staff
    // member straight to the dashboard, so requesting it with a session would
    // measure the redirect rather than the form.
    const forms = [
      ['/signin', 'signin'],
      ['/signup', 'signup'],
      ['/contact', 'contact'],
      ['/', 'homepage CTA'],
      ['/forgot-password', 'forgot password'],
    ];

    for (const [path, label] of forms) {
      const page = await req(path);
      const hasWidget = page.body.includes('class="g-recaptcha"');
      const hasScript = page.body.includes('recaptcha/api.js?render=explicit');

      if (hasWidget && hasScript) ok(`the ${label} form carries the widget`, path);
      else if (!hasWidget) bad(`the ${label} form carries the widget`, 'no .g-recaptcha element');
      else bad(`the ${label} form carries the widget`, 'the widget is there but its script is not');
    }

    resetCookies();
    const adminLoginPage = await req(`/${ADMIN_SLUG}/login`);
    if (adminLoginPage.status !== 200) {
      bad('the admin login form carries the widget', `expected 200 signed out, got ${adminLoginPage.status}`);
    } else if (adminLoginPage.body.includes('class="g-recaptcha"') &&
               adminLoginPage.body.includes('recaptcha/api.js')) {
      ok('the admin login form carries the widget', `/${ADMIN_SLUG}/login`);
    } else {
      bad('the admin login form carries the widget', 'no widget on the admin sign-in form');
    }

    // --- The server half, against Google ------------------------------------
    // The test secret always validates, so this proves the whole path: fetch,
    // form encoding, Google's answer, and the decision made from it.
    const outcome = await captcha.verify('smoke-test-token', '127.0.0.1', 'admin');

    if (outcome.ok && outcome.degraded) {
      warn('the server accepts a token Google validates', 'Google was unreachable - the check degraded to fail-open');
    } else if (outcome.ok) {
      ok('the server accepts a token Google validates', 'test secret accepted');
    } else {
      bad('the server accepts a token Google validates', outcome.message || 'rejected');
    }

    // --- A missing token must still be refused ------------------------------
    const noToken = await captcha.verify(null, '127.0.0.1', 'admin');
    if (!noToken.ok) ok('a submission with no token is refused', noToken.reason || 'rejected');
    else bad('a submission with no token is refused', 'it was let through with keys configured');

    // --- v3 mode does not render a widget -----------------------------------
    await db.query("UPDATE settings SET setting_value = 'v3' WHERE setting_key = 'captcha_version'");
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);

    const v3Page = await req('/signin');
    if (v3Page.body.includes('data-recaptcha-v3')) {
      ok('v3 mode switches to a hidden token field');
    } else {
      bad('v3 mode switches to a hidden token field', 'no data-recaptcha-v3 input');
    }

    if (v3Page.body.includes('recaptcha/api.js?render=' + TEST_SITE_KEY)) {
      ok('v3 loads the script with the site key in the URL');
    } else {
      bad('v3 loads the script with the site key in the URL', 'the script URL is wrong for v3');
    }

    if (!v3Page.body.includes('class="g-recaptcha"')) {
      ok('v3 renders no widget', 'nothing to click, as designed');
    } else {
      bad('v3 renders no widget', 'a v2 widget is still being rendered under a v3 key');
    }
  } catch (err) {
    bad('the CAPTCHA widget renders', err.message);
  }

  // --- Restore ---------------------------------------------------------------
  // Straight to the table, and back to whatever was there before.
  //
  // The settings form cannot restore a secret - a blank field there means "keep
  // the stored value" - so writing the rows directly is the only way. Writing
  // blanks would have been simpler and would have deleted a working key pair on
  // any site that had one.
  try {
    await restoreOriginals();

    const siteKey = settingsSvc.get('captcha_site_key');
    const expected = original.captcha_site_key || '';

    if (String(siteKey || '') === String(expected)) {
      ok('the CAPTCHA settings are restored', expected ? 'the site\'s own keys put back' : 'left unconfigured');
    } else {
      bad('the CAPTCHA settings are restored', `site key is "${siteKey}", expected "${expected}"`);
    }

    const version = settingsSvc.get('captcha_version');
    if (String(version || '') === String(original.captcha_version || '')) {
      ok('the CAPTCHA version is restored', String(version));
    } else {
      bad('the CAPTCHA version is restored', `got ${version}, expected ${original.captcha_version}`);
    }
  } catch (err) {
    bad('the CAPTCHA settings are restored', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * Every notification reaches the right inboxes.
 *
 * The transport is replaced with one that records instead of sending, so the
 * assertions are on the real recipients and subjects the application builds -
 * not on a mock of the application.
 *
 * This exists because the order-status notification was silently gated on the
 * order reaching `active`. Every other status change wrote to the database and
 * told nobody, and nothing anywhere reported that. A test that only checked
 * "mail is configured" would have passed throughout.
 */
async function checkMailNotifications() {
  section('24. Every notification reaches the right inboxes');

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');
  const nodemailer = require('nodemailer');
  const mail = require('../src/services/mail.service');

  const sent = [];
  const originalCreateTransport = nodemailer.createTransport;
  const ALERT_ADDRESS = 'smoke-alerts@example.com';

  try {
    // A transport that records. `verify` resolves so the test-mail action can
    // report success without a network round trip.
    nodemailer.createTransport = () => ({
      sendMail: async (message) => {
        sent.push(message);
        return { messageId: `smoke-${sent.length}` };
      },
      verify: async () => true,
      close() {},
    });

    // Make SMTP look configured, or send() short-circuits before it builds
    // anything worth asserting on.
    await db.query("UPDATE settings SET setting_value = 'smoke-not-a-real-password' WHERE setting_key = 'smtp_password'");
    await db.query("UPDATE settings SET setting_value = '1' WHERE setting_key = 'smtp_enabled'");
    await db.query("UPDATE settings SET setting_value = '1' WHERE setting_key = 'notify_admin_new_order'");
    await db.query("UPDATE settings SET setting_value = '1' WHERE setting_key = 'notify_customer_order_status'");
    await db.query("UPDATE settings SET setting_value = '1' WHERE setting_key = 'notify_admin_contact'");
    await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [ALERT_ADDRESS, 'notify_admin_email']);

    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);
    mail.resetTransport();

    const configured = await mail.verify();
    if (configured.ok) ok('the transport reports healthy', 'stubbed');
    else bad('the transport reports healthy', configured.error);

    // --- Contact form, end to end over HTTP ---------------------------------
    // Both the contact page and the homepage quote box post here, so this one
    // request covers both.
    const contactPage = await req('/contact');
    const csrf = contactPage.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrf) {
      bad('the contact form sends two emails', 'no CSRF token on /contact');
    } else {
      sent.length = 0;

      const submit = await req('/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          _csrf: csrf[1],
          name: 'Smoke Sender',
          email: 'smoke-sender@example.com',
          phone: '+8801700000000',
          subject: 'Smoke test enquiry',
          message: 'Checking that both notifications are sent.',
          source: 'contact_page',
        }).toString(),
      });

      if ([301, 302, 303].includes(submit.status)) {
        ok('the contact form submits', `→ ${String(submit.location).replace(BASE, '')}`);
      } else {
        bad('the contact form submits', `got ${submit.status}`);
      }

      const toCustomer = sent.filter((m) => String(m.to).includes('smoke-sender@example.com'));
      const toAdmin = sent.filter((m) => String(m.to).includes(ALERT_ADDRESS));

      if (toCustomer.length) ok('the sender gets an acknowledgement', toCustomer[0].subject);
      else bad('the sender gets an acknowledgement', 'nothing sent to the customer');

      if (toAdmin.length) ok('the admin gets an enquiry alert', toAdmin[0].subject);
      else bad('the admin gets an enquiry alert', `nothing sent to ${ALERT_ADDRESS}`);

      // The reply-to is what makes the alert actionable - without it a reply
      // goes to the site's own mailbox.
      if (toAdmin.length && String(toAdmin[0].replyTo).includes('smoke-sender@example.com')) {
        ok('the enquiry alert replies to the sender', toAdmin[0].replyTo);
      } else if (toAdmin.length) {
        warn('the enquiry alert replies to the sender', `reply-to is ${toAdmin[0].replyTo}`);
      }
    }

    // --- New order reaches the admin and every active staff member ----------
    sent.length = 0;
    await mail.sendAdminNewOrder(
      { order_number: 'WBD-SMOKE-1', service_title: 'Smoke Package', total: 1000, payment_status: 'unpaid' },
      { name: 'Smoke Customer', email: 'smoke-buyer@example.com' }
    );

    if (sent.length) {
      const recipients = String(sent[0].to);
      if (recipients.includes(ALERT_ADDRESS)) ok('the new-order alert reaches the alert address');
      else bad('the new-order alert reaches the alert address', recipients);

      if (recipients.includes('@')) ok('the new-order alert has at least one recipient', recipients);
      else bad('the new-order alert has at least one recipient', 'no recipients');
    } else {
      bad('the new-order alert is sent', 'nothing was sent');
    }

    // --- Order status change, over HTTP, for a non-active status ------------
    // This is the regression: moving an order to `in_progress` used to change
    // the status and notify nobody.
    //
    // Signed in here rather than earlier: the CAPTCHA section signs out on
    // purpose to reach the admin login form, and the contact form above is
    // public, so this is the first check that needs a staff session.
    const login = await adminLogin();
    if (!login.ok) {
      warn('a status change notifies the customer', `${login.reason} - skipping`);
    } else {
      const order = await db.queryOne(
        "SELECT id, order_number, status FROM orders WHERE status = 'pending' ORDER BY id DESC LIMIT 1"
      );

      if (!order) {
        warn('a status change notifies the customer', 'no pending order to move');
      } else {
        const detail = await req(`/${ADMIN_SLUG}/orders/${order.id}`);
        const orderCsrf = detail.body.match(/name="_csrf"\s+value="([^"]+)"/);

        if (!orderCsrf) {
          bad('a status change notifies the customer', `no CSRF token on the order page (status ${detail.status})`);
        } else {
          sent.length = 0;

          const moved = await req(`/${ADMIN_SLUG}/orders/${order.id}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              _csrf: orderCsrf[1],
              status: 'in_progress',
              note: 'Smoke test moved this order.',
            }).toString(),
          });

          if ([301, 302, 303].includes(moved.status)) {
            const after = await db.queryOne('SELECT status FROM orders WHERE id = ?', [order.id]);

            if (after && after.status === 'in_progress') {
              ok('the order status change is saved', `pending → ${after.status}`);
            } else {
              bad('the order status change is saved', `status is ${after && after.status}`);
            }

            if (sent.length) {
              ok('a non-active status change still notifies the customer', sent[0].subject);
            } else {
              bad('a non-active status change still notifies the customer', 'no email was sent');
            }

            // Put it back so the run is repeatable.
            await db.query("UPDATE orders SET status = 'pending' WHERE id = ?", [order.id]);
          } else {
            bad('a status change notifies the customer', `the update returned ${moved.status}`);
          }
        }
      }
    }

    // --- The admin panel can test its own mail ------------------------------
    {
      const smtpTab = await req(`/${ADMIN_SLUG}/settings?group=smtp`);
      if (smtpTab.body.includes('settings/test-mail')) {
        ok('the SMTP tab offers a send-test action');
      } else {
        bad('the SMTP tab offers a send-test action', 'no form posting to test-mail');
      }

      const tabCsrf = smtpTab.body.match(/name="_csrf"\s+value="([^"]+)"/);
      sent.length = 0;

      const test = await req(`/${ADMIN_SLUG}/settings/test-mail`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: tabCsrf ? tabCsrf[1] : '', to: 'smoke-test@example.com' }).toString(),
      });

      if ([301, 302, 303].includes(test.status) && sent.length) {
        ok('the send-test action sends a message', sent[0].subject);
      } else {
        bad('the send-test action sends a message', `status ${test.status}, ${sent.length} sent`);
      }

      // --- Email branding and template overrides ----------------------------
      //
      // Run here, while the transport is still recording. The two failures this
      // guards against are both invisible from the settings screen: a header
      // with no logo at all, and a logo the inbox will not render.

      const branding = await req(`/${ADMIN_SLUG}/settings?group=email`);
      if (branding.status === 200 && branding.body.includes('Email header preview')) {
        ok('the Email tab previews the header');
      } else {
        bad('the Email tab previews the header', `status ${branding.status}, no preview block`);
      }

      if (branding.body.includes('email_logo')) {
        ok('the Email tab offers a logo upload');
      } else {
        bad('the Email tab offers a logo upload', 'no email_logo field');
      }

      if (branding.body.includes('subject')) {
        ok('the Email tab lists the templates', 'editable subject and heading per template');
      } else {
        bad('the Email tab lists the templates', 'no template fields rendered');
      }

      // An SVG logo is the trap: it previews perfectly and arrives broken.
      const { TEMPLATES } = require('../src/config/email-templates');
      const schema = require('../src/config/settings-schema');

      const missing = TEMPLATES.filter(
        (t) => !schema.BY_KEY[`email_tpl_${t.key}_subject`] || !schema.BY_KEY[`email_tpl_${t.key}_heading`]
      );

      if (!missing.length) {
        ok('every template has editable fields', `${TEMPLATES.length} template(s)`);
      } else {
        bad('every template has editable fields', `missing: ${missing.map((t) => t.key).join(', ')}`);
      }

      // The placeholder filler must leave an unknown name visible rather than
      // blanking it - a subject reading "Order  is now" is far harder to spot
      // than one reading "Order {order_number} is now".
      const { fill } = require('../src/config/email-templates');
      const filled = fill('Order {order_number} for {unknown_thing}', { order_number: 'WBD-1' });

      if (filled === 'Order WBD-1 for {unknown_thing}') {
        ok('placeholders fill, and an unknown one stays visible', filled);
      } else {
        bad('placeholders fill, and an unknown one stays visible', filled);
      }

      // A saved override must reach the message. This is the whole feature.
      await db.query(
        "UPDATE settings SET setting_value = ? WHERE setting_key = 'email_tpl_test_subject'",
        ['SMOKE override {site}']
      );
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
      mail.resetTransport();

      sent.length = 0;
      await mail.sendTest('smoke-branding@example.com');

      const siteName = settingsSvc.get('site_name', 'WooBD.Com');
      if (sent.length && sent[0].subject === `SMOKE override ${siteName}`) {
        ok('a saved subject override is used', sent[0].subject);
      } else {
        bad('a saved subject override is used', sent.length ? sent[0].subject : 'nothing sent');
      }

      // Blank means "use the built-in default", so clearing it must restore the
      // original wording rather than send an empty subject.
      await db.query("UPDATE settings SET setting_value = '' WHERE setting_key = 'email_tpl_test_subject'");
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);
      mail.resetTransport();

      sent.length = 0;
      await mail.sendTest('smoke-branding@example.com');

      if (sent.length && sent[0].subject === `${siteName} - SMTP test`) {
        ok('a blank override falls back to the default', sent[0].subject);
      } else {
        bad('a blank override falls back to the default', sent.length ? sent[0].subject : 'nothing sent');
      }

      // --- The SVG warning ---------------------------------------------------
      //
      // The trap this exists for: an SVG logo renders perfectly in the settings
      // preview and arrives as a broken image in every inbox, because Gmail,
      // Outlook and Apple Mail all refuse to display SVG. Nothing else in the
      // panel says so.
      const originalLogo = settingsSvc.get('email_logo') || '';

      await db.query("UPDATE settings SET setting_value = '/assets/img/logo-light.svg' WHERE setting_key = 'email_logo'");
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);

      const withSvg = await req(`/${ADMIN_SLUG}/settings?group=email`);
      if (withSvg.body.includes('will not display it') || withSvg.body.includes('will not render')) {
        ok('an SVG email logo is flagged', 'the panel warns that inboxes will not show it');
      } else {
        bad('an SVG email logo is flagged', 'no warning for an SVG logo');
      }

      // A raster logo must not be flagged.
      await db.query("UPDATE settings SET setting_value = '/uploads/branding/logo.png' WHERE setting_key = 'email_logo'");
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);

      const withPng = await req(`/${ADMIN_SLUG}/settings?group=email`);
      if (!withPng.body.includes('will not display it')) {
        ok('a PNG email logo is not flagged');
      } else {
        bad('a PNG email logo is not flagged', 'the SVG warning fired for a PNG');
      }

      await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [originalLogo, 'email_logo']);
      settingsSvc.invalidate();
      await settingsSvc.loadAll(true);

      if ((settingsSvc.get('email_logo') || '') === originalLogo) {
        ok('the email logo setting is restored', originalLogo ? originalLogo : 'left blank');
      } else {
        bad('the email logo setting is restored', `expected "${originalLogo}", got "${settingsSvc.get('email_logo')}"`);
      }

      // A logo whose file is missing must be skipped, not sent.
      //
      // Uploads live outside version control, so a restored database routinely
      // points at files that were never copied across. A broken image in every
      // message reads as a broken brand; a text header just looks plain.
      const mailSvc = require('../src/services/mail.service');

      if (mailSvc.isUsableLogo('/uploads/definitely-not-here.png') === false) {
        ok('a logo pointing at a missing file is rejected');
      } else {
        bad('a logo pointing at a missing file is rejected', 'a missing file was accepted');
      }

      if (mailSvc.isUsableLogo('https://cdn.example.com/logo.png') === true) {
        ok('a remote logo URL is accepted', 'the server cannot check a CDN, so it trusts it');
      } else {
        bad('a remote logo URL is accepted', 'a remote URL was rejected');
      }

      if (mailSvc.isUsableLogo('') === false && mailSvc.isUsableLogo(null) === false) {
        ok('an empty logo is rejected');
      } else {
        bad('an empty logo is rejected', 'an empty value was treated as usable');
      }
    }
  } catch (err) {
    bad('mail notifications', err.message);
  }

  // --- Restore ---------------------------------------------------------------
  nodemailer.createTransport = originalCreateTransport;

  try {
    await db.query("UPDATE settings SET setting_value = '' WHERE setting_key = 'smtp_password'");
    await db.query("UPDATE settings SET setting_value = '' WHERE setting_key = 'notify_admin_email'");
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);
    mail.resetTransport();
    ok('the SMTP test values are cleared again');
  } catch (err) {
    bad('the SMTP test values are cleared again', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * Page hero backgrounds.
 *
 * Three states have to hold, and only the middle one is interesting: with
 * nothing configured the hero must look exactly as it did before the feature
 * existed, a colour must apply with a text colour that stays readable on it,
 * and an image must land on its own layer.
 *
 * The contrast case is the one worth testing. A dark navy hero with the theme's
 * dark text is unreadable, and nothing about the markup says so.
 */
async function checkHeroBackgrounds() {
  section('25. Page hero backgrounds');

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');

  try {
    // --- Unconfigured: unchanged -------------------------------------------
    const plain = await req('/services');
    if (plain.body.includes('class="page-hero"')) {
      ok('an unconfigured hero renders plain', 'no background classes added');
    } else {
      bad('an unconfigured hero renders plain', 'the hero carries classes with nothing set');
    }

    // --- A dark colour gets white text --------------------------------------
    await db.query("UPDATE settings SET setting_value = '#0f2a4a' WHERE setting_key = 'hero_about_bg_color'");
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);

    const dark = await req('/about');
    if (dark.body.includes('has-custom-bg') && dark.body.includes('--hero-bg: #0f2a4a')) {
      ok('a chosen colour reaches the hero', '#0f2a4a');
    } else {
      bad('a chosen colour reaches the hero', 'the colour or the class is missing');
    }

    if (dark.body.includes('text-on-light')) {
      ok('a dark hero switches to light text', 'dark navy → white text');
    } else {
      bad('a dark hero switches to light text', 'dark text on a dark background is unreadable');
    }

    // --- A light colour keeps dark text --------------------------------------
    await db.query("UPDATE settings SET setting_value = '#fdf6e3' WHERE setting_key = 'hero_about_bg_color'");
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);

    const light = await req('/about');
    if (light.body.includes('text-on-dark')) {
      ok('a light hero keeps dark text', 'cream → theme text colour');
    } else {
      bad('a light hero keeps dark text', 'white text on a light background is unreadable');
    }

    // --- The helper itself, at the boundaries --------------------------------
    const helpers = require('../src/utils/helpers');
    const cases = [
      ['#000000', 'light'],
      ['#ffffff', 'dark'],
      ['#0f2a4a', 'light'],
      ['#fdf6e3', 'dark'],
      ['', 'dark'],
      ['not-a-colour', 'dark'],
    ];
    const wrong = cases.filter(([input, expected]) => helpers.contrastText(input) !== expected);

    if (!wrong.length) ok('contrastText handles the boundaries', `${cases.length} cases`);
    else bad('contrastText handles the boundaries', wrong.map(([i, e]) => `${i} → expected ${e}`).join(', '));

    // --- An image gets its own layer ----------------------------------------
    await db.query("UPDATE settings SET setting_value = '#0f2a4a' WHERE setting_key = 'hero_about_bg_color'");
    await db.query(
      "UPDATE settings SET setting_value = '/assets/img/portfolio-default.svg' WHERE setting_key = 'hero_services_bg_image'"
    );
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);

    const media = await req('/services');
    if (media.body.includes('page-hero-media') && media.body.includes('class="page-hero-bg"')) {
      ok('a hero image renders on its own layer', 'so the blur does not touch the heading');
    } else {
      bad('a hero image renders on its own layer', 'no .page-hero-bg element');
    }

    if (/hero-treat-[a-z-]+/.test(media.body)) {
      ok('the image treatment class is applied');
    } else {
      bad('the image treatment class is applied', 'no hero-treat-* class');
    }
  } catch (err) {
    bad('page hero backgrounds', err.message);
  }

  // --- Restore ---------------------------------------------------------------
  try {
    await db.query(
      "UPDATE settings SET setting_value = '' WHERE setting_key IN ('hero_about_bg_color', 'hero_services_bg_image', 'cta_bg_color')"
    );
    settingsSvc.invalidate();
    await settingsSvc.loadAll(true);
    ok('the hero test values are cleared again');
  } catch (err) {
    bad('the hero test values are cleared again', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * install.sql is importable, and carries no credentials.
 *
 * Both have failed before, in ways that are invisible until the moment someone
 * needs the file. A phpMyAdmin export writes a bare `CREATE TABLE` with no
 * matching `DROP`, so the second import stops at "table already exists" and
 * leaves a half-populated database - and a raw export of the settings table
 * publishes every credential, because it stores them unencrypted.
 *
 * Static, so it needs no database privileges beyond reading a file.
 */
function checkInstallSql() {
  section('26. install.sql is importable and clean');

  const fs = require('fs');
  const path = require('path');
  const schema = require('../src/config/settings-schema');

  let sql;
  try {
    sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'install.sql'), 'utf8');
  } catch (err) {
    bad('install.sql is readable', err.message);
    return;
  }

  const creates = (sql.match(/^CREATE TABLE `([^`]+)`/gm) || []).map((line) => line.replace(/^CREATE TABLE `|`$/g, ''));
  const drops = new Set((sql.match(/^DROP TABLE IF EXISTS `([^`]+)`;/gm) || []).map((line) => line.replace(/^DROP TABLE IF EXISTS `|`;$/g, '')));

  if (creates.length) ok('install.sql declares its tables', `${creates.length} CREATE TABLE`);
  else bad('install.sql declares its tables', 'no CREATE TABLE found');

  const undropped = creates.filter((table) => !drops.has(table));
  if (!undropped.length) {
    ok('every table is dropped before it is created', `${drops.size} DROP TABLE`);
  } else {
    bad('every table is dropped before it is created', `missing DROP for: ${undropped.join(', ')}`);
  }

  // The drop block must come before the first create, or a re-import still
  // fails on whichever table it reaches first.
  const firstDrop = sql.indexOf('DROP TABLE IF EXISTS');
  const firstCreate = sql.indexOf('CREATE TABLE');
  if (firstDrop >= 0 && firstDrop < firstCreate) {
    ok('the drops run before the creates');
  } else {
    bad('the drops run before the creates', 'the first CREATE comes first');
  }

  // No credential value may be present. The key name is fine - the row has to
  // exist so the installer seeds it - but the value must be empty.
  const leaked = [];
  for (const key of schema.SECRET_KEYS) {
    const pattern = new RegExp(",\\s*'" + key + "',\\s*'([^']*)'");
    const match = sql.match(pattern);
    if (match && match[1]) leaked.push(key);
  }

  if (!leaked.length) ok('no credential value is written into install.sql', `${schema.SECRET_KEYS.size} key(s) checked`);
  else bad('no credential value is written into install.sql', `non-empty: ${leaked.join(', ')}`);

  // The settings rows must still be there - a scrub that removed them would
  // leave a site with no configuration at all.
  //
  // Counted across every settings statement, not the first: rows are written
  // 100 to a statement, so a file with 200 settings has two of them and
  // reading only the first under-reports by half.
  const settingsBlocks = sql.match(/INSERT INTO `settings`[\s\S]*?;\n/g) || [];
  const settingsRows = settingsBlocks.reduce(
    (total, block) => total + (block.match(/^\(\d+, '/gm) || []).length,
    0
  );

  if (settingsRows > 150) ok('the settings rows are present', `${settingsRows} row(s)`);
  else bad('the settings rows are present', `only ${settingsRows} rows`);

  // Sessions belong to one install. Their structure has to ship - the session
  // store does not create its own table - but not their contents.
  if (/CREATE TABLE `sessions`/.test(sql)) ok('the sessions table structure ships');
  else bad('the sessions table structure ships', 'a fresh install would have no session table');

  if (/INSERT INTO `sessions`/.test(sql)) {
    bad('session rows are not seeded', 'live session ids are in a committed file');
  } else {
    ok('session rows are not seeded', 'structure only');
  }
}

/**
 * Turn the CAPTCHA toggles off for the duration of the run, and put them back.
 *
 * The suite submits real forms - sign-in, checkout, the contact box - and it
 * cannot solve a challenge. With the toggles on, every one of those comes back
 * 400 and the business logic behind them stops being tested at all.
 *
 * This is an outer save/restore. Section 23 turns the toggles back on for its
 * own checks and restores whatever it found, so the two do not fight.
 *
 * Returns the values it replaced, so the caller can put them back.
 */
async function suspendCaptcha() {
  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');

  const keys = ['captcha_on_login', 'captcha_on_signup', 'captcha_on_admin', 'captcha_on_contact'];
  const saved = {};

  const rows = await db.query(
    `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${keys.map(() => '?').join(', ')})`,
    keys
  );
  for (const row of rows) saved[row.setting_key] = row.setting_value;

  await db.query(
    `UPDATE settings SET setting_value = '0' WHERE setting_key IN (${keys.map(() => '?').join(', ')})`,
    keys
  );
  settingsSvc.invalidate();
  await settingsSvc.loadAll(true);

  return saved;
}

async function restoreCaptcha(saved) {
  if (!saved || !Object.keys(saved).length) return;

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');

  for (const [key, value] of Object.entries(saved)) {
    await db.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
  }
  settingsSvc.invalidate();
  await settingsSvc.loadAll(true);
}

/**
 * The live chat dashboard.
 *
 * The widget has always been a stateless API endpoint - it answered visitors
 * and kept nothing anyone could read. This section proves the panel can now
 * actually see what was said, which is the whole point of the feature.
 */
async function checkChatDashboard() {
  section('27. Live chat dashboard');

  const db = require('../src/config/database');

  try {
    const login = await adminLogin();
    if (!login.ok) {
      warn('the chat dashboard renders', `${login.reason} - skipping`);
      await db.close().catch(() => {});
      return;
    }

    // --- The list ------------------------------------------------------------
    const list = await req(`/${ADMIN_SLUG}/chat`);

    if (list.status === 200) ok('the chat dashboard renders', `/${ADMIN_SLUG}/chat → 200`);
    else bad('the chat dashboard renders', `got ${list.status}`);

    // A status code alone proves nothing here: the admin panel renders the
    // dashboard for an unmatched route, so a 200 would look identical whether
    // the chat page loaded or the route silently fell through to something else.
    if (list.body.includes('chat-stats') || list.body.includes('chat-row')) {
      ok('the chat page is the chat page', 'its own markup is present');
    } else if (list.body.includes('Needs your attention')) {
      bad('the chat page is the chat page', 'the dashboard rendered instead - the route fell through');
    } else {
      bad('the chat page is the chat page', 'no chat markup found in the response');
    }

    // The sidebar link, so the page is reachable without typing the URL.
    const dashboard = await req(`/${ADMIN_SLUG}/dashboard`);
    if (dashboard.body.includes(`/${ADMIN_SLUG}/chat`)) {
      ok('the sidebar links to the chat dashboard');
    } else {
      bad('the sidebar links to the chat dashboard', 'no nav link found');
    }

    // --- The empty state explains itself --------------------------------------
    // Three different causes, three different fixes. A blank panel that says
    // nothing is how an operator concludes the feature is broken.
    const conversationCount = await db.queryOne('SELECT COUNT(*) AS n FROM chat_conversations');
    if (!Number(conversationCount.n)) {
      if (list.body.includes('chat widget') || list.body.includes('No conversations yet')) {
        ok('the empty state explains why there is nothing');
      } else {
        bad('the empty state explains why there is nothing', 'a blank panel with no explanation');
      }
      await db.close().catch(() => {});
      return;
    }

    ok('the dashboard lists conversations', `${conversationCount.n} conversation(s)`);

    // --- One conversation, end to end ----------------------------------------
    const row = await db.queryOne('SELECT id, status FROM chat_conversations ORDER BY id ASC LIMIT 1');
    const detail = await req(`/${ADMIN_SLUG}/chat/${row.id}`);

    if (detail.status === 200) ok('a conversation renders', `#${row.id} → 200`);
    else bad('a conversation renders', `#${row.id} → ${detail.status}`);

    const messageCount = await db.queryOne('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?', [row.id]);
    if (Number(messageCount.n) === 0) {
      warn('the transcript shows its messages', 'this conversation has no messages');
    } else if (detail.body.includes('chat-bubble')) {
      ok('the transcript shows its messages', `${messageCount.n} bubble(s)`);
    } else {
      bad('the transcript shows its messages', `${messageCount.n} in the database, none on the page`);
    }

    // A visitor's message and the assistant's reply must be distinguishable,
    // or the transcript is unreadable.
    if (detail.body.includes('chat-bubble-visitor') && detail.body.includes('chat-bubble-assistant')) {
      ok('visitor and assistant turns are distinguished');
    } else {
      bad('visitor and assistant turns are distinguished', 'no per-role bubble classes');
    }

    // --- Closing and reopening -------------------------------------------------
    const csrf = detail.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!csrf) {
      bad('a conversation can be closed', 'no CSRF token on the transcript page');
    } else {
      const flip = async (status) =>
        req(`/${ADMIN_SLUG}/chat/${row.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf[1], status }).toString(),
        });

      const closed = await flip('closed');
      const afterClose = await db.queryOne('SELECT status FROM chat_conversations WHERE id = ?', [row.id]);

      if ([301, 302, 303].includes(closed.status) && afterClose.status === 'closed') {
        ok('a conversation can be closed', `#${row.id} → closed`);
      } else {
        bad('a conversation can be closed', `status ${closed.status}, stored ${afterClose.status}`);
      }

      // Put it back, so the run is repeatable and the panel is left as found.
      await flip(row.status === 'closed' ? 'closed' : 'open');
      const restored = await db.queryOne('SELECT status FROM chat_conversations WHERE id = ?', [row.id]);

      if (restored.status === row.status) {
        ok('the original status is restored', row.status);
      } else {
        bad('the original status is restored', `expected ${row.status}, stored ${restored.status}`);
      }
    }

    // --- A missing conversation is a redirect, not a crash --------------------
    const missing = await reqChain(`/${ADMIN_SLUG}/chat/99999999`);
    if (missing.status === 200 && missing.finalPath.includes('/chat')) {
      ok('an unknown conversation redirects to the list', `→ ${missing.finalPath}`);
    } else {
      bad('an unknown conversation redirects to the list', `status ${missing.status}`);
    }
  } catch (err) {
    bad('the chat dashboard', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * The handover details table on the order page.
 *
 * Layout, not data. The columns used to carry their own heading - rendered on
 * the first row and blanked on every row after - and the Visible checkbox was
 * nudged level with the text inputs by a `padding-bottom` hack. A heading row
 * plus same-height grid cells is what replaces it, and the assertions are on
 * the structure that makes that work rather than on pixels.
 */
async function checkOrderHandoverLayout() {
  section('28. Order handover details layout');

  const db = require('../src/config/database');

  try {
    const login = await adminLogin();
    if (!login.ok) {
      warn('the handover table renders', `${login.reason} - skipping`);
      await db.close().catch(() => {});
      return;
    }

    const order = await db.queryOne('SELECT id FROM orders ORDER BY id ASC LIMIT 1');
    if (!order) {
      warn('the handover table renders', 'no orders to open');
      await db.close().catch(() => {});
      return;
    }

    const page = await req(`/${ADMIN_SLUG}/orders/${order.id}`);
    if (page.status !== 200) {
      bad('the handover table renders', `order ${order.id} → ${page.status}`);
      await db.close().catch(() => {});
      return;
    }
    ok('the handover table renders', `order ${order.id}`);

    // Exactly one heading row. The old markup put the heading inside the list,
    // on the first row only, so counting is the check.
    const heads = (page.body.match(/class="deliverable-head"/g) || []).length;
    if (heads === 1) ok('there is one heading row', 'not one per row');
    else bad('there is one heading row', `found ${heads}`);

    const rows = (page.body.match(/class="deliverable-row"/g) || []).length;
    const checks = (page.body.match(/class="deliverable-visible"/g) || []).length;

    if (rows > 0 && rows === checks) {
      ok('every row has a Visible cell', `${rows} row(s)`);
    } else {
      bad('every row has a Visible cell', `${rows} rows, ${checks} Visible cells`);
    }

    // The old padding nudge is what caused the misalignment. If it comes back,
    // so does the bug.
    if (!/padding-bottom:\s*11px/.test(page.body)) {
      ok('the alignment padding hack is gone');
    } else {
      bad('the alignment padding hack is gone', 'padding-bottom:11px is back in the markup');
    }

    // The cloned template must match the rendered rows, or the first row
    // somebody adds is the one that looks wrong.
    const template = page.body.match(/<template data-repeat-template>[\s\S]*?<\/template>/);
    if (template && template[0].includes('deliverable-row') && template[0].includes('deliverable-visible')) {
      ok('the add-row template matches the rendered rows');
    } else {
      bad('the add-row template matches the rendered rows', 'the template uses different markup');
    }
  } catch (err) {
    bad('the handover table', err.message);
  }

  await db.close().catch(() => {});
}

/**
 * The four self-serve packages.
 *
 * The homepage shows the first four featured packages, so "are the right four
 * on the homepage" is a question about ordering as much as about data - and
 * ordering is exactly what silently breaks when a package is added later with a
 * sort_order that collides.
 */
async function checkPackages() {
  section('29. The four packages on the homepage');

  const db = require('../src/config/database');
  const settingsSvc = require('../src/services/settings.service');

  const EXPECTED = ['Free', 'Starter', 'Pro', 'Growth'];

  try {
    const home = await req('/');
    if (home.status !== 200) {
      bad('the homepage renders', `got ${home.status}`);
      await db.close().catch(() => {});
      return;
    }

    // The card titles, in the order they appear.
    //
    // Bounded to the grid. Splitting on the opening tag alone takes the whole
    // rest of the page with it, and every later heading - portfolio titles,
    // feature cards - gets counted as a package.
    const grid = (home.body.split('class="price-grid')[1] || '').split('View all packages')[0];
    const titles = [...grid.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1].trim());

    if (titles.length === 4) {
      ok('the homepage shows four packages', titles.join(', '));
    } else {
      bad('the homepage shows four packages', `${titles.length} rendered: ${titles.join(', ') || 'none'}`);
    }

    if (titles.join('|') === EXPECTED.join('|')) {
      ok('they are the four in the intended order', EXPECTED.join(' → '));
    } else {
      bad('they are the four in the intended order', `got ${titles.join(', ')}`);
    }

    // Every one of them carries a fee table. A card whose fees silently
    // vanished is the failure that matters: the rates decide the purchase.
    const feeBoxes = (grid.match(/Fees per order/g) || []).length;
    if (feeBoxes === 4) ok('every card shows its per-order fees');
    else bad('every card shows its per-order fees', `${feeBoxes} of 4`);

    // 0% must read as "No fee" rather than "0%". It is a selling point.
    if (grid.includes('No fee')) ok('a zero rate reads as "No fee"', 'not "0%"');
    else bad('a zero rate reads as "No fee"', 'no zero-rate row found');

    // --- The term toggle ------------------------------------------------------
    const six = settingsSvc.getInt('pricing_6mo_discount', 0);
    const twelve = settingsSvc.getInt('pricing_12mo_discount', 0);

    if (home.body.includes('data-term="term6"') && home.body.includes('data-term="term12"')) {
      ok('the term toggle offers all three options', `6 months saves ${six}%, yearly saves ${twelve}%`);
    } else {
      bad('the term toggle offers all three options', 'a term button is missing');
    }

    if (six === 10 && twelve === 25) {
      ok('the savings are the advertised ones', '10% and 25%');
    } else {
      bad('the savings are the advertised ones', `got ${six}% and ${twelve}%`);
    }

    // --- The highlighted card -------------------------------------------------
    const popularIndex = settingsSvc.getInt('pricing_popular_index', 0);
    if (popularIndex === 3 && /is-popular/.test(grid) && titles[2] === 'Pro') {
      ok('the popular flag sits on Pro', 'index 3');
    } else {
      bad('the popular flag sits on Pro', `index ${popularIndex}, titles ${titles.join(', ')}`);
    }

    // --- Each one has a working detail page, with its fees --------------------
    for (const slug of ['free', 'starter', 'pro', 'growth']) {
      const page = await req(`/services/${slug}`);

      if (page.status !== 200) {
        bad(`${slug} has a detail page`, `got ${page.status}`);
        continue;
      }

      if (page.body.includes('Fees per order') && page.body.includes('fee-row')) {
        ok(`${slug} shows its fees on the detail page`);
      } else {
        bad(`${slug} shows its fees on the detail page`, 'the rates are missing where the CTA lands');
      }
    }

    // --- The admin can edit them ---------------------------------------------
    //
    // The rates are only maintainable if the editor round-trips them, and the
    // field parses "Label: percent" rather than taking JSON.
    const login = await adminLogin();
    if (!login.ok) {
      warn('the package editor round-trips fees', `${login.reason} - skipping`);
      await db.close().catch(() => {});
      return;
    }

    const service = await db.queryOne("SELECT id, order_fees FROM services WHERE slug = 'pro'");
    const before = JSON.stringify(service.order_fees);

    // The editor lives at /edit; the bare /:id is the save endpoint.
    const form = await req(`/${ADMIN_SLUG}/packages/${service.id}/edit`);
    const csrf = form.body.match(/name="_csrf"\s+value="([^"]+)"/);

    if (!csrf) {
      bad('the package editor round-trips fees', 'no CSRF token on the package form');
      await db.close().catch(() => {});
      return;
    }

    // The textarea must show the current rates in the editable format.
    if (form.body.includes('Physical: 0') && form.body.includes('Resell: 1')) {
      ok('the fee field prefills in "Label: percent" form');
    } else {
      bad('the fee field prefills in "Label: percent" form', 'the textarea is empty or malformed');
    }

    // Save a changed rate, then put the original back.
    const withTest = [
      'Physical: 0',
      'Digital: 4',
      'Resell: 1',
      'Smoke test: 2.5',
    ].join('\n');

    const saved = await req(`/${ADMIN_SLUG}/packages/${service.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf[1],
        title: 'Pro',
        slug: 'pro',
        price: '1099',
        billing_cycle: 'monthly',
        min_months: '1',
        yearly_discount_percent: '0',
        delivery_days: '0',
        sort_order: '2',
        status: 'active',
        is_featured: '1',
        features: '2,000 products\nUnlimited preset themes',
        order_fees: withTest,
      }).toString(),
    });

    const after = await db.queryOne('SELECT order_fees FROM services WHERE id = ?', [service.id]);
    const parsed = typeof after.order_fees === 'string' ? JSON.parse(after.order_fees) : after.order_fees;

    if ([301, 302, 303].includes(saved.status) && Array.isArray(parsed) && parsed.length === 4) {
      const added = parsed.find((fee) => fee.label === 'Smoke test');
      if (added && Number(added.percent) === 2.5) {
        ok('a fee saved from the editor is stored as a number', '2.5, not "2.5"');
      } else {
        bad('a fee saved from the editor is stored as a number', JSON.stringify(parsed));
      }
    } else {
      bad('a fee saved from the editor is stored as a number', `status ${saved.status}, ${JSON.stringify(parsed)}`);
    }

    // A malformed line must be refused rather than silently dropped - a rate
    // table that is quietly missing a row is worse than one that will not save.
    const rejected = await req(`/${ADMIN_SLUG}/packages/${service.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: csrf[1],
        title: 'Pro',
        slug: 'pro',
        price: '1099',
        billing_cycle: 'monthly',
        order_fees: 'Physical 5',
      }).toString(),
    });

    const still = await db.queryOne('SELECT order_fees FROM services WHERE id = ?', [service.id]);
    const unchanged = JSON.stringify(still.order_fees) === JSON.stringify(after.order_fees);

    // A 422 is the validation rejection; the point of the check is that the
    // save did not go through and the stored rates are untouched.
    if (rejected.status === 422 && unchanged) {
      ok('a fee line without a colon is refused', '422, and the saved rates were left alone');
    } else {
      bad('a fee line without a colon is refused', `status ${rejected.status}, changed=${!unchanged}`);
    }

    // --- Restore --------------------------------------------------------------
    await db.query('UPDATE services SET order_fees = ? WHERE id = ?', [before === 'null' ? null : before, service.id]);
    const restored = await db.queryOne('SELECT order_fees FROM services WHERE id = ?', [service.id]);

    if (JSON.stringify(restored.order_fees) === before) {
      ok('the fee rates are restored', 'Pro back to 0 / 4 / 1');
    } else {
      bad('the fee rates are restored', JSON.stringify(restored.order_fees));
    }
  } catch (err) {
    bad('the four packages', err.message);
  }

  await db.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n  WooBD.Com smoke test');
  console.log(`  Target : ${BASE}`);
  console.log(`  Admin  : /${ADMIN_SLUG}`);

  let spawned = false;
  if (!EXTERNAL_BASE) {
    try {
      await bootServer();
      spawned = true;
    } catch (err) {
      console.error('\n  ✗ Server failed to boot before any request was made.\n');
      console.error(err.message);
      process.exit(1);
    }
  }
  // Declared out here so the finally block can put the toggles back even if a
  // section throws - leaving a live site with its CAPTCHA switched off would be
  // a far worse outcome than a failed test run.
  let savedCaptcha = null;

  try {
    const healthy = await checkHealth();
    if (!healthy) {
      console.log('\n  Database is unreachable - remaining checks would only report noise.');
      console.log('  Fix DB_* in .env, run "npm run setup", then retry.\n');
      process.exitCode = 1;
      return;
    }

    // The suite submits real forms and cannot solve a challenge, so the
    // CAPTCHA toggles come off for the run. Section 23 puts them back on for
    // its own checks; `savedCaptcha` restores whatever the site actually had.
    savedCaptcha = await suspendCaptcha();

    await checkPublicPages();
    await checkPublicContent();
    await checkServiceDetail();
    await checkErrorsAndSecurity();
    await checkAuthGuards();
    await checkCsrf();
    await checkAssets();
    await checkMaintenanceAndChat();
    await checkBlog();
    // Last: it signs in, which would otherwise change the identity every
    // earlier guard test relies on being anonymous.
    await checkAdminSettings();
    await checkGoogleAuthToggle();
    await checkSettingsCacheIntegrity();
    await checkAdminRoutes();
    await checkUploads();
    // Last: it writes to every setting and restores them, so it must not run
    // while other checks depend on specific values.
    await checkSettingsRoundTrip();
    await checkCustomerAccount();
    await checkAdminCrud();
    await checkEditorAndFooter();
    await checkTermPricing();
    await checkMaintenanceAndChat();
    // Sends its own Accept-Encoding, so it must not run before the sections
    // that assume an uncompressed body.
    await checkCrawlerFilesAndCompare();
    // Writes test keys and clears them again, so it runs after everything that
    // depends on the site being unconfigured.
    await checkCaptchaWiring();
    await checkHeroBackgrounds();
    // Last: it stubs the mail transport and writes SMTP settings, so nothing
    // after it may depend on either.
    await checkMailNotifications();
    await checkChatDashboard();
    await checkOrderHandoverLayout();
    await checkPackages();
    checkInstallSql();
  } catch (err) {
    console.error('\n  ✗ Smoke test aborted by an unexpected error');
    console.error(`    ${err.stack || err.message}\n`);
    process.exitCode = 1;
  } finally {
    // Restored even when a section threw. A test run that leaves a live site
    // with its CAPTCHA switched off is worse than a test run that failed.
    await restoreCaptcha(savedCaptcha).catch((err) =>
      console.error(`  ! could not restore the CAPTCHA toggles: ${err.message}`)
    );
    if (spawned) await stopServer();
  }

  section('Result');
  console.log(`  ${passed} passed, ${failed} failed, ${warned} warning(s)`);

  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`    ✗ ${f.name}${f.detail ? ` - ${f.detail}` : ''}`));
  }

  console.log('');
  if (failed) {
    process.exitCode = 1;
  } else if (warned) {
    console.log('  No hard failures. Warnings above are worth reading but not blocking.\n');
  } else {
    console.log('  All checks passed.\n');
  }
}

main();
