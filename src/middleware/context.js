/**
 * The view-context middleware.
 *
 * Assembles everything the shared header/footer need - branding, menus, social
 * links, theme tokens, SEO defaults - and exposes it once per request on
 * res.locals. Without this every controller would have to repeat the same six
 * queries.
 */
'use strict';

const db = require('../config/database');
const settings = require('../services/settings.service');
const helpers = require('../utils/helpers');
const storage = require('../lib/storage');
const config = require('../config');

/** Short-lived menu cache: menus change rarely but render on every page. */
let menuCache = null;
let menuCacheAt = 0;
const MENU_TTL_MS = 120 * 1000;

async function loadMenus() {
  if (menuCache && Date.now() - menuCacheAt < MENU_TTL_MS) return menuCache;

  const rows = await db.query(
    `SELECT id, location, parent_id, label, url, target, icon, sort_order
     FROM menus WHERE status = 'active'
     ORDER BY location ASC, sort_order ASC, id ASC`
  );

  const grouped = {};
  for (const row of rows) {
    grouped[row.location] = grouped[row.location] || [];
    grouped[row.location].push(row);
  }

  // Build the header tree: top-level items with their children attached, so the
  // dropdown for services renders from data rather than being hardcoded.
  const header = grouped.header || [];
  const tree = header
    .filter((item) => !item.parent_id)
    .map((item) => ({ ...item, children: header.filter((child) => child.parent_id === item.id) }));

  menuCache = {
    headerTree: tree,
    header: header,
    mobile: grouped.mobile || [],
    footerQuick: grouped.footer_quick || [],
    footerServices: grouped.footer_services || [],
    footerInfo: grouped.footer_info || [],
  };
  menuCacheAt = Date.now();
  return menuCache;
}

function invalidateMenus() {
  menuCache = null;
  menuCacheAt = 0;
}

/** Social links that have actually been filled in. */
function socialLinks() {
  const map = [
    ['facebook', settings.get('social_facebook'), 'Facebook'],
    ['linkedin', settings.get('social_linkedin'), 'LinkedIn'],
    ['instagram', settings.get('social_instagram'), 'Instagram'],
    ['youtube', settings.get('social_youtube'), 'YouTube'],
  ];
  return map
    .filter(([, href]) => href && href.trim() && href.trim() !== '#')
    .map(([key, href, label]) => ({ key, href: href.trim(), label }));
}

/**
 * Colour tokens emitted as CSS custom properties. Values are validated as hex
 * by the settings form, so they cannot inject arbitrary CSS.
 */
function themeTokens() {
  return {
    primary: settings.get('theme_primary'),
    primaryDark: settings.get('theme_primary_dark'),
    secondary: settings.get('theme_secondary'),
    success: settings.get('theme_success'),
    danger: settings.get('theme_danger'),
    warning: settings.get('theme_warning'),
    bgLight: settings.get('theme_bg_light'),
    bgLightAlt: settings.get('theme_bg_light_alt'),
    textLight: settings.get('theme_text_light'),
    bgDark: settings.get('theme_bg_dark'),
    bgDarkAlt: settings.get('theme_bg_dark_alt'),
    textDark: settings.get('theme_text_dark'),
    radius: settings.get('theme_radius'),
  };
}

/** True when the request is for the admin panel (drives layout defaults). */
function isAdminRequest(req) {
  const slug = settings.get('admin_path_slug', 'dev-cp');
  return req.path.startsWith(`/${slug}`);
}

