#!/usr/bin/env node
/**
 * WooBD.Com - database installer and seeder.
 *
 * Idempotent by design: every statement is CREATE TABLE IF NOT EXISTS and every
 * seed uses INSERT IGNORE or a "skip if present" guard, so running it twice is
 * a no-op rather than a duplicate-content generator. Re-running after a deploy
 * is the intended way to pick up newly-declared settings.
 *
 * Usage:
 *   node scripts/setup.js                 # schema + settings + staff + demo
 *   node scripts/setup.js --schema        # schema only
 *   node scripts/setup.js --settings      # schema + settings defaults
 *   node scripts/setup.js --staff         # schema + settings + staff accounts
 *   node scripts/setup.js --no-demo       # everything except demo content
 *   node scripts/setup.js --demo          # skip staff, add demo content only
 *   node scripts/setup.js --force-demo    # wipe demo tables first, then reseed
 *   node scripts/setup.js --dry-run       # print the plan, touch nothing
 *   node scripts/setup.js --reset         # DROP and recreate every app table
 *   node scripts/setup.js --docker        # wait for MySQL, then install
 *
 * --reset is destructive and is guarded by a confirmation unless --yes is
 * also passed. It drops only the tables this application owns.
 *
 * This script never drops a user table and never deletes real content unless
 * --reset or --force-demo is passed explicitly.
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const has = (...names) => names.some((n) => args.has(n));

const DRY_RUN = has('--dry-run');
const FORCE_DEMO = has('--force-demo');
const RESET = has('--reset');
const DOCKER = has('--docker');
const ASSUME_YES = has('--yes', '-y');

// Default: run everything. An explicit stage flag narrows the run.
const STAGE_FLAGS = ['--schema', '--settings', '--staff', '--demo'];
const narrow = STAGE_FLAGS.filter((f) => args.has(f));
const runSchema = !narrow.length || args.has('--schema');
const runSettings = !narrow.length || args.has('--settings') || args.has('--staff');
const runStaff = !narrow.length || args.has('--staff');
const runDemo = args.has('--demo') || (!narrow.length && !args.has('--no-demo'));

// --------------------------------------------------------------------------
// Seed data
// --------------------------------------------------------------------------

const STAFF = [
  {
    name: 'Md Shojib Miya',
    username: 'mdshojibmiya',
    email: 'hello@woobd.com',
    role: 'admin',
    phone: '+8801789668276',
  },
  {
    name: 'Romen Roy',
    username: 'romenroy',
    email: 'manager@woobd.com',
    role: 'manager',
    phone: null,
  },
  {
    name: 'Md Mehedi Hasan',
    username: 'mehedihasan',
    email: 'editor@woobd.com',
    role: 'editor',
    phone: null,
  },
];

/**
 * The password every seeded account starts with.
 *
 * SEED_PASSWORD is the documented name. SEED_ADMIN_PASSWORD is accepted too,
 * because earlier revisions of .env.example used it and an existing
 * deployment's environment should not silently stop working.
 *
 * There is deliberately NO hardcoded fallback. A committed default would be the
 * same string in every checkout of this repository - and this file is public -
 * so it would hand the admin panel to anyone who read it. When the variable is
 * absent a random password is generated and printed once, which is both safe
 * and obvious.
 *
 * Quote it in .env: an unquoted `#` starts a comment, so
 *   SEED_PASSWORD=abc#def   becomes "abc"
 * and the seeded accounts get a password nobody knows.
 */
const crypto = require('crypto');

const SEED_PASSWORD =
  process.env.SEED_PASSWORD ||
  process.env.SEED_ADMIN_PASSWORD ||
  `WooBD-${crypto.randomBytes(9).toString('base64url')}`;

const SEED_PASSWORD_IS_GENERATED =
  !process.env.SEED_PASSWORD && !process.env.SEED_ADMIN_PASSWORD;

const CATEGORIES = [
  { name: 'E-commerce', slug: 'ecommerce', icon: 'cart', description: 'Online stores built to sell - catalogue, checkout and payments.' },
  { name: 'Business Website', slug: 'business-website', icon: 'briefcase', description: 'Corporate and service sites that build trust and generate leads.' },
  { name: 'Care & Maintenance', slug: 'care-maintenance', icon: 'shield', description: 'Ongoing support, updates, backups and performance monitoring.' },
  { name: 'Marketing', slug: 'marketing', icon: 'trending-up', description: 'SEO, ad campaigns and conversion work that compounds.' },
];

/**
 * Package catalogue. Prices are in BDT, matching settings.currency_code.
 * `cycles` is expanded into the JSON `features` payload the pricing cards read.
 */
/**
 * Package catalogue. Prices are in BDT, matching settings.currency_code.
 *
 * WooCommerce web design packages are billed monthly with a three-month
 * minimum, and a 10% discount if the customer pays for a year up front.
 * `min_months` and `yearly_discount_percent` drive both.
 */
const SERVICES = [
  {
    title: 'WooCommerce Web Design — Starter',
    slug: 'woocommerce-web-design-starter',
    category: 'ecommerce',
    price: 999,
    sale_price: null,
    billing_cycle: 'monthly',
    min_months: 3,
    yearly_discount: 10,
    delivery_days: 7,
    featured: 1,
    short: 'A complete WooCommerce store for a new seller — live in a week, from ৳999 a month.',
    description:
      '<p>Our entry WooCommerce package gets a real, working storefront online in about a week. We install WordPress and WooCommerce, configure a responsive theme, and set up the Bangladeshi payment methods your customers actually use.</p><p>Billed monthly with a three-month minimum, so you are not locked into a year before you know it works. Pay for twelve months up front and you save 10%.</p>',
    features: [
      'WordPress + WooCommerce installation',
      'Responsive store theme configured',
      'Up to 50 products uploaded',
      'bKash / Nagad / Rocket payment setup',
      'Cash on delivery configuration',
      'SSL certificate installation',
      'Contact form with email delivery',
      'Basic on-page SEO',
      'WhatsApp order button',
      'Email support within 24 hours',
      'Minimum 3-month plan',
    ],
  },
  {
    title: 'WooCommerce Web Design — Business',
    slug: 'woocommerce-web-design-business',
    category: 'ecommerce',
    price: 2499,
    sale_price: null,
    billing_cycle: 'monthly',
    min_months: 3,
    yearly_discount: 10,
    delivery_days: 14,
    featured: 1,
    short: 'A custom-designed WooCommerce store for a growing brand — up to 300 products, courier integration and marketing automation.',
    description:
      '<p>Our most popular build. A storefront designed around your brand rather than a stock theme, with the payment, delivery and marketing plumbing that turns visitors into repeat buyers.</p><p>Delivery is phased: design sign-off in week one, store build in week two, then training and handover. Billed monthly with a three-month minimum; pay for a year and save 10%.</p>',
    features: [
      'Everything in the Starter package',
      'Custom UI design (not a stock theme)',
      'Up to 300 products uploaded',
      'Full payment gateway integration',
      'Courier / delivery API integration',
      'Customer accounts and order tracking',
      'Coupon, offer and discount engine',
      'Meta Pixel + Google Analytics setup',
      'Facebook Shop catalogue sync',
      'Abandoned cart recovery',
      'Invoice and packing slip templates',
      'Priority support within 12 hours',
      'Minimum 3-month plan',
    ],
  },
  {
    title: 'WooCommerce Web Design — Premium',
    slug: 'woocommerce-web-design-premium',
    category: 'ecommerce',
    price: 4999,
    sale_price: null,
    billing_cycle: 'monthly',
    min_months: 3,
    yearly_discount: 10,
    delivery_days: 21,
    featured: 1,
    short: 'A high-volume WooCommerce store with custom development, integrations and dedicated infrastructure.',
    description:
      '<p>For catalogues past a thousand SKUs, multi-vendor marketplaces, or stores where a custom integration is unavoidable. Scoped individually — the list below is the typical shape, not a fixed promise.</p><p>Includes a dedicated staging environment so your live store is never touched during development, and a monthly strategy call. Billed monthly with a three-month minimum; pay for a year and save 10%.</p>',
    features: [
      'Everything in the Business package',
      'Up to 1,000 products uploaded',
      'Multi-vendor marketplace support',
      'Custom plugin / feature development',
      'ERP or inventory system integration',
      'Multi-currency and multi-language',
      'Advanced analytics dashboard',
      'Dedicated staging environment',
      'Speed and load optimisation',
      'Automated daily backups',
      'Staff training session',
      'Monthly strategy call',
      'Priority support within 4 hours',
      'Minimum 3-month plan',
    ],
  },
  {
    title: 'Website Care Plan - Basic',
    slug: 'website-care-plan-basic',
    category: 'care-maintenance',
    price: 2500,
    billing_cycle: 'monthly',
    delivery_days: 1,
    featured: 0,
    short: 'Keep your site updated, backed up and online - without thinking about it.',
    description:
      '<p>Most breaches and outages are preventable and boring: an unpatched plugin, a full disk, a lapsed SSL. This plan handles the boring parts on a schedule.</p>',
    features: [
      'Weekly core and plugin updates',
      'Daily automated backups (30-day retention)',
      'Uptime monitoring with alerts',
      'SSL renewal management',
      'Security scanning and malware removal',
      'Monthly health report by email',
      '1 hour of content edits per month',
      'Email support within 24 hours',
    ],
  },
  {
    title: 'Website Care Plan - Business',
    slug: 'website-care-plan-business',
    category: 'care-maintenance',
    price: 5500,
    billing_cycle: 'monthly',
    delivery_days: 1,
    featured: 1,
    short: 'Everything in Basic plus performance work, priority support and monthly content updates.',
    description:
      '<p>For stores where downtime directly costs sales. Includes a monthly performance and conversion review, not just maintenance.</p>',
    features: [
      'Everything in Basic plan',
      'Daily backups (90-day retention)',
      'Speed optimisation each month',
      'Image and database cleanup',
      'Up to 5 hours content edits per month',
      'Product uploads (up to 50 per month)',
      'Priority email and WhatsApp support',
      'Same-day emergency response',
      'Monthly analytics report',
      'Quarterly strategy call',
    ],
  },
  {
    title: 'SEO Growth Package',
    slug: 'seo-growth-package',
    category: 'marketing',
    price: 12000,
    billing_cycle: 'monthly',
    delivery_days: 30,
    featured: 1,
    short: 'Technical SEO, keyword targeting and content built to rank for buying-intent searches.',
    description:
      '<p>We start with a technical audit and a keyword map, then work outward: fix what blocks indexing, target the terms your buyers actually type, and build the authority to hold those positions.</p><p>Reporting is monthly and shows ranking movement per keyword, not vanity traffic numbers.</p>',
    features: [
      'Full technical SEO audit',
      'Keyword research and mapping',
      'On-page optimisation (10 pages/month)',
      'Meta title and description rewrite',
      'Schema markup implementation',
      'Google Search Console management',
      'Broken link and redirect fixes',
      'Blog content (2 articles/month)',
      'Backlink outreach (5 links/month)',
      'Competitor gap analysis',
      'Monthly ranking report',
      'Google My Business optimisation',
    ],
  },
  {
    title: 'Google Ads Management',
    slug: 'google-ads-management',
    category: 'marketing',
    price: 15000,
    billing_cycle: 'monthly',
    delivery_days: 7,
    featured: 0,
    short: 'Search and Shopping campaigns managed for return on ad spend, not clicks.',
    description:
      '<p>Campaign structure, negative keyword discipline and conversion tracking that actually attributes sales. We report on cost per acquisition, and we will tell you when a channel is not worth the budget.</p>',
    features: [
      'Account audit and restructuring',
      'Search campaign build',
      'Shopping campaign setup',
      'Keyword and negative keyword research',
      'Ad copy writing and A/B testing',
      'Conversion tracking implementation',
      'Landing page recommendations',
      'Bid strategy optimisation',
      'Weekly optimisation pass',
      'Monthly performance report',
    ],
  },
  {
    title: 'Social Media Marketing',
    slug: 'social-media-marketing',
    category: 'marketing',
    price: 9000,
    billing_cycle: 'monthly',
    delivery_days: 5,
    featured: 0,
    short: 'Content, scheduling and community management for Facebook, Instagram and TikTok.',
    description:
      '<p>A consistent posting rhythm with creative built for the platform, plus reply management so no customer message sits unanswered over a weekend.</p>',
    features: [
      'Content calendar (20 posts/month)',
      'Graphic design for each post',
      'Short-form video editing (4 reels)',
      'Caption and hashtag research',
      'Scheduling and publishing',
      'Comment and DM management',
      'Facebook Shop product tagging',
      'Paid boost campaign setup',
      'Monthly engagement report',
    ],
  },
  {
    title: 'Conversion Rate Optimisation',
    slug: 'conversion-rate-optimisation',
    category: 'marketing',
    price: 18000,
    billing_cycle: 'monthly',
    delivery_days: 14,
    featured: 0,
    short: 'Turn the traffic you already have into more orders - through testing, not guessing.',
    description:
      '<p>We instrument the funnel, find where people drop, and test fixes one variable at a time. Every change ships with a hypothesis and a measured result.</p>',
    features: [
      'Funnel and heatmap analysis',
      'Session recording review',
      'Checkout flow audit',
      'Hypothesis backlog creation',
      'A/B test implementation',
      'Product page optimisation',
      'Cart abandonment analysis',
      'Trust signal placement review',
      'Mobile experience fixes',
      'Bi-weekly test result report',
    ],
  },
];

