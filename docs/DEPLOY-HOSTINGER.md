# Deploying WooBD.Com to Hostinger Web Apps

A complete guide to getting this Node.js + MySQL app running on Hostinger's
Node.js hosting. Written from the failure modes that actually occur on this
platform — every warning below corresponds to a real breakage, not a
hypothetical one.

**Time required:** 20–30 minutes for a first deployment.

---

## At a glance

The whole deployment, in order. Each step is expanded below.

```bash
# 1. In hPanel: create a MySQL database, and note the name, user and password.

# 2. In hPanel: create a Node.js Web App from this repository.
#    Build command : npm install
#    Start command : npm start
#    Node version  : 20.x or 22.x

# 3. Add the environment variables (section 4). At minimum:
#      NODE_ENV=production
#      APP_URL=https://your-domain.com
#      SESSION_SECRET=<48 random bytes, see below>
#      DB_HOST=127.0.0.1  DB_NAME=…  DB_USER=…  DB_PASSWORD="…"
#      TRUST_PROXY=1
#      UPLOAD_DIR=/home/<user>/woobd-uploads

# 4. Open the app's terminal in hPanel and install the database:
SEED_PASSWORD='a-strong-password' npm run setup

# 5. Verify:
curl -s https://your-domain.com/healthz

# 6. Sign in at https://your-domain.com/<ADMIN_PATH>  (default: /dev-cp)
```

**The three that break most first deployments**, all covered below: `DB_HOST` must be
`127.0.0.1` and not `localhost`; a password containing `#` must be quoted in `.env`; and
`UPLOAD_DIR` must point outside the build directory or every redeploy deletes the
uploads.

`npm run build` runs a deploy-readiness check before you deploy — it verifies the start
script, the Node range, that `PORT` and `HOST` come from the environment, that
`UPLOAD_DIR` and `TRUST_PROXY` are wired up, and that no real credentials are sitting in
`.env.example`. Run it locally first.

### The build does not need devDependencies

`npm run build` also minifies the public CSS and JavaScript, and the two minifiers
(`clean-css`, `terser`) are devDependencies — which a production install does not
fetch. That is deliberate and it is safe:

- **The minified files are committed.** `public/assets/css/theme.min.css` and its three
  siblings are in the repository, so a deployment already has them.
- **A missing minifier is skipped, not fatal.** The script reports that it kept the
  committed build and exits 0, so the deploy carries on.
- **A stale build cannot be served anyway.** `helpers.versioned()` compares the minified
  file's mtime against its source and serves the source whenever the minified one is
  older — so forgetting to rebuild degrades to the unminified file, never to an
  out-of-date one.

