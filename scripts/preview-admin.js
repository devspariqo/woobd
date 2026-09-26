#!/usr/bin/env node
/**
 * Build a self-contained HTML preview of the admin panel.
 *
 * Signs in, renders a set of real admin pages through the real app, inlines the
 * stylesheets and the icon sprite, and writes one file that opens straight from
 * disk with no server and no network.
 *
 *   node scripts/preview-admin.js
 *   node scripts/preview-admin.js --pages dashboard,packages,tickets
 *
 * Writes preview/admin-preview.html
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
const args = process.argv.slice(2);
const pagesFlag = args.indexOf('--pages');

/** Pages shown, in order. Each is { path, title, note }. */
const ALL_PAGES = [
  { path: `/dashboard`, title: 'Dashboard', note: 'Stat tiles, an attention queue and recent activity.' },
  { path: `/packages`, title: 'Packages (CMS list)', note: 'Generated from the resource registry — filters, search, sort and row actions.' },
  { path: `/packages/1/edit`, title: 'Package editor', note: 'The same form template renders every CMS resource, choosing a control per field type.' },
  { path: `/tickets`, title: 'Support tickets', note: 'KPI tiles plus status, priority and department filters.' },
  { path: `/contacts`, title: 'Contact messages', note: 'One card per enquiry, with the message body always visible.' },
  { path: `/staff`, title: 'Staff', note: 'Role and status controls, with the last-administrator guard.' },
  { path: `/reports`, title: 'Reports', note: 'Bar charts built from divs — no charting library, no CDN.' },
  { path: `/backup`, title: 'Backup & migration', note: 'Table inventory and a streamed SQL export.' },
  { path: `/activity`, title: 'Activity log', note: 'Grouped by day, with a tone dot per actor type.' },
  { path: `/menus`, title: 'Menus', note: 'The "Nested under" column shows which items open a dropdown.' },
  { path: `/media`, title: 'Media library', note: 'Grid view with copy-URL and delete per file.' },
  { path: `/pages/1/edit`, title: 'Page editor (rich text)', note: 'A first-party rich-text editor with a toolbar and a raw-HTML source mode.' },
  { path: `/settings?group=payments`, title: 'Settings — Payment Methods', note: 'Wallet numbers plus an uploadable logo for each method shown in the footer.' },
  { path: `/settings?group=chat`, title: 'Settings — Live Chat Assistant', note: 'A stored secret shows a masked preview so you can confirm it saved.' },
  { path: `/settings?group=google`, title: 'Settings — Google Auth', note: 'The On/Off toggles you asked for.' },
  { path: `/settings?group=security`, title: 'Settings — Security & CAPTCHA', note: 'Per-form CAPTCHA switches and the admin path slug.' },
  { path: `/settings?group=branding`, title: 'Settings — Branding & Logos', note: 'Logo and favicon uploads, each showing the file currently in use.' },
  { path: `/profile`, title: 'My profile', note: 'Profile photo upload and password change.' },
];