const PORTFOLIO = [
  {
    title: 'Rangpur Fashion House',
    slug: 'rangpur-fashion-house',
    client: 'Rangpur Fashion House',
    category: 'Fashion & Apparel',
    short: 'A 900-SKU clothing store that consolidated four Facebook pages into one storefront.',
    description:
      '<p>Rangpur Fashion House was selling entirely through Facebook Messenger, with order details living in a notebook. We built a WooCommerce store with size and colour variations, integrated bKash and Nagad, and connected a courier API so orders ship the same day they are placed.</p><p>Within four months, 62% of orders came through the website rather than Messenger, and the manual order-entry work disappeared.</p>',
    technologies: ['WordPress', 'WooCommerce', 'bKash', 'Pathao API'],
    completed: '2024-08-15',
    featured: 1,
  },
  {
    title: 'Dhaka Electronics Mart',
    slug: 'dhaka-electronics-mart',
    client: 'Dhaka Electronics Mart',
    category: 'Electronics',
    short: 'Multi-brand electronics store with warranty tracking and EMI checkout.',
    description:
      '<p>A high-ticket electronics retailer needed customers to trust a BDT 80,000 purchase to a website. We added serial-number warranty registration, an EMI calculator on every product page, and a comparison tool for competing models.</p>',
    technologies: ['WordPress', 'WooCommerce', 'Custom plugin', 'SSLCommerz'],
    completed: '2024-05-02',
    featured: 1,
  },
  {
    title: 'Chittagong Agro Supplies',
    slug: 'chittagong-agro-supplies',
    client: 'Chittagong Agro Supplies',
    category: 'Agriculture',
    short: 'B2B ordering portal for agricultural inputs, with dealer pricing tiers.',
    description:
      '<p>Dealers needed to see their own negotiated prices, not retail ones. We built role-based pricing tiers, bulk order upload via CSV, and a credit-terms checkout that issues an invoice instead of taking payment online.</p>',
    technologies: ['WordPress', 'WooCommerce B2B', 'Custom roles'],
    completed: '2024-11-20',
    featured: 0,
  },
  {
    title: 'Sylhet Tea Collective',
    slug: 'sylhet-tea-collective',
    client: 'Sylhet Tea Collective',
    category: 'Food & Beverage',
    short: 'Subscription tea delivery for a cooperative of twelve growers.',
    description:
      '<p>A recurring-revenue build: customers subscribe to a monthly box, choose their blend profile, and can pause from their own dashboard. The twelve member growers each get a sales report for their own lots.</p>',
    technologies: ['WordPress', 'WooCommerce Subscriptions', 'bKash'],
    completed: '2025-01-10',
    featured: 1,
  },
  {
    title: 'Khulna Home Decor',
    slug: 'khulna-home-decor',
    client: 'Khulna Home Decor',
    category: 'Home & Living',
    short: 'Visual-first furniture store with room-view browsing and delivery scheduling.',
    description:
      '<p>Furniture is bought with the eye. We built a lookbook-driven catalogue where shoppers browse by room, plus a delivery slot picker that respects the store\'s two-truck routing constraint.</p>',
    technologies: ['WordPress', 'WooCommerce', 'Custom lookbook'],
    completed: '2024-09-28',
    featured: 0,
  },
  {
    title: 'Bogra Sports Gear',
    slug: 'bogra-sports-gear',
    client: 'Bogra Sports Gear',
    category: 'Sports',
    short: 'Performance-optimised store that cut load time from 6.1s to 1.4s.',
    description:
      '<p>The client came to us with a slow store and a high bounce rate, not a redesign request. We rebuilt the hosting stack, converted images to WebP, removed four abandoned plugins, and added object caching. Load time dropped from 6.1s to 1.4s and mobile conversion nearly doubled.</p>',
    technologies: ['WordPress', 'Redis', 'WebP', 'LiteSpeed'],
    completed: '2025-02-18',
    featured: 0,
  },
];

const TESTIMONIALS = [
  {
    name: 'Ariful Islam',
    designation: 'Founder',
    company: 'Rangpur Fashion House',
    rating: 5,
    message:
      'We were running our whole business from Facebook messages before WooBD. Now orders come in through the site, payments land in bKash automatically, and I can see my stock without opening a notebook. The handover was the part that surprised me - they showed me how to run it myself instead of keeping me dependent.',
  },
  {
    name: 'Nusrat Jahan',
    designation: 'Managing Director',
    company: 'Dhaka Electronics Mart',
    rating: 5,
    message:
      'Selling a BDT 80,000 product online in Bangladesh takes trust, and they understood that immediately. The warranty registration and EMI calculator were their ideas, not ours. Our average order value went up 34% after launch.',
  },
  {
    name: 'Rezaul Karim',
    designation: 'Operations Head',
    company: 'Chittagong Agro Supplies',
    rating: 5,
    message:
      'Our dealers order in bulk with their own pricing. Every other agency we spoke to said that needed a custom system and quoted us three months. WooBD delivered the portal in four weeks and trained our office staff on it.',
  },
  {
    name: 'Tahmina Akter',
    designation: 'Cooperative Manager',
    company: 'Sylhet Tea Collective',
    rating: 4,
    message:
      'The subscription setup works exactly as described. Twelve growers can each log in and see their own sales. Support has been responsive - when we asked for a change to the pause flow, it was done within two days.',
  },
  {
    name: 'Shahidul Haque',
    designation: 'Owner',
    company: 'Bogra Sports Gear',
    rating: 5,
    message:
      'I did not want a new website, I wanted my old one to stop being slow. They diagnosed the real problem - bad hosting and too many plugins - and fixed it without charging me for a redesign I did not need. That honesty is rare.',
  },
  {
    name: 'Farhana Yasmin',
    designation: 'Marketing Lead',
    company: 'Khulna Home Decor',
    rating: 5,
    message:
      'The lookbook browsing was their suggestion and it changed how customers shop with us. People browse three or four rooms in a session now instead of one product. Delivery scheduling cut our failed deliveries almost in half.',
  },
];

