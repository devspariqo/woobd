/**
 * Admin resource registry.
 *
 * The CMS screens (packages, portfolio, testimonials, FAQs, clients, pages,
 * menus) are structurally identical: a filtered list, a create form, an edit
 * form, a delete. Declaring them here means the controller, the routes and the
 * two shared templates are written once and generated per resource - the same
 * approach settings-schema.js takes for the settings screen.
 *
 * Adding a new CMS screen is one entry in this file plus a sidebar link.
 *
 * Per-resource keys:
 *   label/singular  - UI naming ("Packages" / "Package")
 *   model           - which content.model.js functions to call
 *   listMode        - 'paginated' when the model returns { rows, total, ... },
 *                     'array' when it returns a plain array
 *   uploadFolder    - key of storage.FOLDER_RULES for image fields
 *   titleField      - used in flash messages and delete confirmations
 *   columns         - the list table
 *   fields          - the create/edit form
 *   filters         - dropdown filters above the list
 */
'use strict';

/** Shared option lists so a value can never drift between two screens. */
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const PUBLISH_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
];

const BILLING_CYCLES = [
  { value: 'one_time', label: 'One time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const MENU_LOCATIONS = [
  { value: 'header', label: 'Header' },
  { value: 'mobile', label: 'Mobile menu' },
  { value: 'footer_quick', label: 'Footer — Quick links' },
  { value: 'footer_services', label: 'Footer — Services' },
  { value: 'footer_info', label: 'Footer — Information' },
];

const RESOURCES = {
  // -------------------------------------------------------------------------
  // Packages (the services table)
  // -------------------------------------------------------------------------
  packages: {
    label: 'Packages',
    singular: 'Package',
    description: 'The service packages customers can order.',
    icon: 'i-package',
    listMode: 'paginated',
    model: {
      list: 'listServices',
      find: 'findServiceById',
      create: 'createService',
      update: 'updateService',
      remove: 'deleteService',
    },
    uploadFolder: 'packages',
    titleField: 'title',
    defaultSort: 'sort_order',
    sortOptions: [
      { value: 'sort_order', label: 'Manual order' },
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'price_low', label: 'Price: low to high' },
      { value: 'price_high', label: 'Price: high to low' },
      { value: 'title', label: 'Title A–Z' },
    ],
    filters: [
      { key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' },
      { key: 'featured', label: 'Featured', options: [{ value: '1', label: 'Featured only' }, { value: '0', label: 'Not featured' }], param: 'featured' },
    ],
    columns: [
      { key: 'title', label: 'Package', type: 'product', image: 'image' },
      { key: 'category_name', label: 'Category' },
      { key: 'price', label: 'Price', type: 'money', align: 'num' },
      { key: 'billing_cycle', label: 'Billing', type: 'humanise' },
      { key: 'is_featured', label: 'Featured', type: 'bool' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, maxlength: 180, group: 'Basics' },
      { key: 'slug', label: 'URL slug', type: 'slug', source: 'title', help: 'Leave blank to generate from the title.' },
      { key: 'category_id', label: 'Category', type: 'select', optionsFrom: 'serviceCategories', emptyLabel: 'No category' },
      { key: 'short_description', label: 'Short description', type: 'textarea', rows: 2, maxlength: 500, help: 'Shown on the package card.' },
      { key: 'description', label: 'Full description', type: 'html', rows: 10, group: 'Content' },
      { key: 'features', label: 'What is included', type: 'list', help: 'One item per line. Rendered as the feature checklist.' },
      { key: 'price', label: 'Price', type: 'decimal', required: true, group: 'Pricing & delivery' },
      { key: 'sale_price', label: 'Sale price', type: 'decimal', nullable: true, help: 'Leave blank for no discount.' },
      { key: 'billing_cycle', label: 'Billing cycle', type: 'select', options: BILLING_CYCLES, default: 'one_time' },
      { key: 'min_months', label: 'Minimum term (months)', type: 'number', default: 1, help: 'Recurring packages only. 1 means no minimum. Checkout will not accept a shorter term.' },
      { key: 'yearly_discount_percent', label: 'Yearly discount (%)', type: 'decimal', default: 0, help: 'Taken off the total when the customer pays for 12 months up front. 0 for none.' },
      { key: 'delivery_days', label: 'Delivery (working days)', type: 'number', default: 7 },
      { key: 'image', label: 'Image', type: 'image', group: 'Media' },
      { key: 'is_featured', label: 'Feature on the homepage', type: 'boolean', group: 'Visibility' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0, help: 'Lower numbers appear first.' },
      { key: 'seo_title', label: 'SEO title', type: 'text', maxlength: 200, group: 'SEO' },
      { key: 'seo_description', label: 'SEO description', type: 'textarea', rows: 2, maxlength: 320 },
    ],
  },

  // -------------------------------------------------------------------------
  // Portfolio
  // -------------------------------------------------------------------------
  portfolio: {
    label: 'Portfolio',
    singular: 'Project',
    description: 'Completed projects shown on the public portfolio.',
    icon: 'i-briefcase',
    listMode: 'paginated',
    model: {
      list: 'listPortfolio',
      find: 'findPortfolioById',
      create: 'createPortfolio',
      update: 'updatePortfolio',
      remove: 'deletePortfolio',
    },
    uploadFolder: 'portfolio',
    titleField: 'title',
    defaultSort: 'sort_order',
    sortOptions: [
      { value: 'sort_order', label: 'Manual order' },
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'title', label: 'Title A–Z' },
    ],
    filters: [{ key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' }],
    columns: [
      { key: 'title', label: 'Project', type: 'product', image: 'thumbnail' },
      { key: 'client_name', label: 'Client' },
      { key: 'category', label: 'Category' },
      { key: 'completed_at', label: 'Completed', type: 'date' },
      { key: 'is_featured', label: 'Featured', type: 'bool' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'title', label: 'Project title', type: 'text', required: true, maxlength: 180, group: 'Basics' },
      { key: 'slug', label: 'URL slug', type: 'slug', source: 'title', help: 'Leave blank to generate from the title.' },
      { key: 'client_name', label: 'Client name', type: 'text', maxlength: 150 },
      { key: 'category', label: 'Category', type: 'text', maxlength: 100, help: 'Free text, e.g. "Fashion & Apparel".' },
      { key: 'short_description', label: 'Short description', type: 'textarea', rows: 2, maxlength: 500 },
      { key: 'description', label: 'Case study', type: 'html', rows: 12, group: 'Content' },
      { key: 'technologies', label: 'Technologies used', type: 'list', help: 'One per line.' },
      { key: 'project_url', label: 'Live site URL', type: 'text', maxlength: 255 },
      { key: 'completed_at', label: 'Completion date', type: 'date', group: 'Details' },
      { key: 'thumbnail', label: 'Thumbnail', type: 'image', group: 'Media' },
      { key: 'is_featured', label: 'Feature on the homepage', type: 'boolean', group: 'Visibility' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
      { key: 'seo_title', label: 'SEO title', type: 'text', maxlength: 200, group: 'SEO' },
      { key: 'seo_description', label: 'SEO description', type: 'textarea', rows: 2, maxlength: 320 },
    ],
  },

  // -------------------------------------------------------------------------
  // Testimonials
  // -------------------------------------------------------------------------
  testimonials: {
    label: 'Testimonials',
    singular: 'Testimonial',
    description: 'Client reviews shown on the homepage.',
    icon: 'i-star',
    listMode: 'array',
    model: {
      list: 'listTestimonials',
      find: 'findTestimonialById',
      create: 'createTestimonial',
      update: 'updateTestimonial',
      remove: 'deleteTestimonial',
    },
    uploadFolder: 'testimonials',
    titleField: 'customer_name',
    searchFields: ['customer_name', 'company', 'message'],
    filters: [{ key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' }],
    columns: [
      { key: 'customer_name', label: 'Customer', type: 'product', image: 'avatar' },
      { key: 'designation', label: 'Role' },
      { key: 'company', label: 'Company' },
      { key: 'rating', label: 'Rating', type: 'rating' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'customer_name', label: 'Customer name', type: 'text', required: true, maxlength: 120 },
      { key: 'designation', label: 'Role / designation', type: 'text', maxlength: 150 },
      { key: 'company', label: 'Company', type: 'text', maxlength: 150 },
      { key: 'rating', label: 'Rating (1–5)', type: 'number', default: 5, min: 1, max: 5 },
      { key: 'message', label: 'Review', type: 'textarea', rows: 5, required: true },
      { key: 'avatar', label: 'Photo', type: 'image', group: 'Media' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active', group: 'Visibility' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
    ],
  },

  // -------------------------------------------------------------------------
  // FAQs
  // -------------------------------------------------------------------------
  faqs: {
    label: 'FAQs',
    singular: 'FAQ',
    description: 'Questions shown on the homepage, and published as FAQ schema.',
    icon: 'i-help-circle',
    listMode: 'array',
    model: {
      list: 'listFaqs',
      find: 'findFaqById',
      create: 'createFaq',
      update: 'updateFaq',
      remove: 'deleteFaq',
    },
    titleField: 'question',
    searchFields: ['question', 'answer', 'category'],
    filters: [{ key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' }],
    columns: [
      { key: 'question', label: 'Question' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'question', label: 'Question', type: 'text', required: true, maxlength: 300 },
      { key: 'answer', label: 'Answer', type: 'textarea', rows: 6, required: true },
      { key: 'category', label: 'Category', type: 'text', maxlength: 80, default: 'general', help: 'Groups related questions.' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
    ],
  },

  // -------------------------------------------------------------------------
  // Clients (trust bar)
  // -------------------------------------------------------------------------
  clients: {
    label: 'Clients',
    singular: 'Client',
    description: 'Client logos shown in the scrolling trust bar.',
    icon: 'i-users',
    listMode: 'array',
    model: {
      list: 'listClients',
      find: 'findClientById',
      create: 'createClient',
      update: 'updateClient',
      remove: 'deleteClient',
    },
    uploadFolder: 'clients',
    titleField: 'name',
    searchFields: ['name', 'website_url'],
    filters: [{ key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' }],
    columns: [
      { key: 'name', label: 'Client', type: 'product', image: 'logo' },
      { key: 'website_url', label: 'Website', type: 'link' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'name', label: 'Client name', type: 'text', required: true, maxlength: 150 },
      { key: 'logo', label: 'Logo', type: 'image', required: true, help: 'A wide, light-background logo works best.' },
      { key: 'website_url', label: 'Website URL', type: 'text', maxlength: 255 },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
    ],
  },

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------
  pages: {
    label: 'Pages',
    singular: 'Page',
    description: 'Standalone content pages such as the privacy policy.',
    icon: 'i-file',
    listMode: 'array',
    model: {
      list: 'listPages',
      find: 'findPageById',
      create: 'createPage',
      update: 'updatePage',
      remove: 'deletePage',
    },
    titleField: 'title',
    searchFields: ['title', 'slug', 'content'],
    filters: [
      { key: 'status', label: 'Status', options: PUBLISH_OPTIONS, param: 'status' },
      { key: 'footer', label: 'Footer', options: [{ value: '1', label: 'In footer only' }], param: 'footer' },
    ],
    columns: [
      { key: 'title', label: 'Page' },
      { key: 'slug', label: 'Slug', type: 'code' },
      { key: 'show_in_footer', label: 'In footer', type: 'bool' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'title', label: 'Page title', type: 'text', required: true, maxlength: 200 },
      { key: 'slug', label: 'URL slug', type: 'slug', source: 'title', required: true, help: 'The page is served at /page/<slug>.' },
      { key: 'content', label: 'Content', type: 'html', rows: 18, group: 'Content' },
      { key: 'show_in_footer', label: 'Link from the footer', type: 'boolean', group: 'Visibility' },
      { key: 'status', label: 'Status', type: 'select', options: PUBLISH_OPTIONS, default: 'published' },
      { key: 'meta_title', label: 'SEO title', type: 'text', maxlength: 200, group: 'SEO' },
      { key: 'meta_description', label: 'SEO description', type: 'textarea', rows: 2, maxlength: 320 },
    ],
  },

  // -------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------
  menus: {
    label: 'Menus',
    singular: 'Menu item',
    description: 'Navigation links for the header, mobile menu and footer.',
    icon: 'i-menu',
    listMode: 'array',
    model: {
      list: 'listMenus',
      find: 'findMenuById',
      create: 'createMenu',
      update: 'updateMenu',
      remove: 'deleteMenu',
    },
    titleField: 'label',
    searchFields: ['label', 'url'],
    groupBy: 'location',
    locationLabels: {
      header: 'Header',
      mobile: 'Mobile menu',
      footer_quick: 'Footer — Quick links',
      footer_services: 'Footer — Services',
      footer_info: 'Footer — Information',
    },
    filters: [
      { key: 'location', label: 'Location', options: MENU_LOCATIONS, param: 'location' },
      { key: 'status', label: 'Status', options: STATUS_OPTIONS, param: 'status' },
    ],
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'parent_label', label: 'Nested under' },
      { key: 'url', label: 'URL', type: 'code' },
      { key: 'location', label: 'Location', type: 'humanise' },
      { key: 'status', label: 'Status', type: 'status' },
    ],
    fields: [
      { key: 'label', label: 'Label', type: 'text', required: true, maxlength: 120 },
      { key: 'url', label: 'URL', type: 'text', required: true, maxlength: 255, default: '/', help: 'Use a path such as /services, or a full https:// URL.' },
      { key: 'location', label: 'Location', type: 'select', options: MENU_LOCATIONS, required: true, default: 'header' },
      // Nesting an item under another turns the parent into a dropdown. The
      // options are top-level items in the same location, which is what the
      // header and mobile-menu partials expect.
      { key: 'parent_id', label: 'Nest under', type: 'select', optionsFrom: 'menuParents', emptyLabel: 'Top level (no dropdown)' },
      { key: 'icon', label: 'Icon', type: 'text', maxlength: 80, help: 'Optional icon name for dropdown items, e.g. shopping-cart, briefcase, shield.' },
      { key: 'target', label: 'Open in', type: 'select', options: [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }], default: '_self' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS, default: 'active' },
      { key: 'sort_order', label: 'Sort order', type: 'number', default: 0, help: 'Lower numbers appear first.' },
    ],
  },
};

const RESOURCE_KEYS = Object.keys(RESOURCES);

module.exports = { RESOURCES, RESOURCE_KEYS, STATUS_OPTIONS, PUBLISH_OPTIONS, BILLING_CYCLES, MENU_LOCATIONS };