const selected = pagesFlag >= 0 && args[pagesFlag + 1]
  ? ALL_PAGES.filter((p) => args[pagesFlag + 1].split(',').some((k) => p.path.includes(k)))
  : ALL_PAGES;

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
    // NOTE: do not stub render() - Express supplies the real one.
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
  const loginForm = await req(`/${ADMIN_SLUG}/login`);
  const csrf = loginForm.body.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!csrf) {
    console.error('Could not find a CSRF token on the login page. Is the database running?');
    process.exit(1);
  }

  const login = await req(`/${ADMIN_SLUG}/login`, {
    method: 'POST',
    body: new URLSearchParams({
      _csrf: csrf[1],
      username: process.env.SMOKE_ADMIN_USER || 'mdshojibmiya',
      password: process.env.SMOKE_ADMIN_PASS || process.env.SEED_PASSWORD || '',
    }).toString(),
  });

  if (![301, 302, 303].includes(login.status)) {
    console.error(`Sign-in failed (status ${login.status}). Check SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS.`);
    process.exit(1);
  }

  const themeCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/theme.css'), 'utf8');
  const dashCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/dashboard.css'), 'utf8');
  const dashJs = fs.readFileSync(path.join(ROOT, 'public/assets/js/dashboard.js'), 'utf8');

  /** Pull the <main> content out of a rendered admin page. */
  const extractMain = (html) => {
    const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    return m ? m[1] : `<p style="color:#e02b2b">Could not find &lt;main&gt; in the rendered page.</p>`;
  };

  /** Pull the sidebar out of a rendered admin page. */
  const extractSidebar = (html) => {
    const m = html.match(/<aside class="dash-sidebar"[\s\S]*?<\/aside>/i);
    return m ? m[0] : '';
  };

  /**
   * The icon sprite is normally included per page; take one copy for the whole
   * preview. EJS comments and tags are stripped - this is the raw <svg> markup.
   */
  const sprite = (() => {
    const m = fs.readFileSync(path.join(ROOT, 'views/partials/icons.ejs'), 'utf8');
    return m.replace(/<%#[\s\S]*?%>/g, '').replace(/<%-[\s\S]*?%>/g, '');
  })();

  const sections = [];
  let sidebarMarkup = '';

  for (const page of selected) {
    const res = await req(`/${ADMIN_SLUG}${page.path}`);
    const ok = res.status === 200;

    // Capture the sidebar once, from the first page that renders it.
    if (!sidebarMarkup) sidebarMarkup = extractSidebar(res.body);

    sections.push(`
      <section class="preview-section">
        <h2>${page.title} <code>${ADMIN_SLUG}${page.path}</code>
          <span class="badge ${ok ? 'ok' : 'bad'}">${res.status}</span>
        </h2>
        <p class="hint">${page.note}</p>
        <div class="frame">${ok ? extractMain(res.body) : `<p style="color:#e02b2b">Returned ${res.status}.</p>`}</div>
      </section>`);
    console.log(`  ${ok ? '✓' : '✗'} ${page.path.padEnd(30)} ${res.status}`);
  }

  const page = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WooBD admin panel — preview</title>
<style>
${themeCss}
${dashCss}

/* Preview chrome. The real panel gets these from the layout's inline <style>. */
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
body { background: var(--bg-alt); margin: 0; padding: 26px 0 70px; font-family: var(--font-body); }
.preview-shell { max-width: 1180px; margin: 0 auto; padding: 0 22px; }
.preview-head {
  background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--primary);
  border-radius: var(--radius-sm); padding: 17px 20px; margin-bottom: 26px;
  font-size: .875rem; color: var(--text-muted); line-height: 1.7;
}
.preview-head strong { color: var(--text); }
.preview-head code { background: var(--bg-alt); padding: 1px 6px; border-radius: 5px; font-size: .8rem; }
.preview-section { margin-bottom: 40px; }
.preview-section h2 {
  font-size: 1.0625rem; margin: 0 0 3px; color: var(--text);
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
}
.preview-section h2 code {
  font-size: .72rem; font-weight: 500; color: var(--text-soft);
  background: var(--bg-alt); border: 1px solid var(--border);
  padding: 2px 7px; border-radius: 5px;
}
.badge { font-size: .68rem; font-weight: 700; padding: 2px 8px; border-radius: var(--radius-pill); }
.badge.ok { background: rgba(15,157,88,.13); color: var(--success); }
.badge.bad { background: rgba(224,43,43,.13); color: var(--danger); }
.preview-section p.hint { margin: 0 0 13px; font-size: .8125rem; color: var(--text-soft); }
.frame {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; box-shadow: var(--shadow-xs);
}
.frame .stat-grid { margin-bottom: 0; }

/* The sidebar is position:fixed in the panel. Un-fix it so it can be shown
   inline here, and constrain its height so the whole nav is visible. */
.preview-sidebar .dash-sidebar {
  position: static;
  width: 264px;
  height: auto;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.preview-sidebar .dash-sidebar-close { display: none; }
.preview-sidebar .dash-sidebar-backdrop { display: none; }
</style>
</head>
<body>
<div class="preview-shell">
  <div class="preview-head">
    <strong>Preview of the admin panel.</strong>
    ${selected.length} screens rendered from the running application, with the stylesheets and
    icon sprite inlined, so this file opens without a server.
    The panel itself lives at <code>/${ADMIN_SLUG}/login</code>.
    ${ALL_PAGES.length - selected.length > 0 ? `<br>${ALL_PAGES.length - selected.length} further screens are omitted from this file — run <code>npm run preview:admin</code> to render all ${ALL_PAGES.length}.` : ''}
  </div>

  ${sidebarMarkup ? `
  <section class="preview-section">
    <h2>The navigation sidebar</h2>
    <p class="hint">Every link here resolves — including the View website and Settings buttons in the footer.</p>
    <div class="frame preview-sidebar">${sidebarMarkup}</div>
  </section>` : ''}

  ${sections.join('\n')}
</div>
${sprite}
<script>
${dashJs}
</script>
</body>
</html>`;

  const outDir = path.join(ROOT, 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'admin-preview.html');
  fs.writeFileSync(outFile, page);

  console.log(`\n  Preview written: ${outFile}`);
  console.log(`  Size: ${(Buffer.byteLength(page) / 1024).toFixed(1)}kb\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\n  Preview failed:', err.message, '\n');
  process.exit(1);
});