const FAQS = [
  {
    question: 'How long does it take to build my e-commerce website?',
    answer:
      'A Starter store is typically live within 7 working days of receiving your product data and hosting details. A Business build takes around 14 days, and Enterprise projects run 30 days or more depending on integration scope. We confirm the timeline in writing before starting, and you get a phase-by-phase update so you are never guessing where things stand.',
  },
  {
    question: 'How much does a website cost in Bangladesh?',
    answer:
      'Our packages start at ৳11,900 for a single-page landing site and ৳19,900 for a full Starter e-commerce store. The right number depends on how many products you have, which payment methods you need, and whether you want custom design or a configured premium theme. Every package page on this site lists the exact price and what is included - no hidden line items.',
  },
  {
    question: 'Do you integrate bKash, Nagad and Rocket payments?',
    answer:
      'Yes. bKash, Nagad and Rocket are supported on every e-commerce package, along with cash on delivery and card payments through SSLCommerz. We handle the merchant account setup walkthrough and test a live transaction with you before handover, so you know money actually arrives.',
  },
  {
    question: 'Will I own my website and have full access?',
    answer:
      'Completely. On activation we hand over your cPanel URL, website admin URL, admin username and password, and database name directly inside your customer dashboard. You own the hosting, the domain and every file. We do not hold your site hostage, and you are free to move it to another developer at any time.',
  },
  {
    question: 'Do you provide hosting and a domain name?',
    answer:
      'We will set up hosting and register your domain for you, or configure a host you already own. Hosting and domain fees are paid to the provider, not to us - we do not mark them up. If you already have hosting, we simply need the cPanel access to begin.',
  },
  {
    question: 'What happens after my website goes live?',
    answer:
      'Every package includes a post-launch support window - 7 days on Starter, up to 90 days on Enterprise. After that, our monthly Care Plans cover updates, backups, security scanning and content edits from ৳2,500 per month. You can cancel a Care Plan at any time from your dashboard.',
  },
  {
    question: 'Can I update the website content myself?',
    answer:
      'Yes, that is the point of building on WordPress. Every package ships with a CMS and we record a walkthrough session showing you how to add products, edit pages and process orders. If you would rather not touch it, our Care Plans include monthly content edits.',
  },
  {
    question: 'Do you work with clients outside Rangpur?',
    answer:
      'We are based in Rangpur but work with clients across Bangladesh and abroad - Dhaka, Chittagong, Sylhet, Khulna and beyond. The entire process runs over WhatsApp, email and video calls. You will never need to visit our office, though you are welcome to.',
  },
  {
    question: 'What if I need changes after the site is delivered?',
    answer:
      'Minor adjustments within the agreed scope are free during your support window. Larger changes are quoted separately before any work begins - you will always approve a number first. Nothing is ever invoiced without your written go-ahead.',
  },
  {
    question: 'Is SEO included in the website packages?',
    answer:
      'Every package includes on-page SEO: clean URL structure, meta titles and descriptions, schema markup, sitemap submission and Google Search Console setup. Ongoing off-page SEO, content and link building are part of the separate monthly SEO Growth Package.',
  },
];

const CLIENTS = [
  'Rangpur Fashion House',
  'Dhaka Electronics Mart',
  'Chittagong Agro Supplies',
  'Sylhet Tea Collective',
  'Khulna Home Decor',
  'Bogra Sports Gear',
  'Rajshahi Textiles',
  'Mymensingh Pharma',
];

/**
 * Header navigation. `children` become a dropdown under the parent item - the
 * header and mobile-menu partials both render them.
 */
const HEADER_MENU = [
  { label: 'Home', url: '/', sort: 0 },
  {
    label: 'Services',
    url: '/services',
    sort: 1,
    children: [
      { label: 'WooCommerce Starter Store', url: '/services/woocommerce-web-design-starter', icon: 'shopping-cart' },
      { label: 'WooCommerce Business Store', url: '/services/woocommerce-web-design-business', icon: 'briefcase' },
      { label: 'WooCommerce Premium Store', url: '/services/woocommerce-web-design-premium', icon: 'trending-up' },
      { label: 'Website Care Plans', url: '/services/website-care-plan-basic', icon: 'shield' },
      { label: 'SEO & Marketing', url: '/services/seo-growth-package', icon: 'grid' },
      { label: 'All services', url: '/services', icon: 'layout' },
    ],
  },
  { label: 'Portfolio', url: '/portfolio', sort: 2 },
  { label: 'About', url: '/about', sort: 3 },
  { label: 'Contact', url: '/contact', sort: 4 },
];

const FOOTER_QUICK = [
  { label: 'Home', url: '/' },
  { label: 'About Us', url: '/about' },
  { label: 'Services', url: '/services' },
  { label: 'Portfolio', url: '/portfolio' },
  { label: 'Live Chat', url: '/live-chat' },
  { label: 'Contact', url: '/contact' },
];

const FOOTER_SERVICES = [
  { label: 'WooCommerce Starter Store', url: '/services/woocommerce-web-design-starter' },
  { label: 'WooCommerce Business Store', url: '/services/woocommerce-web-design-business' },
  { label: 'WooCommerce Premium Store', url: '/services/woocommerce-web-design-premium' },
  { label: 'Website Care Plan', url: '/services/website-care-plan-basic' },
  { label: 'SEO Services', url: '/services/seo-growth-package' },
  { label: 'Google Ads Management', url: '/services/google-ads-management' },
];

const FOOTER_INFO = [
  { label: 'Privacy Policy', url: '/privacy-policy' },
  { label: 'Terms & Conditions', url: '/terms-conditions' },
  { label: 'Refund Policy', url: '/refund-policy' },
  { label: 'Customer Sign In', url: '/signin' },
  { label: 'Create Account', url: '/signup' },
];