If you would rather the build always regenerate them, install with devDependencies
(`npm install` without `NODE_ENV=production`, or `npm ci --include=dev`) and run
`npm run build:assets` before committing. Moving the two packages into `dependencies`
would also work, at the cost of shipping a few megabytes of build tooling that nothing
at runtime uses.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Create the MySQL database](#2-create-the-mysql-database)
3. [Create the Node.js application](#3-create-the-nodejs-application)
4. [Set environment variables](#4-set-environment-variables)
5. [Install the schema and seed data](#5-install-the-schema-and-seed-data)
6. [Verify the deployment](#6-verify-the-deployment)
7. [Sign in to the admin panel](#7-sign-in-to-the-admin-panel)
8. [Post-deploy checklist](#8-post-deploy-checklist)
9. [Redeploying](#9-redeploying)
10. [Troubleshooting](#10-troubleshooting)
11. [Persistent uploads](#11-persistent-uploads)

---

## 1. Before you start

You will need:

| Item | Where to get it |
| --- | --- |
| A Hostinger plan with **Node.js** support | hPanel → your plan |
| A domain pointed at Hostinger | hPanel → Domains |
| This repository pushed to GitHub | `git remote -v` should show your repo |
| 15 minutes and no interruptions | — |

Two decisions to make first:

- **The admin panel path.** Default is `dev-cp`, giving `https://woobd.com/dev-cp/login`.
  Changing it later is a settings edit; changing it *now* saves confusion.
- **Your production database password.** Hostinger generates one. You may want
  to replace it with your own — see the warning in step 2 if you do.

---

## 2. Create the MySQL database

1. In hPanel, open **Databases → MySQL Databases**.
2. Click **Create a new database**. Hostinger creates a prefixed name, e.g.
   `u123456_woobd`.
3. **Write down** the full database name, the database user (also prefixed,
   e.g. `u123456_woobduser`) and the password.
4. **Write down the host.** It will show as something like
   `localhost` or `srv1234.hstgr.io`.

> **⚠ Use `127.0.0.1`, not `localhost`.**
>
> This is the single most common failure on this platform. PHP connects to
> MySQL over a local socket, so `localhost` works fine from PHP. Node does not
> use sockets — it opens a TCP connection, and `localhost` resolves to the
> IPv6 loopback `::1`. The database user is granted on `127.0.0.1`, not `::1`,
> so you get:
>
> ```
> Access denied for user 'u123456_woobduser'@'::1'
> ```
>
> Always use `DB_HOST=127.0.0.1`. If your hPanel shows an `srv...hstgr.io`
> hostname instead, use that exact hostname instead of either localhost form.

> **⚠ If your password contains `#`, `@`, `/` or `:`, percent-encode it.**
>
> | Character | Encoded |
> | --- | --- |
> | `#` | `%23` |
> | `@` | `%40` |
> | `/` | `%2F` |
> | `:` | `%3A` |
>
> This applies in `.env` **and** in the hPanel environment-variable UI. An
> unquoted `#` is also the comment character in a `.env` file: a password like
> `CHANGE_ME` written bare as `DB_PASSWORD=CHANGE_ME` is silently truncated
> to `WooBD`, producing a confusing "Access denied" even though the password
> looks correct. Quote it (`DB_PASSWORD="CHANGE_ME"`) or percent-encode it.

---

## 3. Create the Node.js application

1. In hPanel, go to **Advanced → Node.js**.
2. Click **Create application**.
3. Fill in:

   | Field | Value |
   | --- | --- |
   | Node.js version | **18.x, 20.x or 22.x** (anything in `>=18 <=24`) |
   | Application root | the folder holding `package.json` |
   | Application URL | your domain |
   | Startup file | `server.js` |

4. Under **Source**, connect your Git repository if you want automatic
   deploys on push, or upload the files manually.

5. Set the **install command** to `npm install`. The `postinstall` script
   creates the uploads directory tree automatically — you do not need to do
   that by hand.

> **⚠ Do NOT set `PORT` in the environment variables.**
>
> Hostinger injects `PORT` itself and routes traffic to whatever port the
> process binds. If you hardcode `PORT=3000`, the platform's proxy will not be
> pointing at it, and you get a 502 Bad Gateway with no useful log line.
>
> The app reads `process.env.PORT` and falls back to 3000 only for local runs.
> Leave it unset in production.

> **⚠ The build directory is versioned and recreated on every deploy.**
>
> Hostinger re-points the application at a fresh directory each time you
> deploy. Anything written to disk inside the app directory is **lost**:
> uploaded images, generated files, a SQLite database. This is why:
>
> - sessions are stored in MySQL, not in memory or on disk
> - `UPLOAD_DIR` should point outside the versioned directory (see
>   [section 11](#11-persistent-uploads))

---

## 4. Set environment variables

In hPanel → **Node.js → Environment variables**, add each of the following.
Use the **exact** names — the app reads these directly.

### Required

```
NODE_ENV=production
APP_NAME=WooBD.Com
APP_URL=https://woobd.com
APP_BASE_PATH=/

# Generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
SESSION_SECRET=<paste a 96-character hex string here>
SESSION_NAME=woobd.sid

TRUST_PROXY=1
COOKIE_SECURE=true

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=u123456_woobd
DB_USER=u123456_woobduser
DB_PASSWORD=<your password, percent-encoded if it has special characters>
DB_CONNECTION_LIMIT=10
```

> **⚠ `SESSION_SECRET` must not be the placeholder.**
>
> The app **refuses to boot** in production if `SESSION_SECRET` is missing or
> still set to `CHANGE_ME_TO_A_LONG_RANDOM_STRING`. This is deliberate: a
> guessable session secret means anyone can forge a login cookie.
>
> Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

> **⚠ `COOKIE_SECURE=true` requires HTTPS.**
>
> Over plain HTTP the browser silently discards a `Secure` cookie. The symptom
> is maddening: **login succeeds, then every page redirects you back to the
> sign-in page**, with no error anywhere. Keep it `true` in production (you
> have HTTPS) and `false` only for local development over HTTP.

### Optional — SMTP (contact form, order emails, password resets)

If left blank, mail failures are logged and swallowed rather than crashing a
request. The contact form will still save the message to the database.

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=hello@woobd.com
SMTP_PASSWORD=<hostinger email password>
MAIL_FROM_NAME=WooBD.Com
MAIL_FROM_EMAIL=hello@woobd.com
```

### Optional — Google reCAPTCHA v2

Without keys, reCAPTCHA is disabled (the app fails open, so forms stay usable).
To enable it, create a **v2 checkbox** key at
<https://www.google.com/recaptcha/admin> and add your domain.

```
RECAPTCHA_SITE_KEY=<site key>
RECAPTCHA_SECRET_KEY=<secret key>
```

Then turn it on per form in the admin panel under **Settings → Google**, since
the brief requires it on customer sign-in, sign-up, admin login and contact.

### Optional — Google sign-in

Authorised redirect URI must be exactly:

```
https://woobd.com/auth/google/callback
```

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
```

### Live chat assistant

The brief supplies these; the key is also editable from the admin panel so you
can rotate it without a redeploy.

```
XKIRO_API_KEY=sk-xt-...
XKIRO_BASE_URL=https://api.xkiro.com/v1/chat/completions
XKIRO_MODEL=qwen/qwen3.8-omni-flash:free
```

After adding variables, click **Save** and then **Restart** the application.

---

## 5. Install the schema and seed data

There are two ways to do this. Pick one — **not both**, they do the same job.

| | Use when | What you get |
|---|---|---|
| **A. Import a SQL file** | You have phpMyAdmin but no terminal, or you want a known demo password | Schema + settings + demo content + staff accounts, in one import |
| **B. Run the installer** | You have terminal access to the app | The same, plus a **randomly generated** staff password that is never written to a file |

**B is the better choice when you can run it** — nothing sensitive ends up in a
file you might share. Use A when you cannot.

### A. Import `database/install.sql`

1. In hPanel, create the MySQL database (section 2). Leave it **empty**.
2. Open phpMyAdmin, select that database, go to **Import**, and upload
   `database/install.sql` from the repository.
3. Set `DB_NAME`, `DB_USER` and `DB_PASSWORD` in `.env` to match.

Then sign in with the credentials printed at the top of that file:

```
URL      https://your-domain.com/dev-cp/login
Username mdshojibmiya
Password WooBD-Demo-2026
```

> **⚠️ Change that password immediately.** It is published in this repository, so
> it is not a secret — anyone who reads the repo knows it. Two more staff accounts
> (`romenroy`, `mehedihasan`) share it and should be changed or deleted.

The file drops and recreates every table, so **never import it over a database
that already holds data**. It contains demo content only: customers use
`@example.com` addresses, and the header lists exactly which tables to empty if
you would rather start clean.

### B. Run the installer

You need a terminal inside the application environment. Use hPanel's
**Node.js → Run command** (or SSH if your plan includes it).

Run the installer:

```bash
npm run setup
```

This is **idempotent** — safe to run repeatedly. It will:

1. Apply `database/schema.sql` (27 tables, all `IF NOT EXISTS`)
2. Insert 144 default settings across 16 groups
3. Create the three staff accounts
4. Seed demo content: services, portfolio, testimonials, FAQs, clients, menus,
   and the privacy/terms/refund/about pages

Expected output ends with:

```
──────────────────────────────────────────────
Installation complete
──────────────────────────────────────────────
```

**The three staff accounts** (all with password `CHANGE_ME`):

| Username | Name | Role | Email |
| --- | --- | --- | --- |
| `mdshojibmiya` | Md Shojib Miya | admin | hello@woobd.com |
| `romenroy` | Romen Roy | manager | manager@woobd.com |
| `mehedihasan` | Md Mehedi Hasan | editor | editor@woobd.com |

> **⚠ Change these passwords immediately after your first sign-in.**
>
> They are published in this repository, so treat them as compromised the
> moment the site is public. Sign in, then use **Settings → Staff** or the
> admin profile page to set real passwords.
>
> To seed with a different password from the outset:
> ```bash
> SEED_PASSWORD='your-strong-password' npm run setup
> ```

### Useful installer flags

```bash
npm run setup -- --dry-run      # show the plan; writes nothing
npm run setup -- --no-demo      # schema + settings + staff, no demo content
npm run setup -- --schema       # schema only
npm run setup -- --settings     # schema + settings defaults
npm run setup -- --staff        # schema + settings + staff accounts
```

### Tearing down and rebuilding

```bash
npm run setup -- --reset              # lists what would be deleted, then stops
npm run setup -- --reset --yes        # actually drops the app tables
```

`--reset` drops **only the 27 tables this application owns** and then rebuilds
them. Without `--yes` it prints the row count of every table it would destroy
and exits without touching anything.

---

## 6. Verify the deployment

Run the smoke test — 47 assertions across the routes, auth guards, CSRF,
security headers, static assets and seeded content:

```bash
npm run smoke
```

A healthy run ends with:

```
  47 passed, 0 failed, 0 warning(s)

  All checks passed.
```

To check a specific deployment rather than a local one:

```bash
npm run smoke -- --base https://woobd.com
```

You can also hit the health endpoint directly:

```bash
curl https://woobd.com/healthz
# {"status":"ok","database":"up","uptime":42}
```

A `503` with `"database":"down"` means the app is running but cannot reach
MySQL — almost always the `DB_HOST=localhost` trap from step 2.

### What the smoke test actually checks

It is not "did the process start". Each assertion inspects a real HTTP status
and, where it matters, the response body:

- Every public page returns 200 and contains its seeded content
- An unknown service slug 404s rather than 500s
- Anonymous visitors are redirected away from `/account/*` and the admin panel
- `POST /contact` and `POST /api/chat` **without** a CSRF token are rejected (419)
- CSP, nosniff, X-Frame-Options and Referrer-Policy headers are present
- Static CSS/JS/images are served, and no third-party script CDN is used

If you change the admin slug, add `ADMIN_PATH=<your-slug>` to the environment so
the smoke test looks in the right place.

---

## 7. Sign in to the admin panel

```
https://woobd.com/dev-cp/login
```

Username `mdshojibmiya`, password `CHANGE_ME`.

Then **change the password immediately**.

The panel slug defaults to `dev-cp` and is configurable under
**Settings → Security → Admin panel path slug**. Changing it is a real
security measure: `dev-cp/login` cannot be found by anyone scanning for
`/admin` or `/wp-login.php`. The smoke test asserts that `/admin` returns 404.

---

## 8. Post-deploy checklist

Work through this once. Each item is something that is easy to forget and
annoying to discover later.

Everything below is changed from **Settings** in the admin panel —
`https://woobd.com/dev-cp/settings` — which is organised into 16 tabs.

- [ ] **Change all three staff passwords.** They are public in this repo.
- [ ] **Set `APP_URL`** to your real `https://` domain — it is used for
      canonical URLs, OG tags and the Google OAuth redirect.
- [ ] **Upload your logo** (light and dark versions) and a favicon under
      **Settings → Branding**. Until you do, the bundled placeholder SVGs are
      used — they render, but they are generic.
- [ ] **Fill in SMTP** (**Settings → SMTP & Email**) and send a test from the
      contact form.
- [ ] **Enable reCAPTCHA.** Add the keys under **Settings → Security & CAPTCHA**,
      then set the four per-form switches — customer sign-in, sign-up, admin
      login and contact. The switches do nothing without the keys, and the
      panel warns you when that is the case.
- [ ] **Enable Google sign-in** under **Settings → Google Auth**: paste the
      client ID and secret, then switch on the sign-in and sign-up buttons.
      The redirect URI must be exactly
      `https://woobd.com/auth/google/callback`.
- [ ] **Set payment methods** (**Settings → Payment Methods**), including the
      bKash / Nagad / Rocket wallet numbers customers transfer to.
- [ ] **Review the SEO defaults** (**Settings → SEO & Analytics**): meta title
      template, description, OG image.
- [ ] **Set the maintenance-mode message** (**Settings → Maintenance Mode**),
      even though it is off.
- [ ] **Confirm uploads survive a redeploy** — see section 11.
- [ ] **Check the site over HTTPS** and confirm there are no mixed-content
      warnings in the browser console.

> **Changing the admin path slug** (**Settings → Security & CAPTCHA**) moves the
> panel immediately. The save redirects you to the new address, but any
> bookmarks you have will stop working. Reserved words such as `admin`,
> `account`, `assets` and `api` are rejected.

---

## 9. Redeploying

Push to your connected branch, or click **Deploy** in hPanel.

**What survives a redeploy:**

| Item | Survives? | Why |
| --- | --- | --- |
| MySQL data (orders, customers, settings) | ✅ | Lives in the database |
| Sessions / logged-in users | ✅ | Stored in the `sessions` table |
| Uploaded files | ⚠️ | Only if `UPLOAD_DIR` is outside the build dir |
| `.env` file | ⚠️ | hPanel env vars survive; a committed `.env` may be replaced |
| Anything else on disk | ❌ | The build directory is recreated |

If you add a new setting to `src/config/settings-schema.js`, run
`npm run setup` again after deploying — `seedDefaults()` uses `INSERT IGNORE`,
so existing values are never overwritten and only the new keys are inserted.

---

## 10. Troubleshooting

### `Access denied for user '...'@'::1'`

`DB_HOST` is set to `localhost`. Change it to `127.0.0.1`. Node opens a TCP
connection and `localhost` resolves to IPv6 `::1`, which the DB user is not
granted. This is the #1 cause of a failed first deploy.

### `Access denied for user '...'@'127.0.0.1'` but the password is right

The password is being truncated or mis-parsed. An unquoted `#` in `.env` starts
a comment, and `@`, `/`, `:` are also unsafe unencoded. Percent-encode the
password (`#` → `%23`, `@` → `%40`) or wrap it in quotes.

### Every page returns 500 Internal Server Error

**This is almost always a database that was never installed.** Start here:

```bash
curl -s https://your-domain.com/healthz
```

The probe tells you which of the two it is:

```json
{"status":"degraded","database":"up","schema":"missing",
 "hint":"Database connected but not installed: settings, users, services, ... missing. Run \"npm run setup\" against this database."}
```

`database: "up"` with `schema: "missing"` means the credentials are correct and the
tables are absent. Fix it from the app's terminal in hPanel:

```bash
SEED_PASSWORD='a-strong-password' npm run setup
```

Then reload. No restart needed.

If instead you get `database: "down"`, the connection itself is failing - check
`DB_HOST` (must be `127.0.0.1`, not `localhost`), `DB_NAME`, `DB_USER` and
`DB_PASSWORD`. Quote the password if it contains `#`.

**Why this used to be so hard to diagnose.** The app boots and listens even when
the schema is missing, so the platform reports it as running. Every request then
fails on the first query. The boot log, the request log and `/healthz` now all
name the cause directly:

```
ERROR Database is connected but NOT INSTALLED - 7 of 7 core tables are missing
      (settings, users, services, customers, orders, menus, pages).
      Every page will return 500 until this is fixed. Run: npm run setup
```

If you are on an older revision and see a bare "Internal Server Error" with no
detail, that build also had a bug where the error page itself could not render.
Update to the current revision.

### 502 Bad Gateway, nothing useful in the logs

Either `PORT` is set in your environment variables (remove it), or the startup
file is wrong (must be `server.js`), or the app crashed on boot. Check
**Node.js → Logs** for a line starting `Failed to start the application.` —
the app fails fast with a specific reason.

### The app exits immediately with `[FATAL] SESSION_SECRET is missing or still set to the placeholder`

You are running with `NODE_ENV=production` and the session secret is missing or
still a known placeholder (`CHANGE_ME`, `secret`, `changeme`, or empty).
Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Sign-in appears to work, then every page redirects to sign-in

`COOKIE_SECURE=true` over plain HTTP. The browser accepted the login response
but silently dropped the cookie. Either enable HTTPS (you should) or set
`COOKIE_SECURE=false`.

### Every request hangs and eventually times out

Check that no middleware was mounted without being invoked. Every middleware in
`src/middleware` is a **factory** — it returns the actual handler, so it must be
called: `app.use(security.securityHeaders())`, not
`app.use(security.securityHeaders)`. Mounted bare, Express calls the factory as
a handler, which only *returns* a function and never calls `next()`. The request
then hangs. `npm run smoke` catches this.

### Uploaded images 404 after a redeploy

The build directory was recreated. Configure `UPLOAD_DIR` to a persistent path
outside the versioned directory — see section 11.

### `Cannot read properties of undefined (reading 'query')` at boot

The database pool was accessed before it was created. This was a real bug in
`src/config/database.js` and is fixed: all helpers route through `getPool()`,
which creates the pool on first use. If you see it, you are running an older
revision.

### I saved a setting in the admin panel but the site did not change

Check, in order:

1. **Did the save succeed?** A successful save shows a green confirmation banner
   and redirects back to the same tab. A red banner with field errors means
   nothing was written.
2. **Is the setting gated by another one?** The Google and CAPTCHA buttons need
   *both* their credentials and their per-form switch. The panel shows an amber
   warning when a toggle is on but the keys are missing.
3. **Is it a secret field?** Blank means "keep the stored value", so typing
   nothing and saving changes nothing. That is deliberate — it stops an
   unrelated save on the same tab from wiping a credential.
4. **Hard-refresh the page.** CSS variables and logo URLs are served with a long
   cache in production.

If none of those explain it, run `npm run smoke` — section 12 specifically
guards against the settings cache going empty after a save, which would make
every setting appear to revert to its default.

### Contact form submits but no email arrives

SMTP is not configured, or the credentials are wrong. With blank SMTP settings
the app logs the failure and still saves the message — check
**Admin → Contacts**, and check the logs for the SMTP error.

---

## 11. Persistent uploads

Hostinger's build directory is recreated on every deploy. Uploads written
inside it are lost. To make them survive:

1. Create a directory outside the app root, e.g. `/home/u123456/woobd-uploads`.
2. Set the environment variable:
   ```
   UPLOAD_DIR=/home/u123456/woobd-uploads
   ```
3. Ensure it is writable by the application user.

The app serves uploads from this path at `/uploads/*` and creates the ten
subfolders it needs on boot (`packages`, `portfolio`, `testimonials`, `clients`,
`logos`, `avatars`, `media`, `payments`, `tickets`, `posts`).

If you cannot use a path outside the app root on your plan, the alternative is
to commit uploaded files to the repository — workable for a logo or favicon,
not for a stream of customer payment screenshots.

---

## Reference — environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | ✅ | `development` | Must be `production` on the server |
| `APP_NAME` | — | `WooBD.Com` | Shown in titles and emails |
| `APP_URL` | ✅ | `http://localhost:3000` | No trailing slash; used for canonical URLs |
| `APP_BASE_PATH` | — | `/` | Change only if installed in a subfolder |
| `PORT` | ❌ | `3000` | **Do not set on Hostinger** |
| `HOST` | — | `0.0.0.0` | Leave as-is |
| `SESSION_SECRET` | ✅ | — | 96-char hex; boot fails on the placeholder |
| `SESSION_NAME` | — | `woobd.sid` | Cookie name |
| `SESSION_MAX_AGE` | — | 7 days (ms) | Cookie and store TTL |
| `COOKIE_SECURE` | ✅ | `true` in prod | Must be `false` over plain HTTP |
| `TRUST_PROXY` | ✅ | `true` in prod | Required behind Hostinger's TLS terminator |
| `DB_HOST` | ✅ | `127.0.0.1` | **Never `localhost`** |
| `DB_PORT` | — | `3306` | |
| `DB_NAME` | ✅ | `woobd` | Often prefixed, e.g. `u123456_woobd` |
| `DB_USER` | ✅ | `root` | Often prefixed |
| `DB_PASSWORD` | ✅ | — | Percent-encode special characters |
| `DB_CONNECTION_LIMIT` | — | `10` | Raise only if you see pool timeouts |
| `UPLOAD_DIR` | ⚠️ | `<root>/uploads` | Set outside the build dir to survive deploys |
| `UPLOAD_MAX_MB` | — | `5` | Per-file upload limit |
| `RECAPTCHA_SITE_KEY` | — | — | Blank disables reCAPTCHA |
| `RECAPTCHA_SECRET_KEY` | — | — | Blank disables reCAPTCHA |
| `GOOGLE_CLIENT_ID` | — | — | For customer Google sign-in |
| `GOOGLE_CLIENT_SECRET` | — | — | |
| `SMTP_HOST` | — | — | Blank = mail failures are logged, not fatal |
| `SMTP_PORT` | — | `465` | |
| `SMTP_SECURE` | — | `true` | |
| `SMTP_USER` | — | — | |
| `SMTP_PASSWORD` | — | — | |
| `MAIL_FROM_NAME` | — | `WooBD.Com` | |
| `MAIL_FROM_EMAIL` | — | `hello@woobd.com` | |
| `XKIRO_API_KEY` | — | — | Live chat assistant |
| `XKIRO_BASE_URL` | — | xkiro endpoint | |
| `XKIRO_MODEL` | — | `qwen/qwen3.8-omni-flash:free` | |
| `SEED_PASSWORD` | — | *generated* | `npm run setup` only. If unset, a random one is generated and printed once |
| `ADMIN_PATH` | — | `dev-cp` | Used by the smoke test only |
