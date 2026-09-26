# WooBD.Com

A full-stack agency platform for **WooBD.Com**, a Bangladesh-based e-commerce
website design service. Customers browse packages, order, pay by manual wallet
transfer or card, and receive their website credentials in a dashboard. Staff
run the whole business — orders, packages, payments, support, CMS — from an
admin panel mounted at a configurable secret path.

**Stack:** Node.js 18–24 · Express 4 · EJS · MySQL 8 / MariaDB 10.4+
**No build step. No CDN. No ORM.**

---

## Quick start

```bash
# 1. Install dependencies (also creates the uploads tree)
npm install

# 2. Configure the environment
cp .env.example .env
#    Then edit .env — at minimum set DB_* and SESSION_SECRET.

# 3. Create the database and a user (MySQL)
mysql -u root -p -e "
  CREATE DATABASE woobd CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'woobd'@'127.0.0.1' IDENTIFIED BY 'your-password';
  GRANT ALL PRIVILEGES ON woobd.* TO 'woobd'@'127.0.0.1';
  FLUSH PRIVILEGES;"

# 4. Create tables, settings, staff accounts and demo content
npm run setup

# 5. Verify everything actually works
npm run smoke

# 6. Run it
npm start          # http://localhost:3000
```

Then sign in at **http://localhost:3000/dev-cp/login** with `mdshojibmiya` /
`CHANGE_ME`.

> **Change those passwords before the site is public.** They are published in
> this repository.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file change |
| `npm run setup` | Install schema, settings, staff accounts and demo content (idempotent) |
| `npm run smoke` | 69 end-to-end assertions against a real database |
| `npm run build` | Static check: module resolution, template compilation, layout references |
| `npm run preview` | Render the admin Settings screen to a self-contained HTML file |

### Installer flags

```bash
npm run setup -- --dry-run      # print the plan; writes nothing
npm run setup -- --schema       # schema only
npm run setup -- --settings     # schema + settings defaults
npm run setup -- --staff        # schema + settings + staff accounts
npm run setup -- --no-demo      # everything except demo content
npm run setup -- --force-demo   # clear demo tables, then reseed
npm run setup -- --reset        # list what would be deleted, then stop
npm run setup -- --reset --yes  # drop and rebuild all app tables
npm run setup -- --docker       # wait for MySQL, then install
```

`--reset` drops only the 27 tables this application owns. Without `--yes` it
prints the row count of every table it would destroy and exits without
touching anything.

To seed with a password other than the published default:

```bash
SEED_PASSWORD='a-strong-password' npm run setup
```

---

## Seeded accounts

All three start with password `CHANGE_ME`.

| Username | Name | Role | Email |
| --- | --- | --- | --- |
| `mdshojibmiya` | Md Shojib Miya | admin | hello@woobd.com |
| `romenroy` | Romen Roy | manager | manager@woobd.com |
| `mehedihasan` | Md Mehedi Hasan | editor | editor@woobd.com |

**Roles** are ranked, and the panel enforces the ranking:

| Role | Rank | Can do |
| --- | --- | --- |
| `editor` | 1 | Content: packages, portfolio, FAQs, pages, media |
| `manager` | 2 | Everything above, plus orders, customers, payments, analytics |
| `admin` | 3 | Everything, including staff, settings, backup and destructive actions |

---

## What is seeded

Running `npm run setup` gives you a site that looks finished rather than empty:

- **12 service packages** across 4 categories, with real BDT pricing
- **6 portfolio case studies** with technologies and completion dates
- **6 testimonials**, **10 FAQs**, **8 client logos** for the trust bar
- **4 content pages**: privacy policy, terms, refund policy, about
- **27 menu items** across header, mobile, and three footer columns
- **144 settings** across 16 groups

Content is real prose, not lorem ipsum — the legal pages are specific to
Bangladeshi e-commerce, and the FAQs answer questions a buyer actually asks.

---

## Project structure

```
server.js                  Entry point. Middleware order is deliberate — read the comments.
database/schema.sql        27 tables, all IF NOT EXISTS, utf8mb4.
scripts/
  setup.js                 Installer and seeder.
  smoke.js                 End-to-end test suite.
  build-check.js           Static verification; runs on every deploy.
  postinstall.js           Creates the uploads tree.
src/
  config/
    index.js               Typed environment config. Fails fast on a bad secret.
    database.js            mysql2 pool. Lazy creation via getPool().
    settings-schema.js     Declarative registry — 144 settings, 16 groups.
  middleware/
    context.js             Assembles view locals (site, theme, menus, SEO…).
    auth.js                Identity loading and role guards.
    csrf.js                Timing-safe CSRF tokens.
    security.js            Headers, maintenance mode, rate limits, error handlers.
    captcha.js             reCAPTCHA verification + honeypot.
  services/                Settings, activity log, chat, mail.
  models/                  Explicit SQL. No ORM, so no generate step on deploy.
  controllers/             Public, auth, customer, admin.
  routes/                  One router per audience.
  lib/storage.js           MySQL session store + multer upload handling.
views/
  layouts/                 public · dashboard · auth · admin · admin-auth · print
  partials/                header, footer, sidebar, flash, chat widget, icons
  public/ admin/ customer/ auth/ errors/
public/assets/             CSS, JS, SVG. All first-party.
uploads/                   User uploads. Point UPLOAD_DIR elsewhere in production.
docs/DEPLOY-HOSTINGER.md   Deployment guide.
```

---

## How it is put together

**Every middleware is a factory.** `src/middleware/*` exports functions that
*return* the handler, so they must be invoked:

```js
app.use(security.securityHeaders());   // correct
app.use(security.securityHeaders);     // hangs every request
```