const PAGES = [
  {
    title: 'Privacy Policy',
    slug: 'privacy-policy',
    meta_title: 'Privacy Policy - WooBD.Com',
    meta_description:
      'How WooBD.Com collects, uses and protects your personal information, and the rights you have over your own data.',
    content: `<h2>Privacy Policy</h2>
<p><strong>Last updated:</strong> 1 January 2025</p>
<p>WooBD.Com ("we", "us", "our"), operating from House 72, RK Road, Rangpur, Bangladesh, respects your privacy and is committed to protecting the personal information you share with us. This policy explains what we collect, why, and what control you have over it.</p>

<h3>1. Information we collect</h3>
<p>We collect information you provide directly, including your name, email address, phone number, company name, billing address and project requirements. When you place an order we also collect the payment reference, sender number and any payment screenshot you upload so we can verify your transaction.</p>
<p>We automatically collect limited technical information: IP address, browser type, pages visited and referring URL. This is used for security, fraud prevention and aggregate analytics.</p>

<h3>2. How we use your information</h3>
<ul>
<li>To deliver the services you have ordered and provide access to your customer dashboard</li>
<li>To verify manual payments made by bKash, Nagad, Rocket or bank transfer</li>
<li>To send service notifications, invoices and support responses</li>
<li>To respond to enquiries submitted through our contact form or live chat</li>
<li>To send occasional service updates, which you can unsubscribe from at any time</li>
<li>To detect and prevent fraudulent transactions and abuse</li>
</ul>

<h3>3. Payment information</h3>
<p>We do not store complete card numbers, CVV codes or mobile wallet PINs. Card transactions are processed by our payment gateway partner and sensitive card data never reaches our servers. For manual wallet transfers we store only the transaction reference, sender number and the screenshot you provide as proof of payment.</p>

<h3>4. Cookies and sessions</h3>
<p>We use a session cookie to keep you signed in and a preference cookie to remember your light or dark theme choice. These are strictly necessary for the site to function. We do not sell advertising cookies or run third-party ad tracking on this website.</p>

<h3>5. Sharing with third parties</h3>
<p>We share data only where required to deliver your service: with hosting providers where your website is deployed, with payment and courier partners to complete transactions and deliveries, and with email providers to send transactional messages. We never sell your personal information. We may disclose information where required by Bangladeshi law or a valid legal request.</p>

<h3>6. Your website credentials</h3>
<p>When your order is activated we provide your hosting and website credentials through your customer dashboard. These are visible only to you and to the WooBD staff member who provisioned your account. If you suspect unauthorised access, contact us immediately so we can rotate the credentials.</p>

<h3>7. Data retention</h3>
<p>We retain account and order records for as long as your account is active and for a further seven years where required for tax and accounting purposes. Payment verification screenshots are retained for twelve months. Support tickets are retained for three years.</p>

<h3>8. Your rights</h3>
<p>You may request a copy of the personal data we hold about you, ask us to correct inaccurate information, or ask us to delete your account and associated data. Requests can be made from your dashboard or by emailing hello@woobd.com. We respond within 30 days. Note that we cannot delete records we are legally required to retain.</p>

<h3>9. Security</h3>
<p>We use encrypted connections (HTTPS), hashed password storage and access controls limiting staff access to customer data. No system is perfectly secure, so we ask that you use a unique password and never share your dashboard credentials.</p>

<h3>10. Children's privacy</h3>
<p>Our services are not directed at anyone under 18. We do not knowingly collect data from minors. If you believe a minor has provided us information, contact us and we will remove it.</p>

<h3>11. Changes to this policy</h3>
<p>We may update this policy as our services change. Material changes will be announced by email and on this page, with the revised date shown at the top.</p>

<h3>12. Contact</h3>
<p>Questions about this policy can be sent to <a href="mailto:hello@woobd.com">hello@woobd.com</a>, by WhatsApp on +8801789668276, or by post to House 72, RK Road, Rangpur, Bangladesh.</p>`,
  },
  {
    title: 'Terms & Conditions',
    slug: 'terms-conditions',
    meta_title: 'Terms & Conditions - WooBD.Com',
    meta_description:
      'The terms governing your use of WooBD.Com and the web design, development and maintenance services we provide.',
    content: `<h2>Terms & Conditions</h2>
<p><strong>Last updated:</strong> 1 January 2025</p>
<p>These terms govern your use of woobd.com and any service you purchase from WooBD.Com. By creating an account or placing an order you accept them. Please read them before you buy.</p>

<h3>1. Who we are</h3>
<p>WooBD.Com is a web design and development agency based at House 72, RK Road, Rangpur, Bangladesh, providing e-commerce website design, development, maintenance and digital marketing services.</p>

<h3>2. Accounts</h3>
<p>You must provide accurate details when registering and keep your password confidential. You are responsible for all activity under your account. We may suspend an account used for fraudulent payment claims, abuse of staff, or activity that threatens the security of our systems.</p>

<h3>3. Orders and scope</h3>
<p>Every package page states what is included and the price. Work outside that list is a change request and will be quoted separately before it begins. We confirm scope in writing at order time. Requirements must be supplied by you; delays in supplying content, product data or hosting access extend the delivery timeline by at least the length of the delay.</p>

<h3>4. Payment</h3>
<p>We accept bKash, Nagad, Rocket, bank transfer and card payment. For manual transfers, your order enters production only after our team verifies the payment - typically within one business day. Recurring subscriptions renew automatically on the billing date until cancelled. We will notify you before a renewal charge is due.</p>

<h3>5. Delivery and activation</h3>
<p>Delivery timelines stated on package pages are working-day estimates from the date we receive all required materials and verified payment. When your order is activated we publish your hosting and website credentials in your customer dashboard. It is your responsibility to change any temporary password we supply.</p>

<h3>6. Revisions and acceptance</h3>
<p>Every project includes two rounds of revisions during the design phase. Further rounds, or revisions requested after sign-off, are charged at our standard hourly rate. A project is considered accepted if you do not raise objections within seven days of delivery notice.</p>

<h3>7. Your content and responsibilities</h3>
<p>You confirm that you own or have permission to use all text, images, logos and product data you supply, and that your website will not be used to sell prohibited goods or publish unlawful content. You are responsible for compliance with Bangladeshi e-commerce, tax and consumer protection regulations applicable to your business.</p>

<h3>8. Third-party services</h3>
<p>Your website depends on third parties: hosting providers, payment gateways, courier APIs, domain registrars and email services. We configure these on your behalf but do not control them. Outages, price changes or policy changes by a third party are outside our responsibility.</p>

<h3>9. Ongoing maintenance</h3>
<p>Care Plans cover the specific items listed on their package page. They do not include new features, redesigns, or repairs to damage caused by third-party plugins or edits you make yourself. Care Plans renew monthly and may be cancelled from your dashboard before the next billing date.</p>

<h3>10. Intellectual property</h3>
<p>On full payment, you own your website content, your domain, your hosting account and your customer data. We retain ownership of our underlying frameworks, reusable components and internal tooling. Licensed premium themes and plugins remain subject to their own licence terms, and you are responsible for renewing any licence we do not transfer.</p>

<h3>11. Limitation of liability</h3>
<p>Our total liability arising from any order is limited to the amount you paid for that order. We are not liable for lost profits, lost sales, or indirect damages. We do not guarantee specific search rankings, traffic volumes or conversion rates - outcomes depend on factors outside our control.</p>

<h3>12. Termination</h3>
<p>Either party may end an ongoing engagement with 30 days' written notice. If you cancel a project already in progress, you pay for work completed to that date. We will hand over all completed work and credentials.</p>

<h3>13. Governing law</h3>
<p>These terms are governed by the laws of the People's Republic of Bangladesh. Disputes will first be attempted to be resolved by good-faith discussion, and failing that, are subject to the jurisdiction of the courts of Rangpur.</p>

<h3>14. Contact</h3>
<p>For any question about these terms, email <a href="mailto:hello@woobd.com">hello@woobd.com</a> or message us on WhatsApp at +8801789668276.</p>`,
  },
  {
    title: 'Refund Policy',
    slug: 'refund-policy',
    meta_title: 'Refund Policy - WooBD.Com',
    meta_description:
      'When WooBD.Com issues refunds on website design and development orders, and how to request one.',
    content: `<h2>Refund Policy</h2>
<p><strong>Last updated:</strong> 1 January 2025</p>
<p>We want you to be confident ordering from us. This policy explains exactly when a refund is available, so there are no surprises.</p>

<h3>1. Before work begins</h3>
<p>If you cancel before we have started any work on your order, you receive a full refund of the amount paid, less any payment processing fee charged to us by the gateway. Notify us by email or through your dashboard ticket system.</p>

<h3>2. After work has started</h3>
<p>If we have begun design or development, we retain payment for the work completed and refund the remainder. We will tell you the exact percentage retained and show you the work delivered to date. As a guide: design phase carries 40% of the project value, build phase 80%, and delivery 100%.</p>

<h3>3. After delivery</h3>
<p>Once your website has been delivered and your credentials published in your dashboard, the project is complete and the fee is non-refundable. If something is genuinely broken or differs from the agreed scope, we will fix it at no cost - that is a support matter, not a refund matter.</p>

<h3>4. Recurring plans</h3>
<p>Care Plans, SEO packages and marketing retainers renew monthly. You may cancel at any time from your dashboard, and the cancellation takes effect at the end of the current billing period. We do not refund partial months already in progress, but we will not charge you again after cancellation.</p>

<h3>5. Hosting and domain fees</h3>
<p>Hosting and domain registration are paid to third-party providers and are not refundable by us once registered. Domain registrations cannot be reversed after purchase under registrar policy.</p>

<h3>6. Non-refundable situations</h3>
<ul>
<li>A completed project where you have received and used the website</li>
<li>Delays caused by you not supplying content, product data or hosting access</li>
<li>Dissatisfaction with a design after you have approved it in the revision stage</li>
<li>Third-party service failures, such as a payment gateway suspending your merchant account</li>
<li>Subscription periods already billed and partially elapsed</li>
</ul>

<h3>7. How to request a refund</h3>
<p>Open a support ticket from your dashboard under the Billing department, or email hello@woobd.com with your order number. Include what went wrong so we can assess it properly. We acknowledge every request within one business day and issue a decision within five business days.</p>

<h3>8. How refunds are paid</h3>
<p>Approved refunds are returned by the same method you paid with, within seven business days of approval. If you paid by card, allow additional time for your bank to post the credit.</p>

<h3>9. Contact</h3>
<p>Questions about a refund: <a href="mailto:hello@woobd.com">hello@woobd.com</a> or WhatsApp +8801789668276.</p>`,
  },
  {
    title: 'About WooBD.Com',
    slug: 'about-us',
    meta_title: 'About Us - WooBD.Com',
    meta_description:
      'WooBD.Com is a Rangpur-based web design agency building e-commerce websites for Bangladeshi businesses since 2019.',
    content: `<h2>About WooBD.Com</h2>
<p>We build e-commerce websites for Bangladeshi businesses - the kind that take real orders, accept bKash, and survive a Friday-night traffic spike.</p>
<p>WooBD.Com started in Rangpur in 2019 after watching too many good local businesses lose sales to a website that never worked properly. A store owner would pay for a site, wait three months, receive something slow and broken, and go back to selling through Facebook Messenger. We thought that was a fixable problem.</p>
<p>Our approach is different in one specific way: we hand over everything. When your website goes live, your cPanel URL, admin credentials and database details appear in your own dashboard. You are never locked in, never dependent on us to make a text change, and never held hostage over a domain. If you leave, you leave with everything.</p>
<p>Since 2019 we have delivered over 200 websites across Dhaka, Chittagong, Sylhet, Khulna, Rajshahi, Bogra and Rangpur - fashion stores, electronics retailers, agricultural suppliers, restaurants and cooperatives. Most of our work now comes from referrals.</p>`,
  },
];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const divider = (label) => console.log(`\n${'─'.repeat(62)}\n${label}\n${'─'.repeat(62)}`);

/**
 * Split a .sql file into executable statements.
 *
 * A naive split on ";" breaks on any semicolon inside a string literal or a
 * comment, and this schema contains apostrophes in comment prose. We strip
 * line comments first, then walk the file character by character tracking
 * quote state so an escaped quote inside a literal does not end the statement.
 */
