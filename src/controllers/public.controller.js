/**
 * Public site controller: homepage, about, packages, portfolio, contact and
 * the legal pages.
 *
 * All of these are read-heavy and cached at the HTTP layer, so they stay cheap
 * under traffic.
 */
'use strict';

const config = require('../config');
const content = require('../models/content.model');
const orders = require('../models/order.model');
const settings = require('../services/settings.service');
const mail = require('../services/mail.service');
const activity = require('../services/activity.service');
const captcha = require('../middleware/captcha');
const { clean, validate } = require('../utils/validators');
const { fromQuery } = require('../utils/paginator');
const logger = require('../utils/logger');

/** Short-lived cache for homepage inputs, which change rarely. */
const cache = new Map();

async function cached(key, ttlMs, loader) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at < ttlMs) return entry.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function clearCache() {
  cache.clear();
}

/** Static content for the "why choose us" band - copy, not data. */
const WHY_CHOOSE = [
  {
    icon: 'zap',
    title: 'Fast on real connections',
    text: 'We test on throttled mobile data, not office wifi. Your store opens in under two seconds or we keep optimising.',
  },
  {
    icon: 'shopping-cart',
    title: 'Checkout that converts',
    text: 'A short, friction-free checkout with bKash, Nagad, Rocket and card — the methods your customers already trust.',
  },
  {
    icon: 'search',
    title: 'Found on Google',
    text: 'Clean URLs, schema markup, sitemaps and sensible meta tags configured before launch, not sold afterwards.',
  },
  {
    icon: 'smartphone',
    title: 'Mobile-first by default',
    text: 'Most Bangladeshi shoppers buy on a phone. Every layout starts there and scales up, never the reverse.',
  },
  {
    icon: 'shield',
    title: 'Secure and maintained',
    text: 'HTTPS, hardened admin access and regular updates. Your store and your customers’ data stay protected.',
  },
  {
    icon: 'life-buoy',
    title: 'Support that answers',
    text: 'A named contact in Rangpur, reachable by phone, WhatsApp or ticket — not a queue that never moves.',
  },
];

const SERVICE_DELIVERABLES = [
  'Full website source files and hosting setup',
  'Admin panel access with your own login',
  'Product catalogue loaded and configured',
  'Payment gateway integration tested end to end',
  'A walkthrough session so you can run it yourself',
  'Post-launch support window',
];

// ---------------------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------------------

exports.home = async (req, res, next) => {
  try {
    const [services, portfolio, testimonials, faqs, clients, blogPosts] = await Promise.all([
      cached('home:services', 120000, () =>
        content.listServices({ status: 'active', featured: true, perPage: 6 })
      ),
      cached('home:portfolio', 120000, () =>
        content.listPortfolio({ status: 'active', perPage: 6 })
      ),
      cached('home:testimonials', 120000, () =>
        content.listTestimonials({ status: 'active', limit: 6 })
      ),
      cached('home:faqs', 120000, () => content.listFaqs({ status: 'active', limit: 8 })),
      cached('home:clients', 300000, () => content.listClients({ status: 'active' })),
      // Featured posts first, topped up with the newest so the section is not
      // empty on a blog nobody has flagged anything on yet.
      cached('home:blog', 120000, async () => {
        const limit = Math.max(1, Math.min(6, Number(settings.get('blog_home_count')) || 3));
        const featuredPosts = await content.featuredPosts(limit);
        if (featuredPosts.length >= limit) return featuredPosts;

        const seen = new Set(featuredPosts.map((p) => p.id));
        const latest = await content.listPublishedPosts({ perPage: limit * 2 });
        for (const row of latest.rows) {
          if (featuredPosts.length >= limit) break;
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          featuredPosts.push(row);
        }
        return featuredPosts;
      }),
    ]);

    // If nothing is flagged as featured yet, fall back to the newest packages so
    // the section is never empty on a fresh install.
    let featured = services.rows;
    if (!featured.length) {
      const fallback = await content.listServices({ status: 'active', perPage: 6 });
      featured = fallback.rows;
    }

    res.render('public/home', {
      layout: 'layouts/public',
      title: null,
      pageTitle: null,
      services: featured,
      portfolio: portfolio.rows,
      testimonials: testimonials,
      faqs: faqs,
      clients: clients,
      blogPosts,
      whyChoose: WHY_CHOOSE,
      seo: {
        ...res.locals.seo,
        title: settings.get('seo_meta_title'),
        canonical: settings.get('site_url') || res.locals.seo.canonical,
      },
      extraHead: buildOrganizationSchema(res.locals),
    });
  } catch (err) {
    next(err);
  }
};

/** Organization + WebSite JSON-LD, emitted on the homepage. */
function buildOrganizationSchema(locals) {
  const { site, helpers, socials } = locals;
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    url: helpers.absoluteUrl('/'),
    description: site.description,
    email: site.email,
    telephone: site.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'House 72, RK Road',
      addressLocality: 'Rangpur',
      addressCountry: 'BD',
    },
    sameAs: socials.map((s) => s.href),
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: site.phone,
      contactType: 'customer service',
      availableLanguage: ['English', 'Bengali'],
    },
  };

  // helpers.jsonLd escapes < > & inside the JSON, so an admin-editable value
  // (site name, description, package title) containing "</script>" cannot close
  // the block early. Plain JSON.stringify would be a stored-XSS vector.
  return `<script type="application/ld+json">${helpers.jsonLd(payload)}</script>`;
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

