/**
 * WooBD.Com - application entry point.
 *
 * Middleware order matters and is deliberate:
 *   1. config + logger            - fail fast before binding a port
 *   2. security headers           - must wrap every response, including errors
 *   3. static assets              - served before sessions so images are cheap
 *   4. body parsers + cookies
 *   5. session (DB-backed)        - survives a Hostinger redeploy
 *   6. view context               - needs the session, feeds every template
 *   7. identity                   - re-validates the session against the DB
 *   8. CSRF                       - sits after identity so 419s can render
 *   9. maintenance gate           - staff bypass reads identity
 *  10. routes
 *  11. 404 + error handler
 */
'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const config = require('./src/config');
const logger = require('./src/utils/logger');
const helpers = require('./src/utils/helpers');
const settings = require('./src/services/settings.service');
const db = require('./src/config/database');
const { MySQLSessionStore } = require('./src/lib/storage');

const { viewContext, invalidateMenus } = require('./src/middleware/context');
const auth = require('./src/middleware/auth');
const csrf = require('./src/middleware/csrf');
const security = require('./src/middleware/security');

const publicRoutes = require('./src/routes/public.routes');
const authRoutes = require('./src/routes/auth.routes');
const customerRoutes = require('./src/routes/customer.routes');
const adminRoutes = require('./src/routes/admin.routes');

const app = express();

// Hostinger terminates TLS at its own proxy; without this req.secure and the
// client IP are wrong, which breaks secure cookies and rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// View engine
// ---------------------------------------------------------------------------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);

// Script/style extraction is OFF, deliberately.
//
// express-ejs-layouts with these enabled pulls every <script>/<style>/<link>
// out of the rendered view into `locals.script` / `locals.style`, and the
// layout is then responsible for printing them back with <%- script %>.
// No layout in this project does that, so enabling either setting silently
// DELETES that markup - which cost us the FAQ, LocalBusiness and Product
// JSON-LD blocks, and would have cost the reCAPTCHA loader on every form.
//
// Views here author their tags where they belong (reCAPTCHA beside the widget,
// structured data beside the section it describes), so leaving them in place is
// both correct and safer than hoisting them to one spot in the layout.
app.set('layout extractScripts', false);
app.set('layout extractStyles', false);

// Default layout. middleware/context overrides this per request, because the
// admin panel needs a different shell and a controller may override again.
app.set('layout', 'layouts/public');

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
// Every middleware in src/middleware is exported as a FACTORY - calling it
// returns the actual (req, res, next) handler. Mounting one bare hands Express
// the factory itself, which just returns a new function and never calls next():
// the request then hangs until the client times out. Note the () on each.
// Health probe.
//
// Registered FIRST, ahead of every other middleware. A probe that can be
// redirected is a probe that lies: behind a proxy that omits or misconfigures
// X-Forwarded-Proto, `req.secure` reads false and the host's health check gets
// a 301 instead of a 200 - so the platform reports the app as unhealthy while
// it is serving perfectly well, and you go chasing a fault that is not there.
//
// It also touches nothing but the database, so it stays truthful even when
// sessions, CSRF or the canonical-host rules are misconfigured.
app.get('/healthz', async (req, res) => {
  let database = 'down';
  try {
    await db.healthCheck();
    database = 'up';
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    uptime: Math.round(process.uptime()),
  });
});

app.use(security.securityHeaders());
app.use(security.canonicalHost());

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    etag: true,
    // Fonts and images are content-addressed by name, so a long cache is safe;
    // HTML is never served from here.
    setHeaders(res, filePath) {
      if (/\.(woff2?|ttf|otf|svg|png|jpe?g|webp|ico|avif)$/i.test(filePath)) {
        res.setHeader('Cache-Control', `public, max-age=${config.isProd ? 2592000 : 0}`);
      }
    },
  })
);