function splitStatements(sql) {
  const cleaned = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');

  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const prev = cleaned[i - 1];

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * Does a row with this column=value already exist?
 * Returns null during --dry-run, where no connection is ever opened: the point
 * of a dry run is to prove the script parses and the plan is right, not to
 * claim knowledge of a database it never contacted.
 */
async function exists(db, table, column, value) {
  if (DRY_RUN) return null;
  const row = await db.queryOne(`SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`, [value]);
  return row ? row.id : null;
}

/** Same idea, for tables with no natural unique key to look up by. */
async function findId(db, table, column, seedValue) {
  if (DRY_RUN) return null;
  const row = await db.queryOne(`SELECT id FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 1`, [seedValue]);
  return row ? row.id : null;
}

/**
 * Every table this application owns. Listed explicitly so --reset can drop
 * exactly these and nothing else - a shared database's other tables are never
 * touched.
 */
const APP_TABLES = [
  'chat_messages',
  'chat_conversations',
  'activity_log',
  'media',
  'menus',
  'settings',
  'newsletter_subscribers',
  'contact_messages',
  'ticket_replies',
  'tickets',
  'invoice_items',
  'invoices',
  'payments',
  'subscriptions',
  'order_deliverables',
  'orders',
  'posts',
  'pages',
  'clients',
  'faqs',
  'testimonials',
  'portfolio',
  'services',
  'service_categories',
  'customers',
  'users',
  'sessions',
];

// --------------------------------------------------------------------------
// Stages
// --------------------------------------------------------------------------

/**
 * --reset: drop every app table so the schema stage rebuilds from scratch.
 * Guarded, and it lists what it will remove before doing it.
 */
async function stepReset(db) {
  divider('0. Reset (DESTRUCTIVE)');

  // Count what is about to be lost so the warning is concrete, not abstract.
  const counts = {};
  for (const table of APP_TABLES) {
    try {
      const row = await db.queryOne(`SELECT COUNT(*) AS n FROM \`${table}\``);
      counts[table] = row ? Number(row.n) : 0;
    } catch {
      counts[table] = null; // table does not exist yet
    }
  }

  const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
  if (nonEmpty.length) {
    console.log('  The following data will be permanently deleted:');
    for (const [table, n] of nonEmpty) console.log(`    · ${table.padEnd(24)} ${n} row(s)`);
  } else {
    console.log('  No existing data found - the database looks empty already.');
  }

  if (DRY_RUN) {
    console.log(`  Would drop ${APP_TABLES.length} tables`);
    return;
  }

  // Refuse to destroy data without an explicit acknowledgement. This is the one
  // path in the installer that cannot be undone.
  if (!ASSUME_YES) {
    console.error('\n  ✗ Refusing to drop tables without confirmation.');
    console.error('    Re-run with --reset --yes if you are certain.\n');
    throw new Error('reset not confirmed');
  }

  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  let dropped = 0;
  for (const table of APP_TABLES) {
    try {
      await db.query(`DROP TABLE IF EXISTS \`${table}\``);
      dropped += 1;
    } finally {
      /* a table that never existed is fine */
    }
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`  ✓ ${dropped} tables dropped`);
}

/**
 * --docker: wait for MySQL to accept connections. Compose starts the database
 * and the app together, and MySQL is routinely slower to become ready than the
 * app is to start.
 */
async function stepDocker(db) {
  divider('Waiting for MySQL');

  if (DRY_RUN) {
    console.log('  Would poll the database until it accepts connections');
    return;
  }

  const attempts = 30;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await db.healthCheck();
      console.log(`  ✓ Database ready after ${i} attempt(s)`);
      return;
    } catch (err) {
      if (i === attempts) {
        console.error(`  ✗ Database still unreachable after ${attempts} attempts`);
        throw err;
      }
      if (i === 1) console.log('  Waiting for MySQL to become ready...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function stepSchema(db) {
  divider('1. Schema');
  const file = path.join(ROOT, 'database', 'schema.sql');
  if (!fs.existsSync(file)) {
    throw new Error(`Schema file not found: ${file}`);
  }

  const sql = fs.readFileSync(file, 'utf8');
  const statements = splitStatements(sql);
  console.log(`  Applying ${statements.length} statements from database/schema.sql`);

  if (DRY_RUN) {
    statements.forEach((s, i) => {
      const head = s.replace(/\s+/g, ' ').slice(0, 70);
      console.log(`    [${String(i + 1).padStart(2)}] ${head}...`);
    });
    return;
  }

  let applied = 0;
  for (const statement of statements) {
    try {
      await db.query(statement);
      applied += 1;
    } catch (err) {
      const head = statement.replace(/\s+/g, ' ').slice(0, 120);
      err.message = `${err.message}\n  While running: ${head}`;
      throw err;
    }
  }
  console.log(`  ✓ ${applied} statements applied (tables are IF NOT EXISTS, so re-runs are safe)`);
}

async function stepSettings() {
  divider('2. Settings defaults');
  const settings = require('../src/services/settings.service');
  const schema = require('../src/config/settings-schema');

  if (DRY_RUN) {
    console.log(`  Would seed up to ${schema.SETTINGS.length} settings across ${Object.keys(schema.GROUP_LABELS).length} groups`);
    return;
  }

  const created = await settings.seedDefaults();
  const total = schema.SETTINGS.length;
  console.log(`  ✓ ${created} new setting(s) inserted, ${total - created} already present`);
  console.log(`  Groups: ${Object.keys(schema.GROUP_LABELS).join(', ')}`);
}

async function stepStaff(db) {
  divider('3. Staff accounts');

  // No SEED_PASSWORD in the environment, so one was generated. Print it now -
  // it is not stored anywhere else, and losing it means the accounts are
  // unreachable.
  if (SEED_PASSWORD_IS_GENERATED && !DRY_RUN) {
    console.log('  ⚠  SEED_PASSWORD was not set, so a random one was generated.');
    console.log(`     Staff password: ${SEED_PASSWORD}`);
    console.log('     Save it now - it is not written to any file. To choose your own,');
    console.log('     set SEED_PASSWORD in .env (quoted) and re-run.');
    console.log('     Change it after signing in.\n');
  }

  // Catch the unquoted-`#` truncation before it creates unusable accounts.
  // An unquoted `#` starts a comment in .env, so a password like
  // `abc#def` silently becomes "abc", and the only symptom is a sign-in that
  // fails with a password the operator believes is correct.
  if (SEED_PASSWORD.length < 8) {
    console.log(`  ⚠  SEED_PASSWORD resolved to only ${SEED_PASSWORD.length} character(s).`);
    console.log('     If your password contains "#", it was truncated: an unquoted #');
    console.log('     starts a comment in .env. Quote the value instead:');
    console.log('       SEED_PASSWORD="YourPass#123"');
    console.log('     Continuing anyway - the accounts will use the short password.\n');
  }

  const hash = DRY_RUN ? null : await bcrypt.hash(SEED_PASSWORD, 12);
  for (const person of STAFF) {
    const existing = await exists(db, 'users', 'username', person.username);
    if (existing) {
      console.log(`  · ${person.username.padEnd(16)} already exists (id ${existing}) - skipped`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  + ${person.username.padEnd(16)} ${person.role.padEnd(8)} ${person.email}`);
      continue;
    }
    await db.insert('users', {
      name: person.name,
      username: person.username,
      email: person.email,
      phone: person.phone,
      password_hash: hash,
      role: person.role,
      status: 'active',
    });
    console.log(`  + ${person.username.padEnd(16)} ${person.role.padEnd(8)} ${person.email}`);
  }

  if (!DRY_RUN) {
    console.log(`\n  Password for all new accounts: ${SEED_PASSWORD}`);
    // There is no default to warn about any more - the value either came from
    // the environment or was generated above. Only the generated case needs
    // calling out, and that is already printed at the top of this step.
    if (!SEED_PASSWORD_IS_GENERATED) {
      console.log('  Change it after your first sign-in.');
    }
  }
}

/** Optional destructive reset used only by --force-demo. */
async function clearDemo(db) {
  console.log('  ! --force-demo: clearing demo content tables');
  // Order matters: children before parents, or the FKs will refuse.
  const order = [
    'ticket_replies',
    'tickets',
    'invoice_items',
    'invoices',
    'order_deliverables',
    'payments',
    'subscriptions',
    'orders',
    'contact_messages',
    'customers',
    'services',
    'service_categories',
    'portfolio',
    'testimonials',
    'faqs',
    'clients',
    'menus',
  ];
  for (const table of order) {
    await db.query(`DELETE FROM \`${table}\``);
  }
  console.log(`  ✓ ${order.length} tables cleared`);
}

async function stepDemo(db) {
  divider('4. Demo content');

  // A dry run reports the full inventory rather than attempting per-row
  // duplicate checks against a database it deliberately never contacted.
  if (DRY_RUN) {
    console.log(`  + ${CATEGORIES.length} service categories`);
    console.log(`  + ${SERVICES.length} services (${SERVICES.filter((s) => s.featured).length} featured)`);
    console.log(`  + ${PORTFOLIO.length} portfolio projects (${PORTFOLIO.filter((p) => p.featured).length} featured)`);
    console.log(`  + ${TESTIMONIALS.length} testimonials`);
    console.log(`  + ${FAQS.length} FAQs`);
    console.log(`  + ${CLIENTS.length} client logos`);
    console.log(`  + ${PAGES.length} content pages (privacy, terms, refund, about)`);
    console.log(
      `  + ${HEADER_MENU.length * 2 + FOOTER_QUICK.length + FOOTER_SERVICES.length + FOOTER_INFO.length} menu items across 5 locations`
    );
    console.log(`  + ${DEMO_CUSTOMERS.length} customers, ${DEMO_ORDERS.length} orders, payments, invoices`);
    console.log('  + a subscription, tickets with replies, and contact enquiries');
    return;
  }

  if (FORCE_DEMO) await clearDemo(db);

  // --- Service categories ---
  const categoryIds = {};
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const cat = CATEGORIES[i];
    const found = await exists(db, 'service_categories', 'slug', cat.slug);
    if (found) {
      categoryIds[cat.slug] = found;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  + category ${cat.name}`);
      continue;
    }
    categoryIds[cat.slug] = await db.insert('service_categories', {
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      icon: cat.icon,
      sort_order: i,
    });
  }
  if (!DRY_RUN) console.log(`  ✓ ${Object.keys(categoryIds).length} service categories`);

  // --- Services ---
  let serviceCount = 0;
  for (let i = 0; i < SERVICES.length; i += 1) {
    const svc = SERVICES[i];
    if (await exists(db, 'services', 'slug', svc.slug)) continue;
    if (DRY_RUN) {
      console.log(`  + service ${svc.title}`);
      serviceCount += 1;
      continue;
    }
    await db.insert('services', {
      category_id: svc.category ? categoryIds[svc.category] || null : null,
      title: svc.title,
      slug: svc.slug,
      short_description: svc.short,
      description: svc.description,
      image: `/assets/img/service-default.svg`,
      price: svc.price,
      sale_price: svc.sale_price,
      billing_cycle: svc.billing_cycle,
      delivery_days: svc.delivery_days,
      // A recurring package can carry a minimum commitment and a discount for
      // paying a year up front. Both default to "no commitment, no discount".
      min_months: svc.min_months || 1,
      yearly_discount_percent: svc.yearly_discount || 0,
      features: JSON.stringify(svc.features),
      is_featured: svc.featured,
      status: 'active',
      sort_order: i,
      seo_title: `${svc.title} - WooBD.Com`,
      seo_description: svc.short,
    });
    serviceCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${serviceCount} services added, ${SERVICES.length - serviceCount} already present`);

  // --- Staff id for activity attribution ---
  const admin = await exists(db, 'users', 'username', 'mdshojibmiya');

  // --- Portfolio ---
  let portfolioCount = 0;
  for (let i = 0; i < PORTFOLIO.length; i += 1) {
    const item = PORTFOLIO[i];
    if (await exists(db, 'portfolio', 'slug', item.slug)) continue;
    if (DRY_RUN) {
      portfolioCount += 1;
      continue;
    }
    await db.insert('portfolio', {
      title: item.title,
      slug: item.slug,
      client_name: item.client,
      category: item.category,
      short_description: item.short,
      description: item.description,
      thumbnail: '/assets/img/portfolio-default.svg',
      gallery: JSON.stringify([]),
      technologies: JSON.stringify(item.technologies),
      completed_at: item.completed,
      is_featured: item.featured,
      status: 'active',
      sort_order: i,
      seo_title: `${item.title} - Case Study - WooBD.Com`,
      seo_description: item.short,
    });
    portfolioCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${portfolioCount} portfolio projects added`);

  // --- Testimonials ---
  let testimonialCount = 0;
  for (let i = 0; i < TESTIMONIALS.length; i += 1) {
    const t = TESTIMONIALS[i];
    const found = await findId(db, 'testimonials', 'customer_name', t.name);
    if (found) continue;
    if (DRY_RUN) {
      testimonialCount += 1;
      continue;
    }
    await db.insert('testimonials', {
      customer_name: t.name,
      designation: t.designation,
      company: t.company,
      rating: t.rating,
      message: t.message,
      status: 'active',
      sort_order: i,
    });
    testimonialCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${testimonialCount} testimonials added`);

  // --- FAQs ---
  let faqCount = 0;
  for (let i = 0; i < FAQS.length; i += 1) {
    const q = FAQS[i];
    const found = await findId(db, 'faqs', 'question', q.question);
    if (found) continue;
    if (DRY_RUN) {
      faqCount += 1;
      continue;
    }
    await db.insert('faqs', {
      question: q.question,
      answer: q.answer,
      category: 'general',
      status: 'active',
      sort_order: i,
    });
    faqCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${faqCount} FAQs added`);

  // --- Clients (trust bar) ---
  let clientCount = 0;
  for (let i = 0; i < CLIENTS.length; i += 1) {
    const name = CLIENTS[i];
    const found = await findId(db, 'clients', 'name', name);
    if (found) continue;
    if (DRY_RUN) {
      clientCount += 1;
      continue;
    }
    await db.insert('clients', {
      name,
      logo: '/assets/img/client-default.svg',
      website_url: null,
      status: 'active',
      sort_order: i,
    });
    clientCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${clientCount} clients added`);

  // --- Pages (policy / legal content) ---
  let pageCount = 0;
  for (const page of PAGES) {
    if (await exists(db, 'pages', 'slug', page.slug)) continue;
    if (DRY_RUN) {
      pageCount += 1;
      continue;
    }
    await db.insert('pages', {
      title: page.title,
      slug: page.slug,
      content: page.content,
      meta_title: page.meta_title,
      meta_description: page.meta_description,
      show_in_footer: page.slug === 'privacy-policy' || page.slug === 'terms-conditions' ? 1 : 0,
      status: 'published',
    });
    pageCount += 1;
  }
  if (!DRY_RUN) console.log(`  ✓ ${pageCount} content pages added`);

  // --- Menus ---
  //
  // Header and mobile share the same tree, including dropdown children. Footer
  // menus are flat. Children are inserted after their parent so the parent_id
  // is known.
  const headerItems = (location) =>
    HEADER_MENU.map((m, i) => ({
      location,
      label: m.label,
      url: m.url,
      icon: m.icon || null,
      sort: i,
      children: (m.children || []).map((c, ci) => ({ ...c, sort: ci })),
    }));

  const MENUS = [
    ...headerItems('header'),
    ...headerItems('mobile'),
    ...FOOTER_QUICK.map((m, i) => ({ location: 'footer_quick', label: m.label, url: m.url, sort: i })),
    ...FOOTER_SERVICES.map((m, i) => ({ location: 'footer_services', label: m.label, url: m.url, sort: i })),
    ...FOOTER_INFO.map((m, i) => ({ location: 'footer_info', label: m.label, url: m.url, sort: i })),
  ];

  let menuCount = 0;

  for (const item of MENUS) {
    let parentId = null;

    if (!DRY_RUN) {
      const found = await db.queryOne(
        'SELECT id FROM menus WHERE location = ? AND label = ? AND parent_id IS NULL LIMIT 1',
        [item.location, item.label]
      );
      if (found) {
        // The parent exists; still make sure its children are present.
        parentId = found.id;
      } else {
        parentId = await db.insert('menus', {
          location: item.location,
          parent_id: null,
          label: item.label,
          url: item.url,
          target: '_self',
          icon: item.icon || null,
          sort_order: item.sort,
          status: 'active',
        });
        menuCount += 1;
      }
    } else {
      menuCount += 1;
    }

    // Dropdown children.
    for (const child of item.children || []) {
      if (DRY_RUN) {
        menuCount += 1;
        continue;
      }
      const existing = await db.queryOne(
        'SELECT id FROM menus WHERE location = ? AND label = ? AND parent_id = ? LIMIT 1',
        [item.location, child.label, parentId]
      );
      if (existing) continue;

      await db.insert('menus', {
        location: item.location,
        parent_id: parentId,
        label: child.label,
        url: child.url,
        target: '_self',
        icon: child.icon || null,
        sort_order: child.sort,
        status: 'active',
      });
      menuCount += 1;
    }
  }
  if (!DRY_RUN) console.log(`  ✓ ${menuCount} menu items added`);

  if (!DRY_RUN && admin) {
    await db.insert('activity_log', {
      actor_type: 'system',
      actor_id: admin,
      actor_name: 'Installer',
      action: 'database.seeded',
      entity_type: 'system',
      description: 'Installer seeded demo content and default settings',
    });
  }
}

// --------------------------------------------------------------------------
// Migrations
// --------------------------------------------------------------------------

/**
 * Columns added after the first release.
 *
 * `database/schema.sql` is entirely CREATE TABLE IF NOT EXISTS, so an existing
 * install never picks up a new column - the CREATE is skipped and the column is
 * simply missing. Every query against it then fails with "Unknown column".
 *
 * Each entry is applied only when the column is absent, so this is safe to run
 * on every deploy. Add to the list rather than editing an old entry.
 */
const COLUMN_MIGRATIONS = [
  { table: 'services', column: 'min_months', definition: 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER delivery_days' },
  { table: 'services', column: 'yearly_discount_percent', definition: 'DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER min_months' },
  { table: 'orders', column: 'term_months', definition: 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER billing_cycle' },
  { table: 'services', column: 'order_fees', definition: 'JSON DEFAULT NULL AFTER features' },
];

/**
 * Packages that were withdrawn.
 *
 * Listed by exact slug rather than "delete everything with billing_cycle =
 * 'one_time'", because a broad rule would also delete a one-off package an
 * admin adds later. Deleting a slug that is not there is a no-op, so this stays
 * safe to run on every deploy.
 */
const WITHDRAWN_SERVICE_SLUGS = [
  'starter-ecommerce-website',
  'business-ecommerce-website',
  'enterprise-ecommerce-solution',
  'premium-business-website',
  'single-page-landing-site',
  'corporate-website-with-cms',
];

/**
 * Enums that gained values after the fact.
 *
 * MySQL cannot add a value to an ENUM in place, so the column is redefined.
 * The check is on the column's current definition rather than on its existence,
 * which is what makes this safe on every deploy: once the values are present
 * the statement is skipped.
 *
 * Widening an ENUM is non-destructive - existing rows keep their values - so
 * unlike a column addition there is no data to lose by running it.
 */
const ENUM_WIDENINGS = [
  {
    table: 'payments',
    column: 'method_type',
    // The channel the payment came through. 'manual' and 'card' were the only
    // two the original four methods needed; wallets and the other manual
    // channels need names of their own, and storing everything as 'manual'
    // would make the column say nothing.
    values: ['wallet', 'bank_transfer', 'cash_on_delivery'],
    definition:
      "ENUM('manual','card','gateway','wallet','bank_transfer','cash_on_delivery') NOT NULL DEFAULT 'manual'",
  },
];

async function stepEnumWidenings(db) {
  let widened = 0;

  for (const change of ENUM_WIDENINGS) {
    const column = await db.queryOne(
      `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [change.table, change.column]
    );

    if (!column) continue;

    const missing = change.values.filter((value) => !String(column.type).includes(`'${value}'`));
    if (!missing.length) continue;

    if (DRY_RUN) {
      console.log(`  + would widen ${change.table}.${change.column} for ${missing.join(', ')}`);
      widened += 1;
      continue;
    }

    await db.query(
      `ALTER TABLE ${db.escapeId(change.table)} MODIFY ${db.escapeId(change.column)} ${change.definition}`
    );
    console.log(`  + ${change.table}.${change.column} now accepts ${missing.join(', ')}`);
    widened += 1;
  }

  if (widened) console.log(`  ✓ ${widened} enum(s) widened`);
}

async function stepMigrations(db) {
  divider('1b. Column migrations');

  let added = 0;
  let present = 0;

  for (const migration of COLUMN_MIGRATIONS) {
    // Does the table even exist yet? On a fresh database the schema step has
    // just created it, so this is normally true.
    const table = await db.queryOne(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [migration.table]
    );

    if (!table || !Number(table.n)) {
      console.log(`  · ${migration.table} does not exist yet - skipped`);
      continue;
    }

    const column = await db.queryOne(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [migration.table, migration.column]
    );

    if (Number(column.n)) {
      present += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  + would add ${migration.table}.${migration.column}`);
      added += 1;
      continue;
    }

    // Identifiers cannot be parameterised, so they are escaped instead. The
    // values all come from the constant above, never from input.
    await db.query(
      `ALTER TABLE ${db.escapeId(migration.table)} ADD COLUMN ${db.escapeId(migration.column)} ${migration.definition}`
    );
    console.log(`  + ${migration.table}.${migration.column}`);
    added += 1;
  }

  if (!DRY_RUN) {
    console.log(
      added
        ? `  ✓ ${added} column(s) added, ${present} already present`
        : `  ✓ all ${present} column(s) already present`
    );
  }

  await stepEnumWidenings(db);

  // --- Withdrawn packages ------------------------------------------------
  //
  // No early return here: the menu repair below has to run even when the
  // packages are already gone, because the nav rows and the services are
  // removed in separate passes.
  const placeholders = WITHDRAWN_SERVICE_SLUGS.map(() => '?').join(', ');
  const stillThere = await db.query(
    `SELECT id, title FROM services WHERE slug IN (${placeholders})`,
    WITHDRAWN_SERVICE_SLUGS
  );

  if (!stillThere.length) {
    console.log('  ✓ no withdrawn packages present');
  } else if (DRY_RUN) {
    console.log(`  + would withdraw ${stillThere.length} package(s): ${stillThere.map((s) => s.title).join(', ')}`);
  } else {
    // Orders keep their own copy of the title and the service_id is ON DELETE
    // SET NULL, so withdrawing a package never removes order history.
    await db.query(`DELETE FROM services WHERE slug IN (${placeholders})`, WITHDRAWN_SERVICE_SLUGS);
    console.log(`  ✓ ${stillThere.length} withdrawn package(s) removed: ${stillThere.map((s) => s.title).join(', ')}`);
  }

  // --- Menu links pointing at a withdrawn package ------------------------
  //
  // A nav item linking to a package that no longer exists is a 404 in the
  // header. Drop those items; the catalogue seed then re-adds the current
  // packages under the same parent, so the dropdown stays complete.
  const staleLinks = await db.query(
    `SELECT id, label, url FROM menus
     WHERE url LIKE '/services/%'
       AND SUBSTRING_INDEX(url, '/', -1) IN (${placeholders})`,
    WITHDRAWN_SERVICE_SLUGS
  );

  if (!staleLinks.length) {
    console.log('  ✓ no menu links point at a withdrawn package');
  } else if (DRY_RUN) {
    console.log(`  + would remove ${staleLinks.length} stale menu link(s): ${staleLinks.map((m) => m.label).join(', ')}`);
  } else {
    await db.query(
      `DELETE FROM menus WHERE id IN (${staleLinks.map(() => '?').join(', ')})`,
      staleLinks.map((m) => m.id)
    );
    console.log(`  ✓ ${staleLinks.length} menu link(s) to withdrawn packages removed: ${staleLinks.map((m) => m.label).join(', ')}`);
  }
}

// --------------------------------------------------------------------------
// Demo transactional data
// --------------------------------------------------------------------------

/**
 * Customers, orders, payments, invoices, tickets and enquiries.
 *
 * The CMS content alone leaves the admin panel looking broken: every dashboard
 * tile reads zero, the reports charts have nothing to plot, and the orders,
 * payments, invoices and tickets screens are all empty. This gives a fresh
 * install something to demonstrate.
 *
 * Guarded so it only runs when there is no customer data yet, and skipped
 * entirely by --no-demo.
 */
const DEMO_CUSTOMERS = [
  { name: 'Ariful Islam', email: 'ariful@rangpurfashion.com', phone: '+8801711223344', company: 'Rangpur Fashion House', city: 'Rangpur' },
  { name: 'Nusrat Jahan', email: 'nusrat@dhakaelectronics.com', phone: '+8801811556677', company: 'Dhaka Electronics Mart', city: 'Dhaka' },
  { name: 'Rezaul Karim', email: 'rezaul@ctgagro.com', phone: '+8801919887766', company: 'Chittagong Agro Supplies', city: 'Chittagong' },
  { name: 'Tahmina Akter', email: 'tahmina@sylhettea.com', phone: '+8801612334455', company: 'Sylhet Tea Collective', city: 'Sylhet' },
];

/** Order seed rows. `age` is days ago, so the trend chart has a spread. */
const DEMO_ORDERS = [
  { customer: 0, service: 'WooCommerce Web Design — Business', status: 'active', payment: 'paid', age: 96, domain: 'rangpurfashion.com', term: 12 },
  { customer: 1, service: 'WooCommerce Web Design — Starter', status: 'in_progress', payment: 'partial', age: 61, domain: 'dhakaelectronics.com', term: 3 },
  { customer: 2, service: 'WooCommerce Web Design — Premium', status: 'active', payment: 'paid', age: 44, domain: 'ctgagro.com', term: 12 },
  { customer: 3, service: 'WooCommerce Web Design — Business', status: 'completed', payment: 'paid', age: 27, domain: 'sylhettea.com', term: 6 },
  { customer: 0, service: 'SEO Growth Package', status: 'pending', payment: 'unpaid', age: 9, domain: null, term: 3 },
  { customer: 1, service: 'Google Ads Management', status: 'on_hold', payment: 'unpaid', age: 4, domain: null, term: 3 },
];

async function stepDemoTransactions(db) {
  divider('5. Demo customers and orders');

  // Only seed when the database has no customers - re-running must not
  // duplicate orders or inflate the reports.
  const existing = await db.queryOne('SELECT COUNT(*) AS n FROM customers');
  if (!DRY_RUN && existing && Number(existing.n) > 0) {
    console.log(`  · ${existing.n} customer(s) already present - skipped`);
    return;
  }

  if (DRY_RUN) {
    console.log(`  + ${DEMO_CUSTOMERS.length} customers`);
    console.log(`  + ${DEMO_ORDERS.length} orders across every status`);
    console.log('  + payments, invoices, a subscription, tickets and enquiries');
    return;
  }

  // --- Customers ---
  const customerIds = [];
  for (const person of DEMO_CUSTOMERS) {
    const id = await db.insert('customers', {
      name: person.name,
      email: person.email,
      phone: person.phone,
      company: person.company,
      city: person.city,
      country: 'Bangladesh',
      // No password: these are demonstration records, not accounts anyone signs
      // in with. Leaving the hash NULL means the sign-in path rejects them.
      password_hash: null,
      status: 'active',
      email_verified_at: new Date(),
    });
    customerIds.push(id);
  }
  console.log(`  ✓ ${customerIds.length} customers`);

  // --- Services, for prices and titles ---
  const services = await db.query(
    'SELECT id, title, slug, price, billing_cycle, min_months, yearly_discount_percent FROM services'
  );
  const serviceByName = new Map(services.map((s) => [s.title, s]));

  // --- Orders ---
  const orderIds = [];
  let orderSeq = 1;

  for (const seed of DEMO_ORDERS) {
    const service = serviceByName.get(seed.service);
    if (!service) continue;

    const created = new Date(Date.now() - seed.age * 86400000);

    // Price the order the same way checkout does: monthly rate x the term, less
    // the yearly discount when the term is a full year.
    const monthly = Number(service.price);
    const term = seed.term || Number(service.min_months) || 1;
    const gross = monthly * term;
    const discountPercent = term >= 12 ? Number(service.yearly_discount_percent) || 0 : 0;
    const discount = Math.round((gross * discountPercent) / 100);
    const amount = gross;
    const total = gross - discount;
    const paid = seed.payment === 'paid' ? total : seed.payment === 'partial' ? Math.round(total * 0.5) : 0;

    const orderId = await db.insert('orders', {
      order_number: `WBD-${String(1000 + orderSeq).padStart(4, '0')}`,
      customer_id: customerIds[seed.customer],
      service_id: service.id,
      service_title: service.title,
      billing_cycle: term >= 12 ? 'yearly' : 'monthly',
      term_months: term,
      amount,
      discount,
      total,
      currency: 'BDT',
      status: seed.status,
      payment_status: seed.payment,
      requirements: 'Demo order created by the installer so the admin panel has data to show.',
      domain_name: seed.domain,
      started_at: seed.status === 'pending' ? null : created,
      due_at: new Date(created.getTime() + 14 * 86400000),
      completed_at: seed.status === 'completed' ? new Date(created.getTime() + 14 * 86400000) : null,
      created_at: created,
    });
    orderIds.push({ id: orderId, seed, service, amount, total, paid, created });
    orderSeq += 1;

    // Handover details, as an operator would fill in on activation.
    if (seed.status === 'active' || seed.status === 'completed') {
      const deliverables = [
        ['cPanel URL', `https://cpanel.${seed.domain || 'woobd.com'}`],
        ['Website URL', `https://${seed.domain || 'woobd.com'}`],
        ['Admin URL', `https://${seed.domain || 'woobd.com'}/wp-admin`],
        ['Admin username', 'admin'],
        ['Admin password', 'DemoPass#2025'],
      ];
      let sort = 0;
      for (const [label, value] of deliverables) {
        await db.insert('order_deliverables', {
          order_id: orderId,
          label,
          value,
          is_visible: 1,
          sort_order: sort,
        });
        sort += 1;
      }
    }
  }
  console.log(`  ✓ ${orderIds.length} orders (every status), with handover details on the live ones`);

  // --- Payments ---
  let paymentCount = 0;
  const methods = [
    { method: 'bKash', sender: '01711223344' },
    { method: 'Nagad', sender: '01811556677' },
    { method: 'Bank transfer', sender: null },
  ];

  for (let i = 0; i < orderIds.length; i += 1) {
    const order = orderIds[i];
    if (order.paid <= 0) continue;

    const method = methods[i % methods.length];
    await db.insert('payments', {
      customer_id: customerIds[order.seed.customer],
      order_id: order.id,
      method: method.method,
      method_type: method.method === 'Bank transfer' ? 'manual' : 'manual',
      amount: order.paid,
      currency: 'BDT',
      transaction_id: `TRX${String(Date.now()).slice(-8)}${i}`,
      sender_number: method.sender,
      status: 'approved',
      reviewed_at: order.created,
      created_at: order.created,
    });
    paymentCount += 1;
  }

  // One payment left pending, so the approvals queue is not empty.
  await db.insert('payments', {
    customer_id: customerIds[0],
    order_id: orderIds[4] ? orderIds[4].id : null,
    method: 'bKash',
    method_type: 'manual',
    amount: 6000,
    currency: 'BDT',
    transaction_id: `TRX${String(Date.now()).slice(-8)}P`,
    sender_number: '01711223344',
    status: 'pending',
  });
  paymentCount += 1;
  console.log(`  ✓ ${paymentCount} payments (${paymentCount - 1} approved, 1 awaiting verification)`);

  // --- Invoices ---
  let invoiceCount = 0;
  for (let i = 0; i < orderIds.length; i += 1) {
    const order = orderIds[i];
    const paidInFull = order.seed.payment === 'paid';

    const invoiceId = await db.insert('invoices', {
      invoice_number: `INV-${String(2000 + i).padStart(4, '0')}`,
      customer_id: customerIds[order.seed.customer],
      order_id: order.id,
      subtotal: order.total,
      tax: 0,
      total: order.total,
      currency: 'BDT',
      status: paidInFull ? 'paid' : 'unpaid',
      issue_date: order.created,
      due_date: new Date(order.created.getTime() + 7 * 86400000),
      paid_at: paidInFull ? order.created : null,
      created_at: order.created,
    });

    await db.insert('invoice_items', {
      invoice_id: invoiceId,
      description: order.service.title,
      quantity: 1,
      unit_price: order.total,
      amount: order.total,
    });
    invoiceCount += 1;
  }
  console.log(`  ✓ ${invoiceCount} invoices with line items`);

  // --- A subscription, so the recurring screen has content ---
  const recurring = orderIds.find((o) => o.service.billing_cycle === 'monthly');
  if (recurring) {
    await db.insert('subscriptions', {
      customer_id: customerIds[recurring.seed.customer],
      order_id: recurring.id,
      service_id: recurring.service.id,
      plan_name: recurring.service.title,
      amount: recurring.total,
      billing_cycle: 'monthly',
      status: 'active',
      started_at: recurring.created,
      next_billing_at: new Date(Date.now() + 12 * 86400000),
    });
    console.log('  ✓ 1 active subscription (renews in 12 days)');
  }

  // --- Tickets, with a reply thread ---
  const admin = await findId(db, 'users', 'username', 'mdshojibmiya');
  const ticketSeeds = [
    { customer: 0, subject: 'How do I change my homepage banner?', department: 'general', priority: 'medium', status: 'answered' },
    { customer: 1, subject: 'bKash payment not showing on my order', department: 'billing', priority: 'urgent', status: 'open' },
    { customer: 3, subject: 'Requesting a staging copy of the site', department: 'technical', priority: 'low', status: 'pending' },
  ];

  let ticketCount = 0;
  for (let i = 0; i < ticketSeeds.length; i += 1) {
    const seed = ticketSeeds[i];
    const ticketId = await db.insert('tickets', {
      ticket_number: `TKT-${String(3000 + i).padStart(4, '0')}`,
      customer_id: customerIds[seed.customer],
      order_id: orderIds[i] ? orderIds[i].id : null,
      subject: seed.subject,
      department: seed.department,
      priority: seed.priority,
      status: seed.status,
      assigned_to: seed.status === 'open' ? null : admin,
      last_reply_at: seed.status === 'open' ? null : new Date(),
    });

    await db.insert('ticket_replies', {
      ticket_id: ticketId,
      author_type: 'customer',
      author_id: customerIds[seed.customer],
      author_name: DEMO_CUSTOMERS[seed.customer].name,
      message: 'Hi, could someone take a look at this when you get a chance? Thanks.',
    });

    // The answered ticket gets a staff reply too, so the thread shows both sides.
    if (seed.status === 'answered') {
      await db.insert('ticket_replies', {
        ticket_id: ticketId,
        author_type: 'staff',
        author_id: admin,
        author_name: 'Md Shojib Miya',
        message:
          'Thanks for getting in touch. Log in to your dashboard, open Appearance → Customise, and the banner image is the first field on that screen. I have also emailed you a short walkthrough.',
      });
    }
    ticketCount += 1;
  }
  console.log(`  ✓ ${ticketCount} tickets with reply threads`);

  // --- Contact enquiries ---
  const enquiries = [
    { name: 'Shahidul Haque', email: 'shahidul@bograsports.com', subject: 'Need a store for 300 products', message: 'Hello, I sell sports gear in Bogra and want to move off Facebook. What would a 300-product store cost, and how long would it take?', status: 'new' },
    { name: 'Farhana Yasmin', email: 'farhana@khulnadecor.com', subject: 'Follow-up on the SEO package', message: 'We spoke last month about the SEO growth package. Could you send the proposal again? I have lost the email.', status: 'replied' },
  ];

  for (const enquiry of enquiries) {
    await db.insert('contact_messages', {
      name: enquiry.name,
      email: enquiry.email,
      subject: enquiry.subject,
      message: enquiry.message,
      source: 'contact_page',
      status: enquiry.status,
    });
  }
  console.log(`  ✓ ${enquiries.length} contact enquiries`);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  console.log('\n  WooBD.Com installer');
  console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database    : ${process.env.DB_NAME || 'woobd'} @ ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}`);
  if (DRY_RUN) console.log('  Mode        : DRY RUN - nothing will be written');
  if (RESET) console.log('  Mode        : RESET - all app tables will be dropped');

  const plan = [
    RESET && 'reset',
    DOCKER && 'wait for db',
    runSchema && 'schema',
    runSettings && 'settings',
    runStaff && 'staff accounts',
    runDemo && 'demo content',
  ].filter(Boolean);
  console.log(`  Stages      : ${plan.join(' + ')}`);

  // Required lazily so --dry-run can still print a readable error when the DB
  // is unreachable rather than a stack trace from a module-load failure.
  const db = require('../src/config/database');

  if (!DRY_RUN) {
    // Under Docker the database is often not listening yet.
    if (DOCKER) {
      try {
        await stepDocker(db);
      } catch (err) {
        console.error(`\n  ✗ ${err.message}\n`);
        process.exit(1);
      }
    } else {
      try {
        await db.healthCheck();
        console.log('  Connection  : OK');
      } catch (err) {
        console.error('\n  ✗ Cannot reach the database.');
        console.error(`    ${err.message}`);
        console.error('\n  Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME in .env.');
        console.error('  On Hostinger, DB_HOST must be 127.0.0.1 - not localhost.');
        process.exit(1);
      }
    }
  }

  try {
    if (RESET) await stepReset(db);
    if (runSchema) await stepSchema(db);
    if (runSchema) await stepMigrations(db);
    if (runSettings) await stepSettings();
    if (runStaff) await stepStaff(db);
    if (runDemo) await stepDemo(db);
    if (runDemo) await stepDemoTransactions(db);

    divider(DRY_RUN ? 'Dry run complete - nothing written' : 'Installation complete');
    if (!DRY_RUN) {
      console.log('\n  Next steps:');
      console.log('    1. npm run smoke        # verify the app boots and routes respond');
      console.log('    2. npm start            # start the server');
      if (runStaff) {
        console.log(`    3. Sign in at /${process.env.ADMIN_PATH || 'dev-cp'}/login`);
        console.log(`       mdshojibmiya / ${SEED_PASSWORD}`);
      }
      console.log('');
    }
  } catch (err) {
    console.error('\n  ✗ Installation failed');
    console.error(`    ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    if (!DRY_RUN) await db.close();
  }
}

main()
  .catch((err) => {
    console.error('\n  ✗ Installer crashed');
    console.error(`    ${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  // Exit explicitly. mysql2 can leave a handle open, and in --dry-run nothing
  // is closed at all, so the process would otherwise sit there after printing
  // its summary and look like a hang.
  .finally(() => {
    process.exit(process.exitCode || 0);
  });
