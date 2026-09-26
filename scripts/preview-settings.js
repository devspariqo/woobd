#!/usr/bin/env node
/**
 * Build a self-contained HTML preview of the admin Settings screen.
 *
 * Renders the real pages through the real app, then inlines the stylesheets and
 * strips the panel chrome so the result opens straight from disk with no server
 * and no network. Useful for reviewing a UI change without deploying it.
 *
 *   node scripts/preview-settings.js
 *
 * Writes preview/settings-preview.html
 */
'use strict';

process.env.NO_LISTEN = '1';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..');
const app = require(path.join(ROOT, 'server.js'));

const ADMIN_SLUG = process.env.ADMIN_PATH || 'dev-cp';
const jar = new Map();

async function req(pathname, { method = 'GET', body, cookies = true } = {}) {
  const headers = { host: '127.0.0.1:4599' };
  if (cookies && jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['content-length'] = String(Buffer.byteLength(body));
  }

  const reqObj = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(reqObj, {
    method,
    url: pathname,
    originalUrl: pathname,
    path: pathname.split('?')[0],
    headers,
    httpVersion: '1.1',
    complete: true,
    secure: false,
    socket: { remoteAddress: '127.0.0.1', remotePort: 1, encrypted: false },
  });
  reqObj.connection = reqObj.socket;
  reqObj.ip = '127.0.0.1';
  reqObj.ips = [];
  reqObj.subdomains = [];
  reqObj.hostname = '127.0.0.1';
  reqObj.protocol = 'http';

  const chunks = [];
  const bag = {};
  let settle;
  let done = false;
  const p = new Promise((r) => { settle = r; });

  const res = {
    statusCode: 200,
    locals: {},
    finished: false,
    setHeader(k, v) { bag[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return bag[String(k).toLowerCase()]; },
    getHeaders() { return { ...bag }; },
    hasHeader(k) { return k.toLowerCase() in bag; },
    writeHead(s, h) { this.statusCode = s; Object.assign(bag, h || {}); return this; },
    write(c) { if (c) chunks.push(Buffer.from(String(c))); return true; },
    end(c) {
      if (c && typeof c !== 'function') chunks.push(Buffer.from(String(c)));
      this.finished = true;
      if (!done) {
        done = true;
        const sc = bag['set-cookie'];
        (Array.isArray(sc) ? sc : sc ? [sc] : []).forEach((raw) => {
          const pair = String(raw).split(';')[0];
          const i = pair.indexOf('=');
          if (i > 0) {
            const n = pair.slice(0, i).trim();
            const v = pair.slice(i + 1).trim();
            if (v) jar.set(n, v);
          }
        });
        setImmediate(() => settle({
          status: res.statusCode,
          location: bag.location,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }
      return this;
    },
    json(o) { this.setHeader('content-type', 'application/json'); return this.end(JSON.stringify(o)); },
    send(v) { return this.end(v === undefined ? '' : String(v)); },
    redirect(s, u) {
      const [c, url] = typeof s === 'number' ? [s, u] : [302, s];
      this.statusCode = c;
      this.setHeader('location', url);
      return this.end('');
    },
    // NOTE: do not stub render(). Express supplies the real res.render; a stub
    // here would shadow it and every page would come back as a placeholder
    // string instead of rendered HTML.
    on() { return this; },
    once() { return this; },
    emit() { return true; },
    removeListener() { return this; },
    set() { return this; },
    type() { return this; },
    get() { return undefined; },
  };

  app(reqObj, res);
  return p;
}

(async () => {
  // Sign in.
  const loginForm = await req(`/${ADMIN_SLUG}/login`);
  const csrfMatch = loginForm.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    console.error('\n  Could not find a CSRF token on the login page.');
    console.error(`  status: ${loginForm.status}`);
    console.error(`  body  : ${loginForm.body.replace(/\s+/g, ' ').slice(0, 500)}\n`);
    process.exit(1);
  }
  const csrf = csrfMatch[1];
  await req(`/${ADMIN_SLUG}/login`, {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: csrf,
      username: process.env.SMOKE_ADMIN_USER || 'mdshojibmiya',
      password: process.env.SMOKE_ADMIN_PASS || process.env.SEED_PASSWORD || '',
    }).toString(),
  });

  const google = await req(`/${ADMIN_SLUG}/settings?group=google`);
  const security = await req(`/${ADMIN_SLUG}/settings?group=security`);

  const themeCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/theme.css'), 'utf8');
  const dashCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/dashboard.css'), 'utf8');

  /** Pull the <main> content out of a rendered admin page. */
  function extractMain(html) {
    const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    return m ? m[1] : html;
  }

  /** Drop the flash banner so the preview is not polluted by session state. */
  function stripFlash(html) {
    return html.replace(/<div class="alert alert-(?:success|error|info)"[\s\S]*?<\/div>\s*<\/div>/gi, '');
  }

  const page = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WooBD Admin — Google Auth &amp; CAPTCHA settings</title>
<style>
${themeCss}
${dashCss}

/* Preview-only: the real panel gets these from the layout's inline <style>. */
:root {
  --primary: #5b21f0; --primary-dark: #4316c4; --secondary: #ff6600;
  --success: #0f9d58; --danger: #e02b2b; --warning: #f0a020;
  --bg: #ffffff; --bg-alt: #f5f6fb; --surface: #ffffff;
  --text: #101223; --text-muted: #5a5f7a; --text-soft: #8a90ad;
  --border: #e6e8f0; --border-strong: #c9cde0;
  --radius: 12px; --radius-sm: 9px; --radius-pill: 999px;
  --shadow-xs: 0 1px 2px rgba(16,18,35,.06);
  --shadow-sm: 0 2px 8px rgba(16,18,35,.07);
  --shadow: 0 8px 28px rgba(16,18,35,.09);
  --t-fast: 140ms; --t: 220ms; --ease: cubic-bezier(.4,0,.2,1);
  --font-body: 'Inter', system-ui, sans-serif;
  --font-heading: 'Inter', system-ui, sans-serif;
}
body { background: var(--bg-alt); margin: 0; padding: 26px 0 60px; font-family: var(--font-body); }
.preview-shell { max-width: 1000px; margin: 0 auto; padding: 0 22px; }
.preview-note {
  background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--primary);
  border-radius: var(--radius-sm); padding: 15px 18px; margin-bottom: 22px;
  font-size: .875rem; color: var(--text-muted); line-height: 1.65;
}
.preview-note strong { color: var(--text); }
.preview-note code { background: var(--bg-alt); padding: 1px 6px; border-radius: 5px; font-size: .8rem; }
.preview-section { margin-bottom: 34px; }
.preview-section > h2 {
  font-size: 1.0625rem; margin: 0 0 4px; color: var(--text);
}
.preview-section > p.hint { margin: 0 0 14px; font-size: .8125rem; color: var(--text-soft); }
</style>
</head>
<body>
<div class="preview-shell">
  <div class="preview-note">
    <strong>Preview of the new admin Settings screen.</strong>
    Rendered from the running application with the stylesheets inlined, so it opens
    without a server. The two panels below are the pages you asked for —
    <code>Settings → Google Auth</code> and <code>Settings → Security &amp; CAPTCHA</code>.
    Toggles are live: click them to see the On/Off state change.
  </div>

  <div class="preview-section">
    <h2>Settings → Google Auth</h2>
    <p class="hint">Controls the customer Google sign-in buttons on the public sign-in and sign-up pages.</p>
    ${stripFlash(extractMain(google.body))}
  </div>

  <div class="preview-section">
    <h2>Settings → Security &amp; CAPTCHA</h2>
    <p class="hint">Per-form reCAPTCHA switches, the reCAPTCHA keys, and the admin panel path slug.</p>
    ${stripFlash(extractMain(security.body))}
  </div>
</div>
<script>
${fs.readFileSync(path.join(ROOT, 'public/assets/js/dashboard.js'), 'utf8')}
</script>
</body>
</html>`;

  const outDir = path.join(ROOT, 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'settings-preview.html');
  fs.writeFileSync(outFile, page);

  console.log(`\n  Preview written: ${outFile}`);
  console.log(`  Size: ${(Buffer.byteLength(page) / 1024).toFixed(1)}kb`);
  console.log(`  Google panel: ${google.status}, Security panel: ${security.status}\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\n  Preview failed:', err.message, '\n');
  process.exit(1);
});