// Uploads are mounted from wherever UPLOAD_DIR points, so they can live outside
// the versioned build directory that Hostinger recreates on every deploy.
app.use(
  config.uploads.publicPath,
  express.static(config.uploads.dir, {
    maxAge: config.isProd ? '30d' : 0,
    etag: true,
    index: false,
    dotfiles: 'deny',
  })
);

// WhatsApp/webhook style form posts arrive urlencoded; the chat widget posts JSON.
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(config.session.secret));

// ---------------------------------------------------------------------------
// Session - stored in MySQL so a redeploy does not sign everybody out.
// ---------------------------------------------------------------------------
app.use(
  session({
    name: config.session.name,
    secret: config.session.secret,
    store: new MySQLSessionStore({ ttlMs: config.session.maxAge }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Secure cookies are silently dropped over plain HTTP, which presents as
      // "login works then every page redirects". Left off unless the deployment
      // is genuinely behind TLS.
      secure: config.session.secure,
      maxAge: config.session.maxAge,
      path: '/',
    },
  })
);

// ---------------------------------------------------------------------------
// View plumbing
// ---------------------------------------------------------------------------
app.locals.helpers = helpers;
app.locals.config = { basePath: config.app.basePath, appName: config.app.name };

app.use(viewContext());
app.use(auth.loadIdentity());
app.use(csrf());
app.use(security.maintenanceMode());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/', publicRoutes);
app.use('/account', customerRoutes);
app.use('/', authRoutes);

// The admin panel lives at a configurable slug (default `dev-cp`) so the login
// page cannot be found by guessing /admin.
//
// The router's own paths are relative to the slug ("/login", "/dashboard"), so
// Express must strip the prefix before dispatch. Calling
// `adminRoutes(req, res, next)` directly leaves req.url as "/dev-cp/login"
// while the router looks for "/login": nothing matches, nothing responds, and
// the request hangs. Mounting with use(slug, router) does the stripping.
//
// Resolved at request time, not at boot, so changing the slug in the admin
// panel takes effect without a redeploy.
app.use((req, res, next) => {
  const slug = `/${settings.get('admin_path_slug', 'dev-cp')}`;
  if (req.path !== slug && !req.path.startsWith(`${slug}/`)) return next();
  // Rewrite the path so the router sees its own relative form, then restore it
  // afterwards so later middleware (404 handler, logging) sees the real URL.
  const originalUrl = req.url;
  req.url = req.url.slice(slug.length) || '/';
  if (!req.url.startsWith('/')) req.url = `/${req.url}`;

  res.on('finish', () => {
    req.url = originalUrl;
  });

  adminRoutes(req, res, (err) => {
    req.url = originalUrl;
    next(err);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
app.use(security.notFound());
app.use(security.errorHandler());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let server = null;

async function start() {
  try {
    // Prove the database is reachable before accepting traffic. A misconfigured
    // DB host is the single most common Hostinger failure, and failing here
    // produces a clear log line instead of a 500 on every page.
    await db.healthCheck();
    logger.info('Database connection established.');

    // Warm the settings cache so the first request is not the one that pays for it.
    await settings.loadAll();
    invalidateMenus();

    server = app.listen(config.app.port, config.app.host, () => {
      logger.info(
        `${config.app.name} listening on http://${config.app.host}:${config.app.port} (${config.env})`
      );
      if (!config.isProd) {
        logger.info('Admin panel slug: ' + settings.get('admin_path_slug', 'dev-cp'));
      }
    });
  } catch (err) {
    logger.error('Failed to start the application.', err);
    process.exit(1);
  }
}

/** Close cleanly so in-flight requests finish and the pool is drained. */
function shutdown(signal) {
  logger.info(`${signal} received - shutting down.`);
  const done = () => {
    db.close().finally(() => process.exit(0));
  };
  if (server) server.close(done);
  else done();
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10000).unref();
}

['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// scripts/smoke.js needs the app object but no listening socket: it drives the
// middleware chain in-process so the test works in environments where binding
// or connecting to a port is restricted.
if (process.env.NO_LISTEN !== '1') {
  start();
}

module.exports = app;
