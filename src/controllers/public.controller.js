/**
 * Public site controller: homepage, about, packages, portfolio, contact and
 * the legal pages.
 *
 * All of these are read-heavy and cached at the HTTP layer, so they stay cheap
 * under traffic.
 */
'use strict';

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
    const [services, portfolio, testimonials, faqs, clients] = await Promise.all([
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
    if (!page) {
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
          content: defaultLiveChat(res.locals),        },
      };
      page = fallbacks[wanted];
      if (page) page.updated_at = new Date();
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