Mounted bare, Express calls the factory as if it were the handler — it returns
a new function and never calls `next()`, so the request hangs until the client
times out. This is the single easiest mistake to make in this codebase, and
`npm run smoke` exists partly to catch it.

**Settings are declarative.** One array in `src/config/settings-schema.js`
generates the admin UI, the database defaults, the type casting and the public
accessor. Adding a setting is one edit, not four. The admin screen at
**Settings** (`/{slug}/settings`) renders all 16 groups as tabs, choosing a
control per declared `type` — booleans become On/Off switches, selects become
dropdowns, hex colours get a picker. Values are cached in memory with a TTL.

> **The cache must be reloaded before it is read.** `settings.get()` and
> `publicValues()` fall back to each setting's **default** when the cache is
> empty, and every save empties it. `viewContext()` therefore calls
> `loadAll()` before `publicValues()`, and `saveMany()` repopulates the cache
> immediately after writing. Without both, the first request after any save
> would render the whole site from factory defaults — the saved value appears
> not to apply, and every other customisation is lost with it until restart.
> `npm run smoke` guards this.

**Secrets never reach the browser.** The settings screen shows whether a secret
is stored, never its value. Leaving a secret field blank keeps the stored value,
so saving an unrelated field on the same tab cannot silently erase a
credential. The screen is `admin`-only, since it holds the Google client
secret, the reCAPTCHA secret, the SMTP password and the admin path slug.

**Sessions live in MySQL.** Hostinger recreates the build directory on every
deploy, so anything on disk is lost. A `MySQLSessionStore` means a redeploy does
not sign everybody out.

**No ORM.** Queries are explicit SQL against a `mysql2` pool. This avoids a
generate step in the deploy pipeline and keeps the query visible next to the
code that runs it.

**No CDN.** Every stylesheet, script and image is served from this origin.
Google Fonts is the only permitted external request. Charts are hand-built CSS
bars rather than a charting library.

**The handover is the product.** When a staff member activates an order they
fill in the customer's credentials — cPanel URL, site URL, admin user, password,
database name — as *deliverables*. Each has a visibility toggle: visible
deliverables appear in the customer's dashboard, hidden ones stay internal.
That toggle is the only thing separating a customer-visible credential from an
internal note.

---

## Security

| Concern | How it is handled |
| --- | --- |
| Passwords | bcrypt, cost 12. Uniform error message; a dummy compare runs on unknown users so response time does not leak account existence. |
| Brute force | `express-rate-limit` on auth routes, plus per-account lockout after repeated failures. |
| Sessions | MySQL-backed, `httpOnly`, `sameSite=lax`, rolling. `Secure` in production. |
| CSRF | Timing-safe token comparison on every state-changing request. |
| Captcha | Google reCAPTCHA v2, toggleable per form (customer login, signup, admin login, contact). Fails open when unconfigured so the site stays usable. |
| Headers | Hand-written CSP that permits the inline theme bootstrap, plus nosniff, X-Frame-Options, Referrer-Policy and Permissions-Policy. |
| Uploads | Extension and MIME allow-lists per folder, randomised filenames, size cap. Served from a path that refuses traversal. |
| Admin panel | Mounted at a configurable slug (default `dev-cp`), so `/admin` and `/wp-login.php` return 404. |
| SQL | Parameterised queries throughout. Identifiers that must be interpolated are escaped. |

---

## Testing

```bash
npm run build      # static: 30 modules resolve, 61 templates compile, 6 layouts
npm run smoke      # runtime: 69 assertions against a real database
npm run smoke -- --base https://woobd.com   # test a deployment
```

The smoke suite is not a "did the process start" check. It asserts on real HTTP
statuses and response bodies:

1. **Boot and health** — `/healthz` returns the documented JSON shape
2. **Public pages** — 11 routes return 200 and render
3. **Seeded content** — packages, testimonials, FAQs and client names actually
   reach the page, proving the templates read from the database
4. **Dynamic routes** — a real service slug renders; an impossible one 404s
5. **Errors and headers** — unknown URLs 404; CSP and friends are present
6. **Auth guards** — anonymous visitors are redirected away from `/account/*`
   and the admin panel; `/admin` is not the panel path
7. **CSRF** — POSTs without a token are rejected
8. **Static assets** — CSS, JS, images and the uploads mount; no third-party
   script is loaded; path traversal is refused
9. **Feature toggles** — the chat endpoint is guarded
10. **Admin settings** — sign in, render the Google Auth and Security tabs,
    confirm every toggle is present, confirm no secret is leaked into the HTML,
    and confirm a save persists to the database
11. **Google Auth toggle** — write a client ID, flip `google_auth_on_login`, and
    check whether the button actually appears on the public `/signin` page
12. **Settings cache integrity** — save a setting, then load a public page on the
    next request and confirm it reflects the new value rather than reverting to
    defaults

Sections 10–12 sign in as the seeded admin. Set `SMOKE_ADMIN_USER` and
`SMOKE_ADMIN_PASS` to test with a different account.

---

## Deployment

See **[docs/DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md)**.

Three things cause almost every failed first deploy on Hostinger, all covered
in that guide:

1. `DB_HOST=localhost` — Node connects over TCP, and `localhost` resolves to
   IPv6 `::1`, which the database user is not granted. **Use `127.0.0.1`.**
2. `PORT` set in the environment — the host injects its own. Leave it unset.
3. `COOKIE_SECURE=true` over plain HTTP — the browser drops the cookie and
   login appears to succeed but every page redirects back.

---

## License

Proprietary. © WooBD.Com, House 72, RK Road, Rangpur, Bangladesh.