function viewContext() {
  return async (req, res, next) => {
    // ---------------------------------------------------------------------
    // Safe defaults, set BEFORE anything that can fail.
    //
    // Everything below this reads the database. When that fails the error
    // handler runs - and it renders a template through a LAYOUT, which reads
    // these same locals. With res.locals empty the layout throws too, so the
    // render fails, Express falls through to its built-in handler, and the
    // visitor gets a bare "Internal Server Error" with the real cause buried
    // in the log. That is the worst possible failure: the one moment you need
    // a readable error page is the moment you cannot render one.
    //
    // Setting them first means the layout always has something to work with,
    // and the code below overwrites every one of them on the happy path.
    // ---------------------------------------------------------------------
    const fallbackName = settings.get('site_name', 'WooBD.Com') || 'WooBD.Com';

    res.locals.site = {
      name: fallbackName,
      tagline: '',
      description: '',
      email: '',
      phone: '',
      whatsapp: '',
      whatsappLink: '',
      address: '',
      hours: '',
      currency: '৳',
      currencyCode: 'BDT',
      logoLight: helpers.url('/assets/img/logo-light.svg'),
      logoDark: helpers.url('/assets/img/logo-dark.svg'),
      favicon: helpers.url('/assets/img/favicon.svg'),
      social: {},
    };
    res.locals.seo = {
      title: fallbackName,
      description: '',
      keywords: '',
      robots: 'index,follow',
      canonical: '',
      ogImage: '',
    };
    res.locals.defaultColorMode = 'light';
    res.locals.helpers = helpers;
    res.locals.settings = {};
    res.locals.uploadLimits = storage.FOLDER_RULES;
    res.locals.navActive = '';
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;
    res.locals.adminPath = settings.get('admin_path_slug', 'dev-cp');
    res.locals.flash = { success: null, error: null, info: null };
    res.locals.menus = {
      header: [],
      headerTree: [],
      mobile: [],
      footerQuick: [],
      footerServices: [],
      footerInfo: [],
    };
    res.locals.staff = null;
    res.locals.customer = null;
    res.locals.isStaff = false;
    res.locals.isCustomer = false;
    res.locals.badges = {};
    res.locals.layout = isAdminRequest(req) ? 'layouts/admin' : 'layouts/public';
    res.locals.payments = { bkash: {}, nagad: {}, rocket: {}, card: {}, instructions: '' };
    res.locals.socials = [];
    res.locals.chat = { enabled: false, greeting: '' };
    res.locals.googleAuth = { enabled: false };
    res.locals.captcha = { enabled: false, siteKey: '' };
    res.locals.query = {};
    res.locals.showThemeToggle = false;

    // Theme and fonts are read straight from the settings cache, which falls
    // back to each setting's declared default when the database is unreachable
    // - so these are safe to call even in the failure path.
    res.locals.theme = themeTokens();
    res.locals.fonts = { heading: 'Inter', body: 'Inter' };

    try {
      // loadAll() MUST run before publicValues().
      //
      // get()/publicValues() read the in-memory cache and, when the cache is
      // empty, silently fall back to each setting's DEFAULT value. The cache is
      // emptied by invalidate() on every save, so without this call the first
      // request after an admin saves anything would render the whole site from
      // factory defaults - the saved value appears not to apply, and every
      // other customisation is lost with it until the process restarts.
      //
      // loadAll() is a no-op when the cache is already fresh, so this is free
      // on the common path.
      const [menus] = await Promise.all([loadMenus(), settings.loadAll()]);
      const pw = settings.publicValues();

      res.locals.site = {
        name: pw.site_name,
        tagline: pw.site_tagline,
        description: pw.site_description,
        email: pw.contact_email,
        phone: pw.contact_phone,
        whatsapp: pw.whatsapp_number,
        whatsappLink: pw.whatsapp_link || `https://wa.me/${(pw.whatsapp_number || '').replace(/\D/g, '')}`,
        address: pw.office_address,
        hours: pw.office_hours,
        currency: pw.currency_symbol,
        currencyCode: pw.currency_code,
        logoLight: pw.logo_light ? helpers.url(pw.logo_light) : helpers.url('/assets/img/logo-light.svg'),
        logoDark: pw.logo_dark ? helpers.url(pw.logo_dark) : helpers.url('/assets/img/logo-dark.svg'),
        logoFooter: pw.logo_footer ? helpers.url(pw.logo_footer) : (pw.logo_dark ? helpers.url(pw.logo_dark) : helpers.url('/assets/img/logo-dark.svg')),
        logoWidth: pw.logo_width || '160',
        favicon: pw.favicon ? helpers.url(pw.favicon) : helpers.url('/assets/img/favicon.svg'),
      };

      res.locals.theme = themeTokens();
      res.locals.settings = pw;
      res.locals.menus = menus;
      res.locals.socials = socialLinks();

      res.locals.seo = {
        title: pw.seo_meta_title || pw.site_name,
        description: pw.seo_meta_description || pw.site_description,
        keywords: pw.seo_meta_keywords || '',
        robots: pw.seo_robots || 'index,follow',
        ogImage: pw.seo_og_image ? helpers.absoluteUrl(pw.seo_og_image) : '',
        canonical: helpers.absoluteUrl(req.path),
        analyticsId: pw.google_analytics_id || '',
        pixelId: pw.facebook_pixel_id || '',
        verification: pw.google_site_verification || '',
      };

      res.locals.fonts = {
        heading: pw.font_heading || 'Inter',
        body: pw.font_body || 'Inter',
        baseSize: pw.font_base_size || '16',
        headingWeight: pw.font_weight_heading || '700',
      };

      res.locals.chat = {
        enabled: settings.getBool('chat_enabled'),
        showOnPublic: settings.getBool('chat_show_on_public'),
        showOnDashboard: settings.getBool('chat_show_on_dashboard'),
        position: pw.chat_position || 'right',
        title: pw.chat_widget_title,
        subtitle: pw.chat_widget_subtitle,
        greeting: pw.chat_greeting,
        // Validated before it reaches a style attribute: this value is rendered
        // into the page, so anything that is not a plain hex colour is dropped
        // in favour of the default rather than being injected as-is.
        accentColor: /^#[0-9a-f]{3,8}$/i.test(String(pw.chat_accent_color || '').trim())
          ? String(pw.chat_accent_color).trim()
          : '#25D366',
      };

      // reCAPTCHA only works when BOTH keys are present - middleware/captcha.js
      // skips verification entirely without them. So `enabled` has to mean
      // "configured AND switched on", not just "switched on".
      //
      // Every view guards on `captcha.enabled && settings.captcha_on_X` before
      // rendering the widget. When this flag ignored the keys, a site with the
      // switches on but no credentials still rendered an empty
      // data-sitekey widget and pulled Google's script on every page load,
      // showing a challenge the server never checked.
      const captchaSiteKey = settings.secret('captcha_site_key', config.recaptcha.siteKey);
      const captchaSecretKey = settings.secret('captcha_secret_key', config.recaptcha.secretKey);

      // Which forms are switched on. Read once here rather than four times in
      // the object below, and reused for the dashboard's configuration warning.
      const captchaAnyToggleOn =
        settings.getBool('captcha_on_login') ||
        settings.getBool('captcha_on_signup') ||
        settings.getBool('captcha_on_admin') ||
        // Previously omitted, so a site protecting only the contact form
        // showed no challenge on it at all.
        settings.getBool('captcha_on_contact');

      res.locals.captcha = {
        enabled: Boolean(captchaSiteKey && captchaSecretKey) && captchaAnyToggleOn,
        // The two facts the warning needs, kept apart on purpose. `configured`
        // is about the keys, `anyToggleOn` is about the switches, and the state
        // worth shouting about is "switch on, keys missing" - where the toggle
        // says the site is protected and nothing is.
        configured: Boolean(captchaSiteKey && captchaSecretKey),
        anyToggleOn: captchaAnyToggleOn,
        siteKey: captchaSiteKey,
        // 'invisible' renders no box; 'checkbox' is the classic tick box. Any
        // value other than the two known modes falls back to invisible, so a
        // typo cannot leave a form unprotected by rendering nothing.
        mode: settings.get('captcha_mode') === 'checkbox' ? 'checkbox' : 'invisible',
        // v2 renders a widget; v3 is a score computed in the background with no
        // widget at all. The two need different script URLs and different
        // client code, and a key of one type cannot be used as the other.
        version: settings.get('captcha_version') === 'v3' ? 'v3' : 'v2',
      };

      res.locals.googleAuth = {
        enabled: settings.getBool('google_auth_enabled') && Boolean(settings.secret('google_client_id', config.google.clientId)),
        onLogin: settings.getBool('google_auth_on_login'),
        onSignup: settings.getBool('google_auth_on_signup'),
      };

      res.locals.payments = {
        bkash: {
          enabled: settings.getBool('payment_bkash_enabled'),
          number: settings.get('payment_bkash_number'),
          type: settings.get('payment_bkash_type'),
          logo: settings.get('payment_bkash_logo') || '',
        },
        nagad: {
          enabled: settings.getBool('payment_nagad_enabled'),
          number: settings.get('payment_nagad_number'),
          type: settings.get('payment_nagad_type'),
          logo: settings.get('payment_nagad_logo') || '',
        },
        rocket: {
          enabled: settings.getBool('payment_rocket_enabled'),
          number: settings.get('payment_rocket_number'),
          type: settings.get('payment_rocket_type'),
          logo: settings.get('payment_rocket_logo') || '',
        },
        card: {
          enabled: settings.getBool('payment_card_enabled'),
          note: settings.get('payment_card_note'),
          logo: settings.get('payment_card_logo') || '',
        },
        instructions: settings.get('payment_instructions'),
      };

      res.locals.defaultColorMode = pw.default_color_mode || 'light';
      res.locals.showThemeToggle = pw.show_theme_toggle === '1';
      res.locals.helpers = helpers;

      // Upload limits, so a file input can state its own size cap and the
      // client-side check reads the same numbers the server enforces. Taken
      // from FOLDER_RULES rather than hardcoded per template, so the two can
      // never drift apart.
      res.locals.uploadLimits = storage.FOLDER_RULES;
      res.locals.currentUrl = req.originalUrl;
      res.locals.query = req.query;

      // Flash messages are read out of the session here and cleared, so a
      // redirect-with-message works without a flash dependency.
      res.locals.flash = {
        success: req.session && req.session.flashSuccess ? req.session.flashSuccess : null,
        error: req.session && req.session.flashError ? req.session.flashError : null,
        info: req.session && req.session.flashInfo ? req.session.flashInfo : null,
      };
      if (req.session) {
        delete req.session.flashSuccess;
        delete req.session.flashError;
        delete req.session.flashInfo;
      }

      // Layout selection: admin uses its own shell unless a controller overrides.
      res.locals.layout = isAdminRequest(req) ? 'layouts/admin' : 'layouts/public';

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { viewContext, invalidateMenus, loadMenus, socialLinks, themeTokens };