exports.about = async (req, res, next) => {
  try {
    const testimonials = await content.listTestimonials({ status: 'active', limit: 6 });

    res.render('public/about', {
      layout: 'layouts/public',
      pageTitle: 'About Us',
      lead: null,
      crumbs: [{ label: 'About' }],
      testimonials,
      seo: {
        ...res.locals.seo,
        title: `About Us - ${res.locals.site.name}`,
        description: `Learn about ${res.locals.site.name}, a Bangladesh-based e-commerce website design agency based in Rangpur.`,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Services listing
// ---------------------------------------------------------------------------

exports.services = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, 12);
    const categorySlug = clean.slug(req.query.category || '');
    const search = clean.str(req.query.q || '', 120);

    const categories = await content.listCategories({ onlyActive: true });

    let categoryId = null;
    let activeCategory = null;
    if (categorySlug) {
      const category = categories.find((item) => item.slug === categorySlug);
      if (category) {
        categoryId = category.id;
        activeCategory = category.slug;
      }
    }

    const result = await content.listServices({
      page,
      perPage: 12, // 12 packages per page, as specified
      status: 'active',
      categoryId,
      search,
      sort: req.query.sort || 'sort_order',
    });

    res.render('public/services', {
      layout: 'layouts/public',
      pageTitle: 'Our Packages',
      lead: null,
      crumbs: [{ label: 'Packages' }],
      services: result.rows,
      pager: result,
      categories,
      activeCategory,
      search,
      faqs: await content.listFaqs({ status: 'active', category: 'packages', limit: 6 }),
      seo: {
        ...res.locals.seo,
        title: `Website Design Packages & Pricing - ${res.locals.site.name}`,
        description:
          'Fixed-price e-commerce website packages for Bangladeshi businesses. Compare features and order online with bKash, Nagad, Rocket or card payment.',
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.serviceSingle = async (req, res, next) => {
  try {
    const service = await content.findServiceBySlug(clean.slug(req.params.slug));

    if (!service || service.status !== 'active') {
      return res.status(404).render('errors/404', {
        layout: 'layouts/public',
        title: 'Package not found',
        requestedPath: req.originalUrl,
      });
    }

    // Fire-and-forget view counter.
    content.incrementServiceViews(service.id);

    const related = await content.relatedServices(service, 3);

    res.render('public/service-single', {
      layout: 'layouts/public',
      pageTitle: service.title,
      lead: service.short_description,
      crumbs: [{ label: 'Packages', url: '/services' }, { label: service.title }],
      service,
      related,
      deliverables: SERVICE_DELIVERABLES,
      seo: {
        ...res.locals.seo,
        title: service.seo_title || `${service.title} - ${res.locals.site.name}`,
        description:
          service.seo_description ||
          service.short_description ||
          `Order the ${service.title} package from ${res.locals.site.name}.`,
      },
      extraHead: buildServiceSchema(service, res.locals),
    });
  } catch (err) {
    next(err);
  }
};

function buildServiceSchema(service, locals) {
  const { helpers, site, settings: siteSettings } = locals;
  const price = service.sale_price && Number(service.sale_price) > 0 ? service.sale_price : service.price;
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.title,
    description: helpers.excerpt(service.short_description || service.description, 300),
    provider: { '@type': 'Organization', name: site.name, url: helpers.absoluteUrl('/') },
    areaServed: { '@type': 'Country', name: 'Bangladesh' },
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: siteSettings.currency_code || 'BDT',
      url: helpers.absoluteUrl(`/services/${service.slug}`),
    },
  };

  // Escaped the same way as the Organization schema above - see helpers.jsonLd.
  return `<script type="application/ld+json">${helpers.jsonLd(payload)}</script>`;
}

// ---------------------------------------------------------------------------
// Package comparison
// ---------------------------------------------------------------------------

/** How many packages fit across the table before the columns stop being read. */
const COMPARE_MAX = 4;

/**
 * Side-by-side package comparison.
 *
 * The selection lives in the query string rather than in the page state, so a
 * comparison can be linked, bookmarked, and pasted into a message. That is the
 * whole point of comparing: the person who needs the answer is usually not the
 * one who did the clicking.
 *
 * Feature rows are the union of every selected package's features, in the order
 * they first appear. Alphabetical would be tidier and wrong - the features are
 * authored in a deliberate order, and re-sorting them scrambles the story the
 * package is telling.
 */
exports.compare = async (req, res, next) => {
  try {
    // Two shapes arrive here and both are legitimate: ?p=a&p=b is what the
    // checkboxes produce, ?p=a,b is what a hand-written link looks like.
    const raw = req.query.p;
    const requested = (Array.isArray(raw) ? raw : String(raw || '').split(','))
      .map((value) => clean.slug(String(value).trim()))
      .filter(Boolean);

    const result = await content.listServices({ status: 'active', perPage: 300 });
    const all = result.rows || [];

    // The same filter the homepage uses: a package with no features and no
    // description renders as a row of empty cells, which reads as a bug.
    const comparable = all.filter(
      (row) => helpersParse(row).length > 0 || String(row.short_description || '').trim().length > 0
    );

    // Order follows the catalogue rather than the order the boxes were ticked,
    // so adding a fourth package does not reshuffle the first three columns.
    const selected = comparable.filter((row) => requested.includes(row.slug)).slice(0, COMPARE_MAX);

    // Every feature across the selection, de-duplicated case-insensitively -
    // "SSL certificate" and "SSL Certificate" are one row, not two.
    const rows = [];
    const seen = new Set();
    for (const pkg of selected) {
      for (const feature of helpersParse(pkg)) {
        const label = String(feature).trim();
        const key = label.toLowerCase();
        if (!label || seen.has(key)) continue;
        seen.add(key);
        rows.push({ label, key });
      }
    }

    // Precomputed per package so the template stays a lookup rather than
    // repeating the parse for every cell.
    const columns = selected.map((pkg) => {
      const own = new Set(helpersParse(pkg).map((f) => String(f).trim().toLowerCase()));
      const base = Number(pkg.price) || 0;
      const sale = Number(pkg.sale_price) || 0;
      const hasSale = sale > 0 && sale < base;

      return {
        slug: pkg.slug,
        title: pkg.title,
        category: pkg.category_name || '',
        billing: pkg.billing_cycle === 'one_time' ? 'One-off' : 'Per month',
        minMonths: Number(pkg.min_months) || 1,
        isRecurring: pkg.billing_cycle !== 'one_time',
        price: hasSale ? sale : base,
        wasPrice: hasSale ? base : null,
        features: own,
        summary: res.locals.helpers.excerpt(pkg.short_description || pkg.description, 150),
      };
    });

    // The grid is the whole answer: a tick or a dash per package per feature.
    //
    // An earlier version also flagged the rows only one package carried. It
    // turned out to be pure noise - the packages are written in tiers, so
    // nearly every feature line differs between them ("up to 300 products"
    // against "up to 1,000"), which meant a badge on almost every row. And it
    // said nothing the tick marks did not already say.
    const matrix = rows.map((row) => ({
      label: row.label,
      cells: columns.map((column) => column.features.has(row.key)),
    }));

    res.render('public/compare', {
      layout: 'layouts/public',
      pageTitle: 'Compare Packages',
      lead: 'Put our packages side by side and see exactly what each one includes.',
      crumbs: [{ label: 'Packages', url: '/services' }, { label: 'Compare' }],
      columns,
      matrix,
      all: comparable.map((row) => ({ slug: row.slug, title: row.title })),
      requested,
      max: COMPARE_MAX,
      seo: {
        ...res.locals.seo,
        title: `Compare Website Packages Side by Side - ${res.locals.site.name}`,
        description:
          'Compare every feature, price and billing term across our website design packages before you choose. No sales call required.',
      },
    });
  } catch (err) {
    next(err);
  }
};

/** Features are stored as a JSON string in a text column; this normalises both. */
function helpersParse(row) {
  const parsed = safeParseFeatures(row && row.features);
  return Array.isArray(parsed) ? parsed : [];
}

function safeParseFeatures(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch (err) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

exports.portfolio = async (req, res, next) => {
  try {
    const { page } = fromQuery(req.query, 9);
    const activeCategory = clean.str(req.query.category || '', 100);

    const [result, categoryList] = await Promise.all([
      content.listPortfolio({
        page,
        perPage: 9,
        status: 'active',
        category: activeCategory,
        sort: req.query.sort || 'sort_order',
      }),
      content.portfolioCategories(),
    ]);

    res.render('public/portfolio', {
      layout: 'layouts/public',
      pageTitle: 'Our Portfolio',
      lead: null,
      crumbs: [{ label: 'Portfolio' }],
      projects: result.rows,
      pager: result,
      categoryList,
      activeCategory,
      seo: {
        ...res.locals.seo,
        title: `Portfolio - E-commerce Websites We Built - ${res.locals.site.name}`,
        description:
          'Browse e-commerce stores, corporate websites and custom web projects delivered by our team across Bangladesh.',
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.portfolioSingle = async (req, res, next) => {
  try {
    const project = await content.findPortfolioBySlug(clean.slug(req.params.slug));

    if (!project || project.status !== 'active') {
      return res.status(404).render('errors/404', {
        layout: 'layouts/public',
        title: 'Project not found',
        requestedPath: req.originalUrl,
      });
    }

    const related = await content.relatedPortfolio(project, 3);

    res.render('public/portfolio-single', {
      layout: 'layouts/public',
      pageTitle: project.title,
      lead: project.short_description,
      crumbs: [{ label: 'Portfolio', url: '/portfolio' }, { label: project.title }],
      project,
      related,
      seo: {
        ...res.locals.seo,
        title: project.seo_title || `${project.title} - Case Study - ${res.locals.site.name}`,
        description: project.seo_description || project.short_description || `${project.title} project by ${res.locals.site.name}.`,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

exports.contactForm = async (req, res, next) => {
  try {
    // Prefill the subject when arriving from a package or project page.
    let prefillSubject = '';
    if (req.query.package) prefillSubject = `Enquiry about the ${clean.str(req.query.package, 120)} package`;
    if (req.query.project) prefillSubject = `Enquiry about a project like ${clean.str(req.query.project, 120)}`;

    res.render('public/contact', {
      layout: 'layouts/public',
      pageTitle: 'Contact Us',
      lead: null,
      crumbs: [{ label: 'Contact' }],
      form: null,
      errors: null,
      prefillSubject,
      seo: {
        ...res.locals.seo,
        title: `Contact Us - ${res.locals.site.name}`,
        description: `Get in touch with ${res.locals.site.name}. Office at House 72, RK Road, Rangpur, Bangladesh. Call or WhatsApp ${res.locals.site.phone}.`,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.contactSubmit = async (req, res, next) => {
  const form = {
    name: clean.str(req.body.name, 120),
    email: clean.email(req.body.email),
    phone: clean.str(req.body.phone, 30),
    subject: clean.str(req.body.subject, 250),
    message: clean.text(req.body.message, 4000),
    source: clean.str(req.body.source, 60) || 'contact_page',
  };

  // Re-render helper so a validation failure keeps what the visitor typed.
  const rerender = (errors) =>
    res.status(400).render('public/contact', {
      layout: 'layouts/public',
      pageTitle: 'Contact Us',
      lead: null,
      crumbs: [{ label: 'Contact' }],
      form,
      errors,
      prefillSubject: '',
      seo: { ...res.locals.seo, title: `Contact Us - ${res.locals.site.name}` },
    });

  try {
    const errors = {};
    const nameError = validate.length(form.name, 2, 120, 'Name');
    const emailError = validate.email(form.email);
    const phoneError = validate.phone(form.phone);
    const messageError = validate.length(form.message, 10, 4000, 'Message');

    if (nameError) errors.name = nameError;
    if (emailError) errors.email = emailError;
    if (phoneError) errors.phone = phoneError;
    if (messageError) errors.message = messageError;

    if (Object.keys(errors).length) return rerender(errors);

    // CAPTCHA, if enabled for this form.
    const captchaResult = await captcha.verify(
      req.body['g-recaptcha-response'],
      req.ip,
      'contact'
    );
    if (!captchaResult.ok) {
      errors.captcha = captchaResult.message;
      return rerender(errors);
    }

    const id = await orders.createContactMessage({
      ...form,
      ip_address: req.ip,
      status: 'new',
    });

    await activity.log({
      req,
      action: 'contact.received',
      entityType: 'contact_message',
      entityId: id,
      description: `New enquiry from ${form.name}.`,
    });

    // Mail failures must not lose the submission - it is already stored.
    Promise.allSettled([
      mail.sendContactAcknowledgement(form),
      mail.sendContactNotification(form),
    ]).catch(() => {});

    // The homepage CTA post goes back to the homepage with an anchor; the
    // contact page stays put.
    const redirectTo = form.source === 'homepage_cta' ? '/?sent=1#quote' : '/contact?sent=1';
    req.session.flashSuccess =
      'Thank you — your message reached us. We reply within one business day.';
    return res.redirect(res.locals.helpers.url(redirectTo));
  } catch (err) {
    logger.error('Contact submission failed', err);
    return rerender({ general: 'We could not send your message just now. Please try again or WhatsApp us.' });
  }
};

// ---------------------------------------------------------------------------
// Static / legal pages
// ---------------------------------------------------------------------------

/**
 * XML sitemap.
 *
 * Covers every public URL the site can produce: the fixed pages, the CMS pages,
 * packages, portfolio pieces and blog posts. Built from the database rather
 * than a hand-maintained list, so a new package or article appears without
 * anyone remembering to add it.
 *
 * `lastmod` is emitted only where the row has a real updated timestamp - a
 * sitemap that claims everything changed today is ignored.
 */
async function buildSitemap() {
  const base = String(config.app.url || '').replace(/\/$/, '');
  const urls = [];

  const add = (path, lastmod, priority, changefreq) => {
    urls.push({ loc: `${base}${path}`, lastmod, priority, changefreq });
  };

  // Fixed routes, in rough order of importance.
  add('/', null, '1.0', 'weekly');
  add('/services', null, '0.9', 'weekly');
  add('/compare', null, '0.7', 'monthly');
  add('/portfolio', null, '0.8', 'monthly');
  add('/blog', null, '0.8', 'daily');
  add('/contact', null, '0.6', 'yearly');
  add('/live-chat', null, '0.4', 'yearly');

  const iso = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

  // Each section is fetched only when it is being listed. Turning a section off
  // has to save the query as well as the line, or a site that deliberately
  // hides 400 portfolio pieces still pays to load them on every crawl.
  const wantServices = settings.getBool('sitemap_include_services', true);
  const wantPortfolio = settings.getBool('sitemap_include_portfolio', true);
  const wantPages = settings.getBool('sitemap_include_pages', true);
  const wantPosts = settings.getBool('sitemap_include_posts', true);

  const [services, portfolio, pages, posts] = await Promise.all([
    wantServices ? content.listServices({ status: 'active', perPage: 500 }) : null,
    wantPortfolio ? content.listPortfolio({ status: 'active', perPage: 500 }) : null,
    wantPages ? content.listPages({ status: 'published' }) : null,
    wantPosts ? content.publishedPostIndex() : null,
  ]);

  for (const row of (services && services.rows) || []) add(`/services/${row.slug}`, iso(row.updated_at), '0.8', 'monthly');
  for (const row of (portfolio && portfolio.rows) || []) add(`/portfolio/${row.slug}`, iso(row.updated_at), '0.7', 'monthly');
  for (const row of pages || []) add(`/page/${row.slug}`, iso(row.updated_at), '0.4', 'yearly');
  for (const row of posts || []) add(`/blog/${row.slug}`, iso(row.updated_at), '0.7', 'monthly');

  const body = urls
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
      parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      parts.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** XML has five characters that cannot appear bare in text or an attribute. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

exports.sitemap = async (req, res, next) => {
  try {
    // Off means off. An empty <urlset> would be a valid-looking sitemap that
    // claims the site has no pages, which is worse than saying it is not here.
    if (!settings.getBool('sitemap_enabled', true)) {
      return res.status(404).type('text/plain').send('Sitemap is disabled.');
    }

    const minutes = Math.max(0, settings.getInt('sitemap_cache_minutes', 15));

    // The cache key carries the include flags, so flipping one in the panel
    // takes effect on the next request instead of waiting out the TTL.
    const key = [
      'sitemap',
      settings.getBool('sitemap_include_services', true) ? 1 : 0,
      settings.getBool('sitemap_include_portfolio', true) ? 1 : 0,
      settings.getBool('sitemap_include_pages', true) ? 1 : 0,
      settings.getBool('sitemap_include_posts', true) ? 1 : 0,
    ].join(':');

    // A crawler walking every URL in the file is the one visitor guaranteed to
    // hit it repeatedly, so this is the response most worth caching.
    const xml = await cached(key, minutes * 60 * 1000, buildSitemap);

    res.type('application/xml');
    res.setHeader('Cache-Control', `public, max-age=${Math.max(300, minutes * 60)}`);
    res.send(xml);
  } catch (err) {
    next(err);
  }
};

/**
 * robots.txt.
 *
 * Points crawlers at the sitemap and keeps them out of the panel, the account
 * area and anything with a query string - a filtered listing is a duplicate of
 * the listing itself.
 */
exports.robots = (req, res) => {
  if (!settings.getBool('robots_enabled', true)) {
    return res.status(404).type('text/plain').send('robots.txt is disabled.');
  }

  const base = String(config.app.url || '').replace(/\/$/, '');
  const adminPath = settings.get('admin_path_slug', 'dev-cp');
  const sitemapOn = settings.getBool('sitemap_enabled', true);
  const sitemapLine = sitemapOn ? `Sitemap: ${base}/sitemap.xml` : null;

  // Collected in a Set so an operator who also lists /account/ by hand does not
  // end up with the line twice. Duplicates are legal but they make the file
  // look unmaintained, and the next person to read it cannot tell which copy is
  // authoritative.
  const rules = new Set();

  if (settings.getBool('robots_block_all')) {
    // The wildcard agent below already covers every crawler, so one Disallow is
    // enough. Enumerating named agents is how this file normally drifts out of
    // step with the site.
    rules.add('Disallow: /');

    const lines = ['User-agent: *', ...rules, ''];
    // The sitemap is still advertised. A staging site that is opened up later
    // should not make Google rediscover the file from scratch.
    if (sitemapLine) lines.push(sitemapLine, '');

    res.type('text/plain');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(lines.join('\n'));
  }

  rules.add('Allow: /');
  rules.add(`Disallow: /${adminPath}/`);
  rules.add('Disallow: /account/');
  rules.add('Disallow: /api/');
  rules.add('Disallow: /*?q=');
  rules.add('Disallow: /*?page=');

  // Operator additions, one path per line. Blanks and comment lines are
  // dropped: a stray '#' left in would comment out every rule after it.
  String(settings.get('robots_extra_disallow', '') || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => rules.add(`Disallow: ${line.startsWith('/') ? line : '/' + line}`));

  const delay = settings.getInt('robots_crawl_delay', 0);
  if (delay > 0) rules.add(`Crawl-delay: ${delay}`);

  const lines = ['User-agent: *', ...rules, ''];
  if (sitemapLine) lines.push(sitemapLine, '');

  // Appended verbatim. This is the escape hatch for directives this form does
  // not model, so it is deliberately not parsed.
  const custom = String(settings.get('robots_custom', '') || '').trim();
  if (custom) lines.push(custom, '');

  res.type('text/plain');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(lines.join('\n'));
};

/**
 * Turn headings in post content into a table of contents.
 *
 * Adds an id to each h2/h3 as it goes, so the links have something to point at.
 * Skipped entirely when there are fewer than three headings - a two-item
 * contents list is clutter, not navigation.
 *
 * @returns {{ html: string, toc: Array }}
 */
function buildTableOfContents(html) {
  const source = String(html || '');
  const toc = [];
  const used = new Set();

  const withIds = source.replace(
    /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs = '', inner) => {
      const text = String(inner).replace(/<[^>]*>/g, '').trim();
      if (!text) return match;

      // A stable, readable anchor. De-duplicated, because two headings can
      // legitimately read the same and a repeated id breaks the link.
      let id = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'section';

      let unique = id;
      let n = 2;
      while (used.has(unique)) unique = `${id}-${n++}`;
      used.add(unique);

      toc.push({ id: unique, text, level: Number(level) });

      // Preserve any attributes already on the heading.
      const cleaned = String(attrs).replace(/\sid="[^"]*"/i, '');
      return `<h${level}${cleaned} id="${unique}">${inner}</h${level}>`;
    }
  );

  return { html: withIds, toc: toc.length >= 3 ? toc : [] };
}

/** Estimated reading time, when the editor has not set one. */
function estimateReadingMinutes(html) {
  const words = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * The blog index.
 *
 * Category and search are query parameters, so the page has one canonical URL
 * shape and the pager does not have to rebuild a path.
 */
exports.blogIndex = async (req, res, next) => {
  try {
    const perPage = 9;
    const page = Math.max(1, Number(req.query.page) || 1);
    const search = String(req.query.q || '').slice(0, 80);
    const category = String(req.query.category || '').slice(0, 80);

    const [result, categories, popular] = await Promise.all([
      content.listPublishedPosts({ page, perPage, search, category }),
      content.postCategories(),
      content.topPosts(5),
    ]);

    // A category or search that matches nothing is not a 404 - the page exists
    // and can say so, which is friendlier than an error.
    const canonical = `${res.locals.helpers.absoluteUrl('/blog')}`;

    res.render('public/blog', {
      layout: 'layouts/public',
      pageTitle: category ? `${category} articles` : 'Blog',
      lead: res.locals.seo.description,
      crumbs: [{ label: 'Blog', url: '/blog' }, category ? { label: category } : null].filter(Boolean),
      posts: result.rows,
      pager: result,
      categories,
      popular,
      search,
      category,
      seo: {
        ...res.locals.seo,
        title: category
          ? `${category} — ${res.locals.site.name} blog`
          : `Blog — ${res.locals.site.name}`,
        description:
          res.locals.seo.description ||
          `Practical writing on selling online in Bangladesh from ${res.locals.site.name}.`,
        canonical,
        robots: search ? 'noindex,follow' : res.locals.seo.robots,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * A single post.
 *
 * Everything the layout needs is gathered here rather than in the view: the
 * table of contents comes from the content itself, and the sidebar needs four
 * separate queries that are better run together than in sequence.
 */
exports.blogPost = async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const post = slug ? await content.findPostBySlug(slug) : null;

    // A draft, a future-dated post or a missing slug all look the same from
    // outside. Staff can preview their own drafts; everyone else gets a 404.
    const isPublic =
      post &&
      post.status === 'published' &&
      (!post.published_at || new Date(post.published_at) <= new Date());

    if (!post || (!isPublic && !res.locals.isStaff)) {
      return res.status(404).render('errors/404', {
        layout: 'layouts/public',
        title: 'Post not found',
        requestedPath: req.originalUrl,
      });
    }

    const { html: contentHtml, toc } = buildTableOfContents(post.content);

    const [related, popular, recent, categories] = await Promise.all([
      content.relatedPosts(post, 6),
      content.topPosts(5),
      content.recentPosts(7, post.id),
      content.postCategories(),
    ]);

    // Counting a read must never delay the page or fail it.
    if (isPublic) content.incrementPostViews(post.id).catch(() => {});

    const absolute = (value) => (value ? res.locals.helpers.absoluteUrl(value) : '');

    const canonical = post.canonical_url || absolute(`/blog/${post.slug}`);
    const shareTitle = post.og_title || post.seo_title || post.title;
    const shareDescription = post.og_description || post.seo_description || post.excerpt || '';
    const shareImage = absolute(post.og_image || post.featured_image || '');

    const readingMinutes =
      Number(post.reading_minutes) > 0 ? Number(post.reading_minutes) : estimateReadingMinutes(post.content);

    // BlogPosting + BreadcrumbList, so the article is eligible for a rich
    // result. Passed through extraHead, which is the layout's channel for
    // controller-built head markup, and escaped by helpers.jsonLd so an
    // admin-authored title containing markup cannot break out of the block.
    const schema = [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: shareDescription,
        image: shareImage ? [shareImage] : undefined,
        datePublished: post.published_at ? new Date(post.published_at).toISOString() : undefined,
        dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : undefined,
        author: post.author_name
          ? { '@type': 'Person', name: post.author_name }
          : { '@type': 'Organization', name: res.locals.site.name },
        publisher: {
          '@type': 'Organization',
          name: res.locals.site.name,
          logo: res.locals.site.logoLight
            ? { '@type': 'ImageObject', url: absolute(res.locals.site.logoLight) }
            : undefined,
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        ...(post.category ? { articleSection: post.category } : {}),
        ...(post.meta_keywords ? { keywords: post.meta_keywords } : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absolute('/') },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: absolute('/blog') },
          { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
        ],
      },
    ];

    // res.locals.helpers, not a module-level import: this controller does not
    // import helpers directly, and the escaping in jsonLd is the whole reason
    // an admin-authored title cannot break out of the script block.
    const extraHead = schema
      .map((payload) => `<script type="application/ld+json">${res.locals.helpers.jsonLd(payload)}</script>`)
      .join('\n');

    res.render('public/blog-post', {
      layout: 'layouts/public',
      pageTitle: shareTitle,
      pageDescription: shareDescription,
      pageRobots: post.robots || undefined,
      pageCanonical: canonical,
      ogType: 'article',
      ogImage: shareImage || undefined,
      extraHead,
      lead: shareDescription,
      crumbs: [{ label: 'Blog', url: '/blog' }, { label: post.title }],
      post: { ...post, content: contentHtml },
      toc,
      related,
      popular,
      recent,
      categories,
      readingMinutes,
      shareImage,
      isPreview: !isPublic,
      seo: {
        ...res.locals.seo,
        title: post.seo_title || `${post.title} — ${res.locals.site.name}`,
        description: post.seo_description || post.excerpt || res.locals.seo.description,
        keywords: post.meta_keywords || res.locals.seo.keywords,
        canonical,
        robots: post.robots || res.locals.seo.robots,
        ogImage: shareImage || res.locals.seo.ogImage,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Render a content page.
 *
 * `slug` is optional: when omitted the slug comes from the route parameter.
 * That distinction matters — `/page/:slug` was registered as
 * `staticPage()` with no argument, so this closed over `undefined`, looked up a
 * page that could not exist, and 404'd every page in the CMS while the admin
 * screens reported the content saved correctly.
 *
 * @param {string} [slug] fixed slug, for routes like /live-chat that have no
 *                        parameter of their own
 */
exports.staticPage = (slug) => async (req, res, next) => {
  try {
    const wanted = String(slug || (req.params && req.params.slug) || '').trim();
    let page = wanted ? await content.findPageBySlug(wanted) : null;

    // Ship the mandatory pages even on a fresh install where the admin has not
    // filled them in yet. Better a sensible placeholder than a 404 on a link
    // the header, footer or brief advertises.
    const fallbacks = {
        'privacy-policy': {
          title: 'Privacy Policy',
          slug: 'privacy-policy',
          meta_description: `How ${res.locals.site.name} collects, uses and protects your information.`,
          content: defaultPrivacyPolicy(res.locals),
        },
        'terms-conditions': {
          title: 'Terms & Conditions',
          slug: 'terms-conditions',
          meta_description: `The terms that apply when you use ${res.locals.site.name}.`,
          content: defaultTerms(res.locals),
        },
        'refund-policy': {
          title: 'Refund Policy',
          slug: 'refund-policy',
          meta_description: `When ${res.locals.site.name} issues refunds and how to request one.`,
          content: defaultRefundPolicy(res.locals),
        },
        'about-us': {
          title: 'About Us',
          slug: 'about-us',
          meta_description: `Who ${res.locals.site.name} is and how we build e-commerce websites in Bangladesh.`,
          content: defaultAbout(res.locals),
        },
        // The brief requires a live chat page. The widget is a global partial,
        // so this page explains it and mounts it rather than 404ing.
        'live-chat': {
          title: 'Live Chat Support',
          slug: 'live-chat',
          meta_description: `Chat with the ${res.locals.site.name} team about your project, pricing or support.`,
          content: defaultLiveChat(res.locals),
        },
    };

    // A stored page with no body is not a page - it is an empty shell that
    // shadows the built-in default, because the row exists so the fallback
    // never runs. That is exactly how the Terms page came to render a heading
    // with nothing underneath it.
    //
    // Anything the operator DID fill in is kept - title, meta description,
    // canonical - and only the missing body comes from the default.
    const stored = page;
    const fallback = fallbacks[wanted];
    const hasBody = stored && String(stored.content || '').trim();

    if (fallback && !hasBody) {
      const filled = Object.fromEntries(
        Object.entries(stored || {}).filter(([, value]) => String(value === null || value === undefined ? '' : value).trim())
      );

      page = { ...fallback, ...filled, content: fallback.content, updated_at: (stored && stored.updated_at) || new Date() };
    }

    if (!page) {
      return res.status(404).render('errors/404', {
        layout: 'layouts/public',
        title: 'Page not found',
        requestedPath: req.originalUrl,
      });
    }

    // Absolute URLs for the canonical and share tags: relative paths are
    // invalid in Open Graph and are ignored by crawlers.
    const absolute = (value) => (value ? res.locals.helpers.absoluteUrl(value) : '');

    const canonical = page.canonical_url || absolute(`/page/${page.slug}`);

    // Fallback chain, most specific first: a field set for sharing, then the
    // SEO field, then the page's own content. Each step is something a person
    // deliberately typed, so the last resort is the only guess.
    const shareTitle = page.og_title || page.meta_title || page.title;
    const shareDescription = page.og_description || page.meta_description || res.locals.seo.description;
    const shareImage = absolute(page.og_image || page.featured_image || '');

    res.render('public/page', {
      layout: 'layouts/public',
      pageTitle: shareTitle,
      pageDescription: shareDescription,
      pageRobots: page.robots || undefined,
      pageCanonical: canonical,
      ogType: 'article',
      ogImage: shareImage || undefined,
      lead: page.meta_description,
      crumbs: [{ label: page.title }],
      page,
      seo: {
        ...res.locals.seo,
        title: page.meta_title || `${page.title} - ${res.locals.site.name}`,
        description: page.meta_description || res.locals.seo.description,
        keywords: page.meta_keywords || res.locals.seo.keywords,
        canonical,
        robots: page.robots || res.locals.seo.robots,
        ogImage: shareImage || res.locals.seo.ogImage,
      },
    });
  } catch (err) {
    next(err);
  }
};

function defaultPrivacyPolicy({ site }) {
  return `
<p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

<h3>1. Who we are</h3>
<p>${site.name} is a website design and development agency located at ${site.address}. You can reach us at
<a href="mailto:${site.email}">${site.email}</a> or ${site.phone}.</p>

<h3>2. Information we collect</h3>
<p>We collect information you give us directly, including your name, email address, phone number, company name
and the contents of any message or support ticket you send us. When you place an order we also collect the
project details you provide.</p>

<h3>3. Payment information</h3>
<p>When you pay by bKash, Nagad or Rocket, you submit a transaction ID and the mobile number used to send the
payment. We use this only to verify that payment was received. We do not collect or store your PIN, OTP, card
number or any other payment credential.</p>

<h3>4. How we use your information</h3>
<p>We use your information to respond to enquiries, deliver the services you order, issue invoices, provide
support, and send you transactional messages about your account. With your consent we may also send occasional
service updates.</p>

<h3>5. Sharing</h3>
<p>We do not sell your personal information. We share it only with service providers who help us operate —
for example our hosting provider and email delivery service — and only to the extent necessary.</p>

<h3>6. Cookies and sessions</h3>
<p>We use a session cookie to keep you signed in and a local storage entry to remember your colour theme
preference. We use Google reCAPTCHA on our sign-in, sign-up and contact forms to prevent automated abuse.</p>

<h3>7. Data retention</h3>
<p>We retain account and order records for as long as your account is active and for a reasonable period
afterwards to meet accounting and legal obligations.</p>

<h3>8. Your rights</h3>
<p>You may request a copy of the information we hold about you, ask us to correct it, or ask us to delete
your account. Email <a href="mailto:${site.email}">${site.email}</a> and we will respond within 30 days.</p>

<h3>9. Security</h3>
<p>We protect your information with encrypted connections (HTTPS), hashed passwords, restricted admin access
and regular software updates. No system is perfectly secure, but we take these obligations seriously.</p>

<h3>10. Changes</h3>
<p>We may update this policy from time to time. Material changes will be announced on this page with a new
"last updated" date.</p>
`;
}

function defaultTerms({ site }) {
  return `
<p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

<h3>1. Agreement</h3>
<p>By using ${site.name} and ordering our services you agree to these terms. If you do not agree, please do
not use the site.</p>

<h3>2. Services</h3>
<p>We design and develop websites and e-commerce stores. The specific scope of your project is defined by the
package you order plus any written variation we agree with you. Anything not listed in the package description
is out of scope.</p>

<h3>3. Orders and payment</h3>
<p>An order is confirmed once we receive payment or an agreed deposit. We accept bKash, Nagad, Rocket and card
payments. Manual wallet transfers are verified within 24 hours; work begins once payment is confirmed.</p>

<h3>4. Delivery</h3>
<p>Delivery times stated on each package are estimates from the date we receive both payment and all content
required from you. Delays caused by late content, feedback or approvals from your side extend the timeline
accordingly.</p>

<h3>5. Revisions</h3>
<p>Each package includes a stated number of revision rounds during the design stage. Requests that change the
agreed scope after design approval may be quoted separately.</p>

<h3>6. Your responsibilities</h3>
<p>You confirm that any text, images, logos or product data you supply are yours to use, and that your business
and products comply with Bangladeshi law. You are responsible for the accuracy of the information published on
your website.</p>

<h3>7. Refunds</h3>
<p>Because our work is bespoke, refunds are considered on a case-by-case basis. If we have not started work,
we refund in full. Once design or development has begun, we refund the unused portion of the agreed fee.</p>

<h3>8. Recurring services</h3>
<p>Where a package includes an ongoing subscription — hosting, maintenance or support — it renews automatically
at the stated interval until cancelled. You may cancel at any time and the service continues to the end of the
paid period.</p>

<h3>9. Intellectual property</h3>
<p>On full payment, ownership of the final website design and the delivered source files transfers to you. We
retain the right to display the completed work in our portfolio unless you ask us in writing not to.</p>

<h3>10. Support</h3>
<p>Support covers defects in what we built. It does not cover changes you make yourself, third-party plugin
conflicts introduced after handover, or new feature requests, which are quoted separately.</p>

<h3>11. Limitation of liability</h3>
<p>Our total liability for any claim is limited to the amount you paid us for the service in question. We are
not liable for indirect or consequential losses, including lost profits or lost data.</p>

<h3>12. Governing law</h3>
<p>These terms are governed by the laws of Bangladesh, and disputes are subject to the jurisdiction of the
courts of Rangpur.</p>

<h3>13. Contact</h3>
<p>Questions about these terms? Email <a href="mailto:${site.email}">${site.email}</a> or call ${site.phone}.</p>
`;
}

function defaultRefundPolicy({ site }) {
  return `
<p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

<h3>1. Before work begins</h3>
<p>If you cancel before we have started any work on your order, you receive a full refund of the amount paid, less any
payment processing fee charged to us by the gateway.</p>

<h3>2. After work has started</h3>
<p>If we have begun design or development we retain payment for the work completed and refund the remainder. As a
guide, the design phase carries 40% of project value, the build phase 80%, and delivery 100%. We will show you the
work delivered to date.</p>

<h3>3. After delivery</h3>
<p>Once your website has been delivered and your credentials published in your dashboard, the fee is non-refundable.
If something is broken or differs from the agreed scope we will fix it at no cost.</p>

<h3>4. Recurring plans</h3>
<p>Care Plans, SEO packages and marketing retainers renew monthly and may be cancelled at any time from your
dashboard. Cancellation takes effect at the end of the current billing period.</p>

<h3>5. Non-refundable situations</h3>
<ul>
<li>A completed project you have received and used</li>
<li>Delays caused by you not supplying content, product data or hosting access</li>
<li>Change of mind after approving a design in the revision stage</li>
<li>Third-party failures, such as a payment gateway suspending your merchant account</li>
</ul>

<h3>6. How to request a refund</h3>
<p>Open a support ticket from your dashboard under the Billing department, or email
<a href="mailto:${site.email}">${site.email}</a> with your order number. We acknowledge every request within one
business day and issue a decision within five.</p>

<h3>7. How refunds are paid</h3>
<p>Approved refunds are returned by the method you paid with, within seven business days of approval.</p>

<h3>8. Contact</h3>
<p>Questions? Email <a href="mailto:${site.email}">${site.email}</a> or call ${site.phone}.</p>
`;
}

function defaultAbout({ site }) {
  return `
<p>${site.name} builds e-commerce websites for Bangladeshi businesses - the kind that take real orders, accept
bKash, and survive a Friday-night traffic spike.</p>

<p>We started in Rangpur after watching too many good local businesses lose sales to a website that never worked
properly. A store owner would pay for a site, wait three months, receive something slow and broken, and go back to
selling through Facebook Messenger. We thought that was a fixable problem.</p>

<h3>How we work</h3>
<p>Our approach is different in one specific way: we hand over everything. When your website goes live, your cPanel
URL, admin credentials and database details appear in your own dashboard. You are never locked in, never dependent
on us to make a text change, and never held hostage over a domain. If you leave, you leave with everything.</p>

<h3>What we build</h3>
<p>Online stores with bKash, Nagad, Rocket and card payments. Business websites that generate leads. Care plans that
keep a site updated, backed up and monitored. And the SEO and marketing work that turns a working website into one
that actually gets found.</p>

<h3>Contact us</h3>
<p>We are at ${site.address}. Email <a href="mailto:${site.email}">${site.email}</a>, call ${site.phone}, or start a
live chat - we usually reply within a few hours during office hours.</p>
`;
}

function defaultLiveChat({ site, helpers }) {
  return `
<p>Our live chat assistant is the fastest way to get a straight answer about your project. Ask about pricing,
delivery timelines, payment methods, or what a package includes - you will get a reply immediately, and a human
follows up on anything the assistant cannot settle.</p>

<h3>What the assistant can help with</h3>
<ul>
<li><strong>Pricing and packages</strong> - what each package costs and what is included</li>
<li><strong>Delivery times</strong> - how long your build will take</li>
<li><strong>Payments</strong> - bKash, Nagad, Rocket, bank transfer and card</li>
<li><strong>Hosting and domains</strong> - whether you need to buy them separately</li>
<li><strong>Post-launch support</strong> - what happens after your site goes live</li>
<li><strong>Care Plans and SEO</strong> - ongoing maintenance and marketing options</li>
</ul>

<h3>When to use a support ticket instead</h3>
<p>If you are an existing customer and need something changed on your account, an existing order updated, or a
payment verified, open a support ticket from your dashboard. Tickets create a tracked record with your order
attached, which chat does not.</p>

<h3>Reach a human</h3>
<p>During office hours you can also message us directly on WhatsApp at ${site.phone},
email <a href="mailto:${site.email}">${site.email}</a>, or use the
<a href="${helpers.url('/contact')}">contact form</a>. We are at ${site.address}.</p>

<p><strong>Tap the chat button in the bottom right corner to start.</strong></p>
`;
}

// ---------------------------------------------------------------------------
// Newsletter & chat
// ---------------------------------------------------------------------------

exports.newsletterSubscribe = async (req, res, next) => {
  try {
    const email = clean.email(req.body.email);
    const emailError = validate.email(email);

    if (emailError) {
      if (req.xhr) return res.status(400).json({ ok: false, message: emailError });
      req.session.flashError = emailError;
      return res.redirect(req.get('referer') || res.locals.helpers.url('/'));
    }

    const result = await orders.subscribeNewsletter(email);

    if (req.xhr) {
      return res.json({
        ok: true,
        message: result.created ? 'You are subscribed. Thank you!' : 'You are already on the list.',
      });
    }

    req.session.flashSuccess = result.created
      ? 'Thank you for subscribing — we will be in touch.'
      : 'You are already subscribed.';
    return res.redirect(req.get('referer') || res.locals.helpers.url('/'));
  } catch (err) {
    next(err);
  }
};

exports.chatMessage = async (req, res) => {
  const chat = require('../services/chat.service');

  try {
    const message = clean.text(req.body.message, 1000);

    if (!message) {
      return res.status(400).json({ ok: false, message: 'Please type a message first.' });
    }

    if (!chat.isEnabled()) {
      return res.status(503).json({
        ok: false,
        message: `Our assistant is offline right now. Please reach us on WhatsApp at ${res.locals.site.whatsapp} or email ${res.locals.site.email}.`,
      });
    }

    const conversation = await chat.ensureConversation({
      sessionToken: clean.str(req.body.session_token, 64),
      customerId: res.locals.customer ? res.locals.customer.id : null,
      visitorIp: req.ip,
      pageUrl: clean.str(req.body.page_url, 500),
    });

    await chat.appendMessage(conversation.id, 'user', message);

    const result = await chat.ask({
      conversationId: conversation.id,
      message,
      customerName: res.locals.customer ? res.locals.customer.name : null,
    });

    if (!result.ok) {
      // Store the failure as a system note so the transcript shows what happened,
      // but do not surface it as an assistant message.
      await chat.appendMessage(conversation.id, 'system', `delivery_failed: ${result.error}`);
      return res.status(502).json({ ok: false, message: result.error, session_token: conversation.session_token });
    }

    await chat.appendMessage(conversation.id, 'assistant', result.reply);

    return res.json({
      ok: true,
      message: result.reply,
      session_token: conversation.session_token,
    });
  } catch (err) {
    logger.error('Chat endpoint failed', err);
    return res.status(500).json({
      ok: false,
      message: 'Something went wrong on our side. Please try again or message us on WhatsApp.',
    });
  }
};

exports.clearCache = clearCache;
