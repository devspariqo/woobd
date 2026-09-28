#!/usr/bin/env node
/**
 * Why is the reCAPTCHA not showing?
 *
 *   node scripts/check-captcha.js
 *   node scripts/check-captcha.js http://localhost:3210/signin
 *
 * This exists because the most common reCAPTCHA failure is invisible from the
 * outside. Google refuses to draw the widget on a hostname that is not
 * registered against the site key, and it says so INSIDE the widget's own
 * iframe - which is cross-origin, so the page cannot read it. Meanwhile:
 *
 *   - the page HTML looks correct (the .g-recaptcha div is there)
 *   - the script tag is there
 *   - the browser console is completely clean
 *   - the server-side key test passes, because the secret really is valid
 *
 * Every signal says the integration is fine and the box simply is not there.
 * The only way to see it is to load the page in a real browser and look at what
 * the widget actually rendered, which is what this does.
 *
 * Checks, in order: the saved keys, the secret against Google, whether the
 * widget element renders, whether Google's script loads, whether the widget
 * actually drew a box, and whether anything landed in the console.
 *
 * Exits 1 when something is wrong, so it can gate a deploy.
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const DEBUG_PORT = 9451;
const TARGET = process.argv[2] || 'http://localhost:3000/signin';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let problems = 0;
const ok = (msg, detail) => console.log(`  ok    ${msg}${detail ? '  ' + detail : ''}`);
const bad = (msg, detail) => {
  problems += 1;
  console.log(`  FAIL  ${msg}${detail ? '  ' + detail : ''}`);
};
const info = (msg) => console.log(`        ${msg}`);

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (err) {
      return false;
    }
  });
}

async function cdp(pathname, method) {
  const res = await fetch('http://127.0.0.1:' + DEBUG_PORT + pathname, { method: method || 'GET' });
  return res.json();
}

async function main() {
  console.log('\n  reCAPTCHA check');
  console.log(`  Target : ${TARGET}\n`);

  // --- 1. The saved configuration -----------------------------------------
  const db = require('../src/config/database');
  const settings = require('../src/services/settings.service');

  await settings.loadAll(true);

  const siteKey = settings.secret('captcha_site_key', process.env.RECAPTCHA_SITE_KEY);
  const secretKey = settings.secret('captcha_secret_key', process.env.RECAPTCHA_SECRET_KEY);
  const version = settings.get('captcha_version') === 'v3' ? 'v3' : 'v2';
  const mode = settings.get('captcha_mode') === 'checkbox' ? 'checkbox' : 'invisible';

  if (siteKey) ok('a site key is saved', `${siteKey.slice(0, 12)}...`);
  else bad('a site key is saved', 'nothing to render with');

  if (secretKey) ok('a secret key is saved', `length ${secretKey.length}`);
  else bad('a secret key is saved', 'Google cannot be asked to verify anything');

  info(`version ${version}, mode ${mode}`);

  const switches = [
    ['captcha_on_login', 'customer sign-in'],
    ['captcha_on_signup', 'customer sign-up'],
    ['captcha_on_admin', 'admin login'],
    ['captcha_on_contact', 'contact and quote forms'],
  ];

  const on = switches.filter(([key]) => settings.getBool(key));
  if (on.length) ok('the CAPTCHA is switched on', on.map(([, label]) => label).join(', '));
  else bad('the CAPTCHA is switched on', 'every switch is off, so no form will ask for it');

  // --- 2. The secret, against Google ---------------------------------------
  if (secretKey) {
    try {
      const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: secretKey, response: 'check-captcha-dummy' }).toString(),
      });
      const data = await res.json();
      const codes = data['error-codes'] || [];

      if (codes.includes('invalid-input-secret')) {
        bad('Google accepts the secret key', 'the secret was rejected outright');
      } else if (codes.includes('invalid-input-response')) {
        ok('Google accepts the secret key', 'only the dummy token was rejected, as expected');
      } else {
        bad('Google accepts the secret key', JSON.stringify(data));
      }
    } catch (err) {
      bad('Google accepts the secret key', `could not reach Google: ${err.message}`);
    }
  }

  // --- 3. What the browser actually renders --------------------------------
  const chrome = findChrome();
  if (!chrome) {
    console.log('\n  No Chrome or Edge found - skipping the browser half.\n');
    info('Set CHROME_CANDIDATES in this script if yours lives somewhere unusual.');
    await db.close().catch(() => {});
    process.exit(problems ? 1 : 0);
  }

  const proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--window-size=1200,1100',
    'about:blank',
  ]);

  let versionInfo = null;
  for (let i = 0; i < 40 && !versionInfo; i += 1) {
    try {
      versionInfo = await cdp('/json/version');
    } catch (err) {
      await sleep(250);
    }
  }
  if (!versionInfo) {
    bad('the browser started', 'its debugging port never opened');
    await db.close().catch(() => {});
    process.exit(1);
  }

  const target = await cdp('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const waiting = new Map();
  const consoleErrors = [];
  const googleRequests = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push((msg.params.exceptionDetails.exception || {}).description || 'exception');
    }
    if (msg.method === 'Network.responseReceived' && /recaptcha/.test(msg.params.response.url)) {
      googleRequests.push(msg.params.response.status + ' ' + msg.params.response.url.slice(0, 70));
    }
    if (msg.method === 'Network.loadingFailed' && /recaptcha/.test(msg.params.errorText + '')) {
      googleRequests.push('FAILED ' + msg.params.errorText);
    }
  });

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: TARGET });
  await sleep(9000);

  const probe = `(() => {
    const el = document.querySelector('.g-recaptcha');
    const r = el ? el.getBoundingClientRect() : null;
    return JSON.stringify({
      apiLoaded: typeof window.grecaptcha,
      siteKeyOnElement: el ? el.getAttribute('data-sitekey') : null,
      widgetDrew: el ? el.children.length > 0 : false,
      widgetSize: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null,
      v3Field: Boolean(document.querySelector('input[data-recaptcha-v3]')),
    });
  })()`;

  const result = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
  const raw = result.result && result.result.result && result.result.result.value;
  const state = raw ? JSON.parse(raw) : null;

  console.log('');

  if (!state) {
    bad('the page could be measured', 'no result from the browser');
  } else if (version === 'v3') {
    // v3 has no widget by design. The hidden field is the whole integration.
    if (state.v3Field) ok('the v3 token field is on the form', 'no widget, as designed');
    else bad('the v3 token field is on the form', 'the form has nowhere to put a token');
  } else {
    if (state.apiLoaded === 'object') ok("Google's script loaded");
    else bad("Google's script loaded", 'window.grecaptcha is undefined');

    if (state.siteKeyOnElement) ok('the widget element carries a site key', state.siteKeyOnElement.slice(0, 12) + '...');
    else bad('the widget element carries a site key', 'no .g-recaptcha element on the page');

    if (state.widgetDrew) {
      ok('Google drew the widget', state.widgetSize || '');

      // The box being drawn is not the same as the key being usable. A key with
      // no matching domain still draws, and puts the error inside its iframe
      // where this cannot read it - so say what to look at.
      info('');
      info('Look at the box in a real browser. If it reads "not in the list of');
      info('supported domains", the key is fine and the domain is missing -');
      info('add it at https://www.google.com/recaptcha/admin under Settings.');
    } else {
      bad('Google drew the widget', 'the element is empty - the key or the domain is the problem');
    }
  }

  if (googleRequests.length) ok('Google was reached', googleRequests[0]);
  else bad('Google was reached', 'no requests to google.com - a network or blocker problem');

  if (!consoleErrors.length) ok('the browser console is clean');
  else bad('the browser console is clean', consoleErrors.slice(0, 2).join(' | '));

  ws.close();
  proc.kill();
  await db.close().catch(() => {});

  console.log(problems ? `\n  ${problems} problem(s).\n` : '\n  All checks passed.\n');
  process.exit(problems ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err.message);
  process.exit(1);
});
