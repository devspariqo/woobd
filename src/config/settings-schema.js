/**
 * The settings registry.
 *
 * Every admin-editable value is declared here exactly once, with a type, a
 * group and a default. The admin UI, the insert statements and the public-site
 * accessor are all generated from this list, so a new setting needs exactly one
 * edit rather than four.
 */
'use strict';

/**
 * type     - how the admin form renders and validates it
 * group    - which tab of /admin/settings it appears under
 * public   - safe to expose to a logged-out visitor (never true for secrets)
 */
const SETTINGS = [
  // ---------------- General ----------------
  { key: 'site_name', type: 'text', group: 'general', default: 'WooBD.Com', public: true, label: 'Site name' },
  { key: 'site_tagline', type: 'text', group: 'general', default: 'E-commerce Website Design Agency in Bangladesh', public: true, label: 'Tagline' },
  { key: 'site_description', type: 'textarea', group: 'general', default: 'WooBD.Com is a Bangladesh-based web design agency building high-converting e-commerce stores, custom websites and digital storefronts for growing brands.', public: true, label: 'Site description' },
  { key: 'contact_email', type: 'text', group: 'general', default: 'hello@woobd.com', public: true, label: 'Contact email' },
  { key: 'contact_phone', type: 'text', group: 'general', default: '+8801789668276', public: true, label: 'Contact phone' },
  { key: 'whatsapp_number', type: 'text', group: 'general', default: '+8801789668276', public: true, label: 'WhatsApp number' },
  { key: 'whatsapp_link', type: 'text', group: 'general', default: 'https://wa.me/8801789668276', public: true, label: 'WhatsApp link' },
  { key: 'office_address', type: 'text', group: 'general', default: 'House 72, RK Road, Rangpur, Bangladesh', public: true, label: 'Office address' },
  { key: 'office_hours', type: 'text', group: 'general', default: 'Sat - Thu, 10:00 AM - 7:00 PM', public: true, label: 'Office hours' },
  { key: 'currency_code', type: 'text', group: 'general', default: 'BDT', public: true, label: 'Currency code' },
  { key: 'currency_symbol', type: 'text', group: 'general', default: '৳', public: true, label: 'Currency symbol' },

  // ---------------- Branding ----------------
  { key: 'logo_light', type: 'file', group: 'branding', default: '', public: true, label: 'Logo (light mode)' },
  { key: 'logo_dark', type: 'file', group: 'branding', default: '', public: true, label: 'Logo (dark mode)' },
  { key: 'logo_footer', type: 'file', group: 'branding', default: '', public: true, label: 'Footer logo' },
  { key: 'favicon', type: 'file', group: 'branding', default: '', public: true, label: 'Favicon' },
  { key: 'logo_width', type: 'number', group: 'branding', default: '160', public: true, label: 'Logo width (px)' },
  {
    key: 'auth_bg_image',
    type: 'file',
    group: 'branding',
    default: '',
    public: true,
    label: 'Sign-in page background image',
    help: 'Behind the panel on the left of the sign-in and sign-up pages. A portrait or square image works best. It is darkened automatically so the white text on top stays readable — leave empty to keep the brand gradient.',
  },
  {
    key: 'auth_bg_overlay',
    type: 'select',
    group: 'branding',
    default: 'dark',
    public: true,
    label: 'Sign-in background treatment',
    options: ['dark', 'heavy', 'light'],
    help: 'How heavily to darken the image. Use a heavier option if your photo is light or busy.',
  },

  // ---------------- Theme / colours ----------------
  { key: 'theme_primary', type: 'text', group: 'theme', default: '#5b21f0', public: true, label: 'Primary colour' },
  { key: 'theme_primary_dark', type: 'text', group: 'theme', default: '#4316c4', public: true, label: 'Primary dark' },
  { key: 'theme_secondary', type: 'text', group: 'theme', default: '#ff6600', public: true, label: 'Accent / secondary colour' },
  { key: 'theme_success', type: 'text', group: 'theme', default: '#0f9d58', public: true, label: 'Success colour' },
  { key: 'theme_danger', type: 'text', group: 'theme', default: '#e02b2b', public: true, label: 'Danger colour' },
  { key: 'theme_warning', type: 'text', group: 'theme', default: '#f0a020', public: true, label: 'Warning colour' },
  { key: 'theme_bg_light', type: 'text', group: 'theme', default: '#ffffff', public: true, label: 'Light background' },
  { key: 'theme_bg_light_alt', type: 'text', group: 'theme', default: '#f5f6fb', public: true, label: 'Light background (section break)' },
  { key: 'theme_text_light', type: 'text', group: 'theme', default: '#101223', public: true, label: 'Light text' },
  { key: 'theme_bg_dark', type: 'text', group: 'theme', default: '#0c0e1a', public: true, label: 'Dark background' },
  { key: 'theme_bg_dark_alt', type: 'text', group: 'theme', default: '#131629', public: true, label: 'Dark background (section break)' },
  { key: 'theme_text_dark', type: 'text', group: 'theme', default: '#eef0f8', public: true, label: 'Dark text' },
  { key: 'theme_radius', type: 'text', group: 'theme', default: '12px', public: true, label: 'Border radius' },
  { key: 'default_color_mode', type: 'select', group: 'theme', default: 'light', public: true, label: 'Default colour mode', options: ['light', 'dark'] },
  { key: 'show_theme_toggle', type: 'boolean', group: 'theme', default: '1', public: true, label: 'Show dark/light toggle' },

  // ---------------- Typography ----------------
  { key: 'font_heading', type: 'select', group: 'typography', default: 'Inter', public: true, label: 'Heading font', options: ['Inter', 'Poppins', 'Manrope', 'Plus Jakarta Sans', 'Sora', 'DM Sans', 'Outfit'] },
  { key: 'font_body', type: 'select', group: 'typography', default: 'Inter', public: true, label: 'Body font', options: ['Inter', 'Poppins', 'Manrope', 'Plus Jakarta Sans', 'DM Sans', 'Outfit', 'System UI'] },
  { key: 'font_base_size', type: 'number', group: 'typography', default: '16', public: true, label: 'Base font size (px)' },
  { key: 'font_weight_heading', type: 'select', group: 'typography', default: '700', public: true, label: 'Heading weight', options: ['600', '700', '800'] },

  // ---------------- SEO ----------------
  { key: 'seo_meta_title', type: 'text', group: 'seo', default: 'WooBD.Com - E-commerce Website Design Agency in Bangladesh', public: true, label: 'Default meta title' },
  { key: 'seo_meta_description', type: 'textarea', group: 'seo', default: 'We design and build high-converting e-commerce websites for Bangladeshi brands. Fast, mobile-first, SEO-ready storefronts with ongoing support.', public: true, label: 'Default meta description' },
  { key: 'seo_meta_keywords', type: 'textarea', group: 'seo', default: 'ecommerce website design bangladesh, woocommerce expert, woobd, website design rangpur, online store setup', public: true, label: 'Meta keywords' },
  { key: 'seo_og_image', type: 'file', group: 'seo', default: '', public: true, label: 'Default OG image (1200x630)' },
  { key: 'seo_robots', type: 'select', group: 'seo', default: 'index,follow', public: true, label: 'Robots directive', options: ['index,follow', 'noindex,nofollow', 'index,nofollow', 'noindex,follow'] },
  { key: 'google_analytics_id', type: 'text', group: 'seo', default: '', public: true, label: 'Google Analytics ID' },
  { key: 'google_site_verification', type: 'text', group: 'seo', default: '', public: true, label: 'Google site verification' },
  { key: 'facebook_pixel_id', type: 'text', group: 'seo', default: '', public: true, label: 'Facebook Pixel ID' },

  // ---------------- Crawler files ----------------
  //
  // robots.txt and sitemap.xml are generated from the database on every
  // request, so they are correct by construction - a new package or article
  // appears without anyone maintaining a list. What an operator still needs is
  // a say in what gets listed and what crawlers are told, which is what this
  // group is.
  //
  // The staging switch matters more than it looks: a site that is publicly
  // reachable before launch gets indexed, and the first impression Google forms
  // of it is a half-finished page. `robots_block_all` is the one switch that
  // prevents that without touching DNS or the webserver config.
  { key: 'robots_enabled', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Serve robots.txt', help: 'Turn off and /robots.txt returns 404, leaving crawlers to their default behaviour. Leave on unless another system serves this file.' },
  { key: 'robots_block_all', type: 'boolean', group: 'seo_files', default: '0', public: false, label: 'Discourage all crawlers (staging)', help: 'Emits "Disallow: /" for every agent. Use on a staging or pre-launch copy; turn it off before the real site goes live or it will never be indexed.' },
  { key: 'robots_crawl_delay', type: 'number', group: 'seo_files', default: '0', public: false, label: 'Crawl delay (seconds)', help: 'Seconds between requests for polite crawlers. 0 omits the directive, which is what Google recommends - it ignores Crawl-delay and honours the Search Console setting instead.' },
  { key: 'robots_extra_disallow', type: 'textarea', group: 'seo_files', default: '', public: false, label: 'Extra Disallow paths', help: 'One path per line, each starting with a slash. Added to the built-in list that already covers the admin panel, the account area and filtered listings.' },
  { key: 'robots_custom', type: 'textarea', group: 'seo_files', default: '', public: false, label: 'Extra robots.txt lines', help: 'Appended verbatim at the end. Use for Sitemap lines for other sections, or a Host directive. Anything typed here is not validated.' },
  { key: 'sitemap_enabled', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Serve sitemap.xml', help: 'Publishes an XML sitemap built from the live content. Turning this off also removes the Sitemap line from robots.txt.' },
  { key: 'sitemap_include_services', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Include packages and services' },
  { key: 'sitemap_include_portfolio', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Include portfolio projects' },
  { key: 'sitemap_include_pages', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Include CMS pages' },
  { key: 'sitemap_include_posts', type: 'boolean', group: 'seo_files', default: '1', public: false, label: 'Include blog posts' },
  { key: 'sitemap_cache_minutes', type: 'number', group: 'seo_files', default: '15', public: false, label: 'Sitemap cache (minutes)', help: 'The sitemap runs several queries. Caching it keeps a crawler walking every URL from turning into hundreds of database round trips. 0 rebuilds it on every request.' },

  // ---------------- Header / CTA ----------------
  { key: 'topbar_enabled', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show topbar' },
  { key: 'topbar_text', type: 'text', group: 'header', default: 'Need an online store that actually sells? Free consultation available.', public: true, label: 'Topbar text' },
  { key: 'topbar_show_phone', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show phone in topbar' },
  { key: 'topbar_show_email', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show email in topbar' },
  { key: 'topbar_show_socials', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show socials in topbar' },
  { key: 'header_sticky', type: 'boolean', group: 'header', default: '1', public: true, label: 'Sticky header on scroll' },
  { key: 'header_cta_text', type: 'text', group: 'header', default: 'Get a Free Quote', public: true, label: 'Header CTA text' },
  { key: 'header_cta_link', type: 'text', group: 'header', default: '/contact', public: true, label: 'Header CTA link' },
  { key: 'header_cta_enabled', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show header CTA' },
  { key: 'auth_buttons_enabled', type: 'boolean', group: 'header', default: '1', public: true, label: 'Show sign in / sign up' },

  // ---------------- Footer ----------------
  { key: 'footer_about', type: 'textarea', group: 'footer', default: 'WooBD.Com builds e-commerce websites that load fast, rank well and convert visitors into customers. Based in Rangpur, serving brands across Bangladesh.', public: true, label: 'Footer about text' },
  { key: 'footer_credit_text', type: 'text', group: 'footer', default: 'WooBD.Com — All rights reserved.', public: true, label: 'Footer credit text' },
  { key: 'footer_credit_link_text', type: 'text', group: 'footer', default: 'WooBD.Com', public: true, label: 'Credit link text' },
  { key: 'footer_credit_link', type: 'text', group: 'footer', default: 'https://woobd.com', public: true, label: 'Credit link' },
  { key: 'footer_show_newsletter', type: 'boolean', group: 'footer', default: '1', public: true, label: 'Show newsletter signup' },
  { key: 'footer_payment_note', type: 'textarea', group: 'footer', default: 'We accept bKash, Nagad, Rocket, and major cards.', public: true, label: 'Payment note' },

  // ---------------- Social links ----------------
  { key: 'social_facebook', type: 'text', group: 'social', default: 'https://facebook.com/woobd', public: true, label: 'Facebook URL' },
  { key: 'social_linkedin', type: 'text', group: 'social', default: 'https://linkedin.com/company/woobd', public: true, label: 'LinkedIn URL' },
  { key: 'social_instagram', type: 'text', group: 'social', default: 'https://instagram.com/woobd', public: true, label: 'Instagram URL' },
  { key: 'social_youtube', type: 'text', group: 'social', default: 'https://youtube.com/@woobd', public: true, label: 'YouTube URL' },

  // ---------------- Homepage ----------------
  { key: 'hero_badge', type: 'text', group: 'homepage', default: 'Trusted by 200+ Bangladeshi brands', public: true, label: 'Hero badge text' },
  { key: 'hero_title', type: 'text', group: 'homepage', default: 'We build e-commerce websites that', public: true, label: 'Hero title (before highlight)' },
  { key: 'hero_typing_text', type: 'text', group: 'homepage', default: 'sell more,load faster,rank higher,look stunning', public: true, label: 'Hero typing words (comma separated)' },
  { key: 'hero_subtitle', type: 'text', group: 'homepage', default: 'Bangladesh-based design & development studio', public: true, label: 'Hero subtitle' },
  { key: 'hero_paragraph', type: 'textarea', group: 'homepage', default: 'From product catalogue to checkout, we design and build complete online stores for Bangladeshi businesses — mobile-first, SEO-ready and fast on every connection.', public: true, label: 'Hero paragraph' },
  { key: 'hero_primary_cta_text', type: 'text', group: 'homepage', default: 'View Packages', public: true, label: 'Hero primary CTA text' },
  { key: 'hero_primary_cta_link', type: 'text', group: 'homepage', default: '/services', public: true, label: 'Hero primary CTA link' },
  { key: 'hero_secondary_cta_text', type: 'text', group: 'homepage', default: 'Talk to Us', public: true, label: 'Hero secondary CTA text' },
  { key: 'hero_secondary_cta_link', type: 'text', group: 'homepage', default: '/contact', public: true, label: 'Hero secondary CTA link' },
  { key: 'hero_bullets', type: 'textarea', group: 'homepage', default: 'Free consultation & strategy call,No hidden charges — fixed pricing,Money-back guarantee on delivery,Support in Bangla and English', public: true, label: 'Hero bullets (comma separated)', help: 'Four works best — they sit in a two-column grid.' },
  { key: 'hero_image', type: 'file', group: 'homepage', default: '', public: true, label: 'Hero image', help: 'Used when the hero media type is "Image", and as the video poster.' },
  {
    key: 'hero_media_type',
    type: 'select',
    group: 'homepage',
    default: 'video',
    public: true,
    label: 'Hero media type',
    options: ['video', 'image'],
    help: 'Video plays in the space beside the hero text. It falls back to the image automatically when no video is set.',
  },
  {
    key: 'hero_video',
    type: 'file',
    group: 'homepage',
    default: '',
    public: true,
    label: 'Hero video',
    help: 'MP4 or WebM, up to 60 MB. Uploaded videos play muted and looped so browsers allow autoplay.',
  },
  {
    key: 'hero_video_url',
    type: 'text',
    group: 'homepage',
    default: '',
    public: true,
    label: 'Hero video URL (optional)',
    help: 'A direct .mp4 or .webm link. Overrides the uploaded file — useful for a large video hosted elsewhere.',
  },
  { key: 'hero_video_autoplay', type: 'boolean', group: 'homepage', default: '1', public: true, label: 'Autoplay the hero video' },
  { key: 'hero_video_loop', type: 'boolean', group: 'homepage', default: '1', public: true, label: 'Loop the hero video' },
  { key: 'hero_video_controls', type: 'boolean', group: 'homepage', default: '1', public: true, label: 'Show video controls' },
  { key: 'trustbar_title', type: 'text', group: 'homepage', default: 'Trusted by growing brands across Bangladesh', public: true, label: 'Trust bar title' },

  // --- Pricing section -----------------------------------------------------
  // The term toggle above the package cards. Two discounts, applied to the
  // monthly price over the term, so each card can show a monthly equivalent
  // rather than a lump sum - which is what the visitor is actually comparing.
  {
    key: 'pricing_show_terms',
    type: 'boolean',
    group: 'homepage',
    default: '1',
    public: true,
    label: 'Show the term toggle on packages',
    help: 'The Monthly / 6 Months / Yearly switch above the package cards.',
  },
  { key: 'pricing_6mo_discount', type: 'number', group: 'homepage', default: '10', public: true, label: '6-month discount (%)', help: 'Shown as the saving on the 6 Months option.' },
  { key: 'pricing_12mo_discount', type: 'number', group: 'homepage', default: '25', public: true, label: 'Yearly discount (%)', help: 'A package with its own yearly discount uses that instead.' },
  {
    key: 'pricing_popular_index',
    type: 'number',
    group: 'homepage',
    default: '3',
    public: true,
    label: 'Highlight which package card',
    help: 'Card number to highlight, counting from 1. Set 0 for none. Four cards with the third highlighted is the usual arrangement.',
  },

  // --- Blog section on the homepage ----------------------------------------
  {
    key: 'blog_show_on_home',
    type: 'boolean',
    group: 'homepage',
    default: '1',
    public: true,
    label: 'Show the blog section on the homepage',
    help: 'Lists the most recent articles. Nothing appears if there are no published posts, whatever this is set to.',
  },
  { key: 'blog_section_title', type: 'text', group: 'homepage', default: 'Ideas, guides and what we are learning', public: true, label: 'Blog section title' },
  { key: 'blog_section_text', type: 'textarea', group: 'homepage', default: 'Practical writing on selling online in Bangladesh — no filler, no listicles.', public: true, label: 'Blog section text' },
  { key: 'blog_home_count', type: 'number', group: 'homepage', default: '3', public: true, label: 'Articles on the homepage', help: 'Three fits the row.' },
  { key: 'about_title', type: 'text', group: 'homepage', default: 'A design studio that understands Bangladeshi e-commerce', public: true, label: 'About title' },
  { key: 'about_text', type: 'textarea', group: 'homepage', default: 'Since day one we have focused on one thing: online stores that convert. We handle design, development, payment integration and post-launch support so you can focus on sourcing and selling.', public: true, label: 'About text' },
  { key: 'about_image', type: 'file', group: 'homepage', default: '', public: true, label: 'About image' },
  { key: 'about_years', type: 'text', group: 'homepage', default: '6+', public: true, label: 'About stat: years' },
  { key: 'about_projects', type: 'text', group: 'homepage', default: '240+', public: true, label: 'About stat: projects' },
  { key: 'about_clients', type: 'text', group: 'homepage', default: '200+', public: true, label: 'About stat: clients' },
  { key: 'about_rating', type: 'text', group: 'homepage', default: '4.9', public: true, label: 'About stat: rating' },
  { key: 'cta_title', type: 'text', group: 'homepage', default: 'Ready to launch your online store?', public: true, label: 'CTA section title' },
  { key: 'cta_text', type: 'textarea', group: 'homepage', default: 'Tell us about your business and we will send a free quote within one business day.', public: true, label: 'CTA section text' },
  {
    key: 'cta_bg_image',
    type: 'file',
    group: 'homepage',
    default: '',
    public: true,
    label: 'CTA background image',
    help: 'Sits behind the call-to-action section and stays put as the page scrolls. A wide photo, at least 1600px, works best. It is darkened and blurred automatically so the text on top stays readable.',
  },
  {
    key: 'cta_bg_overlay',
    type: 'select',
    group: 'homepage',
    default: 'dark-blur',
    public: true,
    label: 'CTA background treatment',
    options: ['dark-blur', 'dark', 'blur', 'none'],
    help: 'How heavily to treat the image. Use a heavier option if your photo is busy or light — the white text sits directly on it.',
  },

  // ---------------- Maintenance ----------------
  { key: 'maintenance_mode', type: 'boolean', group: 'maintenance', default: '0', public: true, label: 'Enable maintenance mode' },
  { key: 'maintenance_message', type: 'textarea', group: 'maintenance', default: 'We are performing scheduled maintenance and will be back shortly. Thank you for your patience.', public: true, label: 'Maintenance message' },
  { key: 'maintenance_title', type: 'text', group: 'maintenance', default: 'We will be right back', public: true, label: 'Maintenance title' },

  // ---------------- Security ----------------
  { key: 'admin_path_slug', type: 'text', group: 'security', default: 'dev-cp', public: false, label: 'Admin panel path slug', help: 'The URL segment the admin panel lives at. Changing this immediately changes the panel address, and /admin stops working - which is the point. Use lowercase letters, numbers and hyphens.' },
  { key: 'max_login_attempts', type: 'number', group: 'security', default: '5', public: false, label: 'Max login attempts', help: 'Failed sign-in attempts before the account is temporarily locked.' },
  { key: 'lockout_minutes', type: 'number', group: 'security', default: '15', public: false, label: 'Lockout duration (minutes)', help: 'How long a locked account stays locked before another attempt is allowed.' },
  { key: 'captcha_on_login', type: 'boolean', group: 'security', default: '1', public: true, label: 'CAPTCHA on customer sign in', help: 'Show the reCAPTCHA checkbox on the customer sign-in form.' },
  { key: 'captcha_on_signup', type: 'boolean', group: 'security', default: '1', public: true, label: 'CAPTCHA on customer sign up', help: 'Show the reCAPTCHA checkbox on the customer sign-up form.' },
  { key: 'captcha_on_admin', type: 'boolean', group: 'security', default: '1', public: true, label: 'CAPTCHA on admin login', help: 'Show the reCAPTCHA checkbox on this admin panel login page.' },
  { key: 'captcha_on_contact', type: 'boolean', group: 'security', default: '1', public: true, label: 'CAPTCHA on contact form', help: 'Show the reCAPTCHA checkbox on the public contact form.' },
  { key: 'captcha_site_key', type: 'text', group: 'security', default: '', public: true, label: 'reCAPTCHA site key', help: 'Public key from your Google reCAPTCHA registration. Safe to expose to browsers. The key must also list every hostname you open the site on — Google will not draw the box on an unregistered domain, and the page cannot read the error it shows.' },
  {
    key: 'captcha_mode',
    type: 'select',
    group: 'security',
    default: 'invisible',
    public: true,
    label: 'reCAPTCHA style',
    options: ['invisible', 'checkbox'],
    help: 'Invisible shows no box — the challenge only appears if Google is unsure. It needs a key registered as "reCAPTCHA v2 - Invisible". Choose "checkbox" if your key is the standard tick-box type.',
  },
  { key: 'captcha_secret_key', type: 'text', group: 'security', default: '', public: false, label: 'reCAPTCHA secret key', help: 'Private key from the same registration. Never sent to the browser. Leave blank to keep the saved value.' },
  {
    key: 'captcha_version',
    type: 'select',
    group: 'security',
    default: 'v2',
    public: true,
    label: 'reCAPTCHA version',
    options: ['v2', 'v3'],
    help: 'Must match the key you created. A v3 key cannot render a v2 widget at all — it fails with an error instead of showing a box — and a v2 key cannot produce a v3 token. If the widget shows nothing, this is the first thing to check.',
  },
  {
    key: 'captcha_min_score',
    type: 'number',
    group: 'security',
    default: '50',
    public: false,
    label: 'v3 minimum score (0-100)',
    help: 'reCAPTCHA v3 only. Scores run 0 (almost certainly a bot) to 100 (almost certainly human). Anything below this is rejected. 50 is Google\'s recommended starting point; lower it if real customers are being turned away.',
  },
  { key: 'force_https', type: 'boolean', group: 'security', default: '1', public: false, label: 'Force HTTPS redirect', help: 'Redirect plain-HTTP visitors to HTTPS. Leave on in production; it has no effect on localhost.' },

  // ---------------- Google auth ----------------
  { key: 'google_auth_enabled', type: 'boolean', group: 'google', default: '1', public: true, label: 'Enable Google sign in', help: 'Master switch for customer Google sign-in. Turning this off hides the Google buttons everywhere, even if the credentials below are still saved.' },
  { key: 'google_client_id', type: 'text', group: 'google', default: '', public: false, label: 'Google client ID', help: 'OAuth 2.0 client ID from Google Cloud Console. The authorised redirect URI must be exactly {your site URL}/auth/google/callback' },
  { key: 'google_client_secret', type: 'text', group: 'google', default: '', public: false, label: 'Google client secret', help: 'OAuth client secret from the same Google Cloud Console credential. Leave blank to keep the saved value.' },
  { key: 'google_auth_on_login', type: 'boolean', group: 'google', default: '1', public: true, label: 'Google button on sign in', help: 'Show "Continue with Google" on the customer sign-in page. Requires Google sign-in to be enabled above.' },
  { key: 'google_auth_on_signup', type: 'boolean', group: 'google', default: '1', public: true, label: 'Google button on sign up', help: 'Show "Sign up with Google" on the customer sign-up page. Requires Google sign-in to be enabled above.' },

  // ---------------- SMTP ----------------
  { key: 'smtp_enabled', type: 'boolean', group: 'smtp', default: '1', public: false, label: 'Enable outgoing mail' },
  { key: 'smtp_host', type: 'text', group: 'smtp', default: 'smtp.hostinger.com', public: false, label: 'SMTP host' },
  { key: 'smtp_port', type: 'number', group: 'smtp', default: '465', public: false, label: 'SMTP port' },
  { key: 'smtp_secure', type: 'boolean', group: 'smtp', default: '1', public: false, label: 'Use TLS/SSL' },
  { key: 'smtp_user', type: 'text', group: 'smtp', default: 'hello@woobd.com', public: false, label: 'SMTP username' },
  { key: 'smtp_password', type: 'text', group: 'smtp', default: '', public: false, label: 'SMTP password' },
  { key: 'mail_from_name', type: 'text', group: 'smtp', default: 'WooBD.Com', public: false, label: 'From name' },
  { key: 'mail_from_email', type: 'text', group: 'smtp', default: 'hello@woobd.com', public: false, label: 'From email' },
  { key: 'notify_admin_new_order', type: 'boolean', group: 'smtp', default: '1', public: false, label: 'Email admin on new order' },
  { key: 'notify_customer_order_status', type: 'boolean', group: 'smtp', default: '1', public: false, label: 'Email customer on status change', help: 'Sends the customer a message every time an order status changes — in progress, completed or cancelled — not only when the site goes live.' },
  {
    key: 'notify_admin_email',
    type: 'text',
    group: 'smtp',
    default: '',
    public: false,
    label: 'Send admin notifications to',
    help: 'Where new-order and contact-form alerts go. Leave blank to use the public contact address above. Set this when the contact address is a shared or public mailbox and you would rather alerts land somewhere private.',
  },
  {
    key: 'notify_admin_contact',
    type: 'boolean',
    group: 'smtp',
    default: '1',
    public: false,
    label: 'Email admin on contact form',
    help: 'Sends an alert when someone submits the contact form or the homepage quote request. The customer always gets an acknowledgement either way.',
  },

  // ---------------- Payments ----------------
  //
  // Generated from src/config/payment-methods.js, which the context middleware,
  // the public views and the customer controller all read as well. Adding a
  // method there adds its fields here, offers it at checkout and accepts it on
  // submit - in one edit, instead of five that have to be kept in step.
  ...paymentMethods(),

  { key: 'payment_instructions', type: 'textarea', group: 'payments', default: 'Send the exact amount to one of the numbers below, then submit the transaction ID on the order page. We verify payments within 24 hours.', public: true, label: 'Payment instructions' },
  { key: 'invoice_prefix', type: 'text', group: 'payments', default: 'INV-', public: false, label: 'Invoice prefix' },
  { key: 'order_prefix', type: 'text', group: 'payments', default: 'WBD-', public: false, label: 'Order prefix' },
  { key: 'tax_percent', type: 'number', group: 'payments', default: '0', public: true, label: 'Tax / VAT (%)' },

  // ---------------- Live chat ----------------
  { key: 'chat_enabled', type: 'boolean', group: 'chat', default: '1', public: true, label: 'Enable live chat assistant' },
  { key: 'chat_show_on_public', type: 'boolean', group: 'chat', default: '1', public: true, label: 'Show widget on public pages' },
  { key: 'chat_show_on_dashboard', type: 'boolean', group: 'chat', default: '1', public: true, label: 'Show widget in customer dashboard' },
  { key: 'chat_position', type: 'select', group: 'chat', default: 'right', public: true, label: 'Widget position', options: ['right', 'left'] },
  { key: 'chat_widget_title', type: 'text', group: 'chat', default: 'WooBD Assistant', public: true, label: 'Widget title' },
  { key: 'chat_widget_subtitle', type: 'text', group: 'chat', default: 'Usually replies instantly', public: true, label: 'Widget subtitle' },
  { key: 'chat_accent_color', type: 'text', group: 'chat', default: '#25D366', public: true, label: 'Widget accent colour', help: 'Launcher, header and message bubbles. Leave as #25D366 for the standard green.' },
  { key: 'chat_greeting', type: 'textarea', group: 'chat', default: 'Hi! I am the WooBD assistant. Ask me about packages, pricing, delivery time or payment methods.', public: true, label: 'Greeting message' },
  { key: 'chat_api_key', type: 'text', group: 'chat', default: '', public: false, label: 'Chat API key (single)' },
  {
    key: 'chat_api_keys',
    type: 'textarea',
    group: 'chat',
    default: '',
    public: false,
    label: 'Chat API keys (one per line)',
    help: 'Tried in order until one answers, so a key that runs out of credit does not take the assistant offline. Overrides the single key above. Leave blank to use the key in .env.',
  },
  { key: 'chat_base_url', type: 'text', group: 'chat', default: 'https://api.xkiro.com/v1/chat/completions', public: false, label: 'Chat API endpoint' },
  { key: 'chat_model', type: 'text', group: 'chat', default: 'qwen/qwen3.8-omni-flash:free', public: false, label: 'Chat model' },
  { key: 'chat_system_prompt', type: 'textarea', group: 'chat', default: 'You are the friendly sales assistant for WooBD.Com, a Bangladesh-based e-commerce website design agency located at House 72, RK Road, Rangpur. We build online stores, custom websites and digital storefronts. Answer questions about packages, pricing in BDT, delivery time, payment methods (bKash, Nagad, Rocket, card) and support. Be concise, warm and helpful. If asked something you do not know, offer to connect the visitor with the team on WhatsApp +8801789668276 or hello@woobd.com. Never invent prices - refer to the packages page instead.', public: false, label: 'System prompt' },
  { key: 'chat_max_history', type: 'number', group: 'chat', default: '10', public: false, label: 'Max messages of context' },
  { key: 'chat_rate_limit', type: 'number', group: 'chat', default: '20', public: false, label: 'Messages per hour per visitor' },

  // ---------------- Orders / delivery ----------------
  { key: 'order_auto_activate_payment', type: 'boolean', group: 'orders', default: '0', public: false, label: 'Auto-approve manual payments' },
  { key: 'default_delivery_days', type: 'number', group: 'orders', default: '7', public: false, label: 'Default delivery days' },
  { key: 'allow_customer_signup', type: 'boolean', group: 'orders', default: '1', public: true, label: 'Allow new customer registration' },
  { key: 'require_email_verify', type: 'boolean', group: 'orders', default: '0', public: false, label: 'Require email verification' },

  // ---------------- Per-page hero backgrounds ----------------
  //
  // Generated rather than written out one row at a time: five pages times three
  // settings is fifteen near-identical declarations, and typing them by hand is
  // how one page quietly ends up with a setting the others do not have. The
  // page keys here are the same strings the templates pass to the shared
  // page-hero partial, so adding a page means adding one line to this list.
  ...heroBackgrounds(),

  // The CTA band already had an image and a treatment; it just had no way to
  // set a flat colour for sites with no photography to hand.
  {
    key: 'cta_bg_color',
    type: 'text',
    group: 'homepage',
    default: '',
    public: true,
    label: 'CTA background colour',
    help: 'Used when no background image is set, and as a tint under one when it is. Leave blank for the theme default.',
  },

  // ---------------- Email branding ----------------
  //
  // The emails were built from the site's own logo setting, which is empty on a
  // fresh install and points at an SVG on most others - and email clients
  // refuse to render SVG. So the header fell back to plain text, or to a broken
  // image, on every message. A dedicated setting, defaulting to a raster file,
  // is the fix.
  {
    key: 'email_logo',
    type: 'file',
    group: 'email',
    default: '',
    public: true,
    label: 'Email logo',
    help: 'Shown at the top of every email. Use a PNG or JPG — Gmail, Outlook and most other clients refuse to display SVG, and a broken logo in every message is worse than none. Leave blank to use the site logo, or to show the site name as text.',
  },
  {
    key: 'email_logo_width',
    type: 'number',
    group: 'email',
    default: '200',
    public: true,
    label: 'Email logo width (px)',
    help: 'The logo is scaled to this width. 200px fits the 600px email layout comfortably.',
  },
  {
    key: 'email_header_bg',
    type: 'text',
    group: 'email',
    default: '#ffffff',
    public: true,
    label: 'Email header background',
    help: 'Behind the logo. Use a light colour for a dark logo, or a dark colour for a light one.',
  },
  {
    key: 'email_accent',
    type: 'text',
    group: 'email',
    default: '',
    public: true,
    label: 'Email accent colour',
    help: 'Buttons and links in every email. Leave blank to follow the theme colour.',
  },
  {
    key: 'email_footer_note',
    type: 'textarea',
    group: 'email',
    default: '',
    public: true,
    label: 'Email footer note',
    help: 'A line under the address block — a company number, or a note about why the recipient is receiving this. Leave blank for none.',
  },
  {
    key: 'email_show_socials',
    type: 'boolean',
    group: 'email',
    default: '1',
    public: true,
    label: 'Show social links in emails',
  },

  // ---------------- Email templates ----------------
  //
  // Generated from src/config/email-templates.js, which the mail service reads
  // as well - one list, so an editable field can never point at a template that
  // no longer exists.
  ...emailTemplates(),

];

/**
 * An editable field set for every payment method.
 *
 * Grouped so the switch, the receiving details and the logo sit together, and
 * so a method added to the registry appears in the panel without anybody having
 * to remember to add it.
 */
function paymentMethods() {
  const { PAYMENT_METHODS } = require('./payment-methods');
  const out = [];

  for (const method of PAYMENT_METHODS) {
    out.push({
      key: `payment_${method.key}_enabled`,
      type: 'boolean',
      group: 'payments',
      default: method.enabled ? '1' : '0',
      public: true,
      label: `Enable ${method.label}`,
      help: method.blurb,
    });

    if (method.kind === 'wallet') {
      out.push(
        {
          key: `payment_${method.key}_number`,
          type: 'text',
          group: 'payments',
          default: method.number || '',
          public: true,
          label: `${method.label} number`,
          help: 'The wallet number customers send money to.',
        },
        {
          key: `payment_${method.key}_type`,
          type: 'select',
          group: 'payments',
          default: method.accountType || 'Personal',
          public: true,
          label: `${method.label} account type`,
          options: ['Personal', 'Merchant'],
        }
      );
    } else {
      out.push({
        key: `payment_${method.key}_note`,
        type: 'textarea',
        group: 'payments',
        default: method.note || '',
        public: true,
        label: `${method.label} instructions`,
        help: 'Shown to the customer at checkout. For a bank transfer this is where the account details go.',
      });
    }

    out.push({
      key: `payment_${method.key}_logo`,
      type: 'file',
      group: 'payments',
      default: '',
      public: true,
      label: `${method.label} logo`,
      help: 'Shown in the footer and on the package pages. Without it the method is shown as a text badge, so this is optional.',
    });
  }

  return out;
}

/**
 * An editable subject and heading for every email the application sends.
 *
 * Two fields per template rather than a free-text body editor: the body is
 * built from live order and customer data, and a hand-editable HTML body would
 * either break that or have to be a full templating language. Subject and
 * heading cover what actually changes per site - the wording.
 */
function emailTemplates() {
  const { TEMPLATES } = require('./email-templates');
  const out = [];

  for (const template of TEMPLATES) {
    const vars = template.vars.map((name) => `{${name}}`).join(', ');

    out.push(
      {
        key: `email_tpl_${template.key}_subject`,
        type: 'text',
        group: 'email',
        default: '',
        public: false,
        label: `${template.label} — subject`,
        help: `Leave blank for the default: "${template.subject}". Placeholders you can use: ${vars}.`,
      },
      {
        key: `email_tpl_${template.key}_heading`,
        type: 'text',
        group: 'email',
        default: '',
        public: false,
        label: `${template.label} — heading`,
        help: `The large line at the top of the email. Leave blank for the default: "${template.heading}".`,
      }
    );
  }

  return out;
}

/**
 * Background image, colour and treatment for each inner-page hero.
 *
 * Each hero falls back to the theme's alternate background when nothing is set,
 * so an untouched page looks exactly as it did before this existed.
 */
function heroBackgrounds() {
  const pages = [
    ['services', 'Packages listing'],
    ['service', 'Single package'],
    ['about', 'About'],
    ['portfolio', 'Portfolio listing'],
    ['post', 'Single blog post'],
  ];

  const out = [];

  for (const [key, label] of pages) {
    out.push(
      {
        key: `hero_${key}_bg_image`,
        type: 'file',
        group: 'page_hero',
        default: '',
        public: true,
        label: `${label} — background image`,
        help: 'Wide photo, at least 1600px. It is darkened and blurred behind the heading so the text on top stays readable.',
      },
      {
        key: `hero_${key}_bg_color`,
        type: 'text',
        group: 'page_hero',
        default: '',
        public: true,
        label: `${label} — background colour`,
        help: 'Used on its own when no image is set. Leave blank to keep the theme background.',
      },
      {
        key: `hero_${key}_bg_overlay`,
        type: 'select',
        group: 'page_hero',
        default: 'dark-blur',
        public: true,
        label: `${label} — image treatment`,
        options: ['dark-blur', 'dark', 'blur', 'none'],
        help: 'How heavily to treat the image. Use a heavier option if the photo is busy or light.',
      }
    );
  }

  return out;
}

/** Fast lookup by key. */
const BY_KEY = SETTINGS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

/** Keys that must never leave the server. */
const SECRET_KEYS = new Set(
  SETTINGS.filter((s) => /(?:secret|password|api_key|client_secret|private)/i.test(s.key)).map((s) => s.key)
);

/** Grouped for rendering the admin settings tabs. */
const BY_GROUP = SETTINGS.reduce((acc, item) => {
  (acc[item.group] = acc[item.group] || []).push(item);
  return acc;
}, {});

const GROUP_LABELS = {
  general: 'General',
  branding: 'Branding & Logos',
  theme: 'Theme & Colours',
  typography: 'Typography',
  seo: 'SEO & Analytics',
  seo_files: 'Robots & Sitemap',
  page_hero: 'Page Backgrounds',
  email: 'Email',
  header: 'Header & CTA',
  footer: 'Footer',
  social: 'Social Links',
  homepage: 'Homepage Content',
  orders: 'Orders & Delivery',
  payments: 'Payment Methods',
  smtp: 'SMTP & Email',
  google: 'Google Auth',
  chat: 'Live Chat Assistant',
  security: 'Security & CAPTCHA',
  maintenance: 'Maintenance Mode',
};

/** Default values as a plain object - used to seed and to backfill gaps. */
function defaults() {
  return SETTINGS.reduce((acc, item) => {
    acc[item.key] = item.default;
    return acc;
  }, {});
}

module.exports = { SETTINGS, BY_KEY, BY_GROUP, GROUP_LABELS, SECRET_KEYS, defaults };
