/**
 * Generic admin CRUD for the CMS resources declared in config/admin-resources.js.
 *
 * One set of handlers serves packages, portfolio, testimonials, FAQs, clients,
 * pages and menus. The resource is injected onto `req.adminResource` by the
 * route layer rather than passed to a handler factory, so every export here is
 * a plain (req, res, next) function that cannot be mis-mounted.
 *
 * Field values are coerced by the declared `type` on each field, so adding a
 * field to the registry is enough - no change is needed here.
 */
'use strict';

const content = require('../models/content.model');
const activity = require('../services/activity.service');
const db = require('../config/database');
const adminCtrl = require('./admin.controller');
const { RESOURCES } = require('../config/admin-resources');
const { clean } = require('../utils/validators');
const { paginate, fromQuery } = require('../utils/paginator');
const storage = require('../lib/storage');
const { uploadGuardedAny } = require('../middleware/upload');
const helpers = require('../utils/helpers');
const logger = require('../utils/logger');

const PER_PAGE = 20;

/** The resource config for this request. */
function current(req) {
  const key = req.adminResource;
  const resource = RESOURCES[key];
  if (!resource) throw new Error(`Unknown admin resource: ${key}`);
  return { key, resource };
}

/** The model functions named in the resource config. */
function model(resource) {
  return {
    list: content[resource.model.list],
    find: content[resource.model.find],
    create: content[resource.model.create],
    update: content[resource.model.update],
    remove: content[resource.model.remove],
  };
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/**
 * Turn one submitted field into the value to store, based on its declared type.
 * Returns { value } or { error } - never throws.
 */
function coerce(field, body) {
  const raw = body[field.key];

  switch (field.type) {
    case 'boolean':
      // An unchecked checkbox submits nothing, so absence means false.
      return { value: clean.bool(raw) };

    case 'number': {
      const n = clean.int(raw, { min: field.min ?? 0, max: field.max ?? 2147483647, fallback: field.default ?? 0 });
      return { value: n };
    }

    case 'decimal': {
      const rawStr = String(raw ?? '').trim();

      // A blank decimal means "not set" for a nullable column - sale_price
      // relies on this, because 0 would render as a free product.
      //
      // But a NOT NULL column rejects null outright, so the field has to say
      // which it is. Without `nullable`, a blank falls back to the declared
      // default (0), which is what a discount percentage wants.
      if (!rawStr) {
        return field.nullable ? { value: null } : { value: Number(field.default) || 0 };
      }

      return { value: clean.decimal(rawStr, { min: 0 }) };
    }

    case 'date': {
      const value = clean.str(raw, 10);
      if (!value) return { value: null };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `${field.label} must be a valid date.` };
      return { value };
    }

    case 'select': {
      const value = clean.str(raw, 60);

      // A foreign-key select (parent_id, category_id) stores an id or nothing.
      // An empty option must become NULL, not an empty string - MySQL would
      // reject '' for an INT column, or coerce it to 0 and create a dangling
      // reference to a row that does not exist.
      if (field.key.endsWith('_id')) {
        if (!value) return { value: null };
        const parsed = Number(value);
        return { value: Number.isInteger(parsed) && parsed > 0 ? parsed : null };
      }

      if (Array.isArray(field.options) && field.options.length) {
        const allowed = field.options.map((o) => o.value);
        if (value && !allowed.includes(value)) return { error: `${field.label} is not a valid option.` };
      }
      if (field.required && !value) return { error: `${field.label} is required.` };
      return { value: value || field.default || '' };
    }

    case 'list': {
      // Stored as a JSON array; the form edits it as one-item-per-line.
      const items = clean.list(raw, 60);
      return { value: JSON.stringify(items) };
    }

    case 'html':
      // Admin-authored markup. Keep line breaks and do not collapse whitespace.
      return { value: clean.text(raw, 100000) };

    case 'slug': {
      const source = field.source ? clean.str(body[field.source], 200) : '';
      const value = clean.slug(raw || source, 200);
      if (field.required && !value) return { error: `${field.label} is required.` };
      return { value };
    }

    case 'image':
      // Handled separately, because the uploaded file (if any) wins.
      return { value: clean.str(raw, 500) };

    default: {
      const value = clean.str(raw, field.maxlength || 5000);
      if (field.required && !value) return { error: `${field.label} is required.` };
      if (field.maxlength && String(raw || '').length > field.maxlength) {
        return { error: `${field.label} must be ${field.maxlength} characters or fewer.` };
      }
      return { value };
    }
  }
}

/**
 * Build the row to persist from the submitted form.
 *
 * The upload field is a single, generically-named input for every resource, so
 * the file is assigned to whichever field is declared `type: 'image'`. That
 * keeps the multer wiring identical across seven screens.
 */
function buildRow(resource, body, files, existing = null) {
  const errors = {};
  const row = {};

  for (const field of resource.fields) {
    const { value, error } = coerce(field, body);
    if (error) {
      errors[field.key] = error;
      continue;
    }
    row[field.key] = value;
  }

  // Files arrive named after the field they belong to, so each is matched back
  // to its own field. This used to take files[0] and assign it to the first
  // image field, which meant a resource with two image fields - a page has a
  // featured image and a social share image - could only ever save one of them,
  // and the second failed silently.
  const byField = new Map();
  for (const file of files || []) byField.set(file.fieldname, file);

  for (const field of resource.fields) {
    if (field.type !== 'image') continue;

    // `uploaded` here is a multer file object, not a list - a truthiness check
    // is correct. (It briefly read `uploaded.length`, from a find-and-replace
    // meant for the caller, which silently stopped every image from saving.)
    const uploaded = byField.get(field.key);

    if (uploaded) {
      row[field.key] = `${require('../config').uploads.publicPath}/${resource.uploadFolder}/${uploaded.filename}`;
    } else if (existing && existing[field.key]) {
      // A file input cannot post "unchanged", so an edit with no new file must
      // carry the stored path forward. Without this, saving any other field on
      // the form blanks the image - and on a required field it fails validation
      // outright, making the record uneditable.
      row[field.key] = existing[field.key];
    }
  }

  // Fallback for a form still posting a single generic "upload" field: apply it
  // to the first image field, which is how every resource behaved before.
  const legacy = byField.get('upload');
  if (legacy) {
    const first = resource.fields.find((f) => f.type === 'image');
    if (first && !byField.has(first.key)) {
      row[first.key] = `${require('../config').uploads.publicPath}/${resource.uploadFolder}/${legacy.filename}`;
    }
  }

  // A declared-required image must have either a new upload or an existing path.
  const requiredImage = resource.fields.find((f) => f.type === 'image' && f.required);
  if (requiredImage && !row[requiredImage.key]) {
    errors[requiredImage.key] = `${requiredImage.label} is required.`;
  }

  return { row, errors, uploaded: files || [] };
}

// ---------------------------------------------------------------------------
// Filtering and paging for array-returning models
// ---------------------------------------------------------------------------

/**
 * Some models return a plain array rather than a paginated result. Search and
 * paging for those are done here so every screen behaves the same way.
 */
function filterArray(rows, { resource, search, page, perPage }) {
  let out = rows;

  if (search) {
    const needle = search.toLowerCase();
    const fields = resource.searchFields || [resource.titleField];
    out = out.filter((row) =>
      fields.some((f) => String(row[f] || '').toLowerCase().includes(needle))
    );
  }

  const total = out.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;

  return {
    rows: out.slice(start, start + perPage),
    total,
    page: safePage,
    perPage,
    totalPages,
    from: total ? start + 1 : 0,
    to: Math.min(start + perPage, total),
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

exports.contentList = async (req, res, next) => {
  try {
    const { key, resource } = current(req);
    const { page, perPage } = fromQuery(req.query, PER_PAGE);
    const search = clean.str(req.query.q || '', 120);

    // Collect the filter values the resource declares, from the query string.
    const activeFilters = {};
    for (const filter of resource.filters || []) {
      const value = clean.str(req.query[filter.param || filter.key] || '', 40);
      if (value) activeFilters[filter.param || filter.key] = value;
    }

    const m = model(resource);
    let result;

    if (resource.listMode === 'paginated') {
      const args = { page, perPage, search };
      // Map filter values onto the model's own argument names where it has them.
      if (activeFilters.status) args.status = activeFilters.status;
      if (activeFilters.category) args.category = activeFilters.category;
      if (activeFilters.featured !== undefined) args.featured = activeFilters.featured === '1';
      if (resource.sortOptions && req.query.sort) args.sort = clean.str(req.query.sort, 30);

      result = await m.list(args);
    } else {
      const args = {};
      if (activeFilters.status) args.status = activeFilters.status;
      if (activeFilters.location) args.location = activeFilters.location;
      if (activeFilters.footer === '1') args.footerOnly = true;

      const rows = await m.list(args);
      result = filterArray(rows, { resource, search, page, perPage });
    }

    res.locals.navActive = key;
    res.locals.badges = await adminCtrl.badgeCounts();
    res.render('admin/content-list', {
      layout: 'layouts/admin',
      pageTitle: resource.label,
      pageSubtitle: resource.description,
      // pageActions is rendered by the layout, which runs AFTER this view, so
      // it has to be supplied from the controller rather than set in the view.
      pageActions: `<a href="${helpers.url(`${res.locals.adminPath}/${key}/new`)}" class="btn btn-primary btn-sm">
          <svg><use href="#i-plus"/></svg><span>New ${resource.singular.toLowerCase()}</span>
        </a>`,
      resource,
      resourceKey: key,
      rows: result.rows,
      pager: result,
      search,
      activeFilters,
      sort: clean.str(req.query.sort || resource.defaultSort || '', 30),
      basePath: `${res.locals.adminPath}/${key}`,
      seo: { ...res.locals.seo, title: resource.label, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

exports.contentForm = async (req, res, next) => {
  try {
    const { key, resource } = current(req);
    const m = model(resource);
    const id = req.params.id ? Number(req.params.id) : null;

    let record = null;
    if (id) {
      record = await m.find(id);
      if (!record) {
        req.session.flashError = `${resource.singular} not found.`;
        return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
      }
    }

    // Values shown in the form: the record, or each field's declared default.
    const values = {};
    for (const field of resource.fields) {
      if (record && record[field.key] !== undefined && record[field.key] !== null) {
        values[field.key] = record[field.key];
      } else {
        values[field.key] = field.default !== undefined ? field.default : '';
      }
    }

    // Select options that come from the database rather than the config.
    const optionSets = await loadOptionSets(resource, { excludeId: id });

    res.locals.navActive = key;
    res.locals.badges = await adminCtrl.badgeCounts();
    res.render('admin/content-form', {
      layout: 'layouts/admin',
      pageTitle: id ? `Edit ${resource.singular}` : `New ${resource.singular}`,
      pageSubtitle: resource.description,
      resource,
      resourceKey: key,
      record,
      values,
      optionSets,
      errors: null,
      basePath: `${res.locals.adminPath}/${key}`,
      seo: { ...res.locals.seo, title: `${id ? 'Edit' : 'New'} ${resource.singular}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

exports.contentSave = async (req, res, next) => {
  const { key, resource } = current(req);
  const m = model(resource);
  const id = req.params.id ? Number(req.params.id) : null;
  const redirectToList = () => res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/${key}`));

  try {
    // The existing record is needed so an edit with no new upload keeps the
    // stored image rather than blanking it.
    const existing = id ? await m.find(id) : null;
    const { row, errors, uploaded } = buildRow(resource, req.body, req.files, existing);

    // A slug must be unique, or the public route becomes ambiguous.
    if (row.slug !== undefined && row.slug) {
      const clash = await db.queryOne(
        `SELECT id FROM ${slugTable(key)} WHERE slug = ? ${id ? 'AND id <> ?' : ''} LIMIT 1`,
        id ? [row.slug, id] : [row.slug]
      );
      if (clash) errors.slug = 'That slug is already used by another item.';
    }

    if (Object.keys(errors).length) {
      // Re-render rather than redirect, so the operator does not lose input.
      const values = { ...req.body };
      const optionSets = await loadOptionSets(resource, { excludeId: id });

      res.locals.navActive = key;
      res.locals.badges = await adminCtrl.badgeCounts();
      return res.status(422).render('admin/content-form', {
        layout: 'layouts/admin',
        pageTitle: id ? `Edit ${resource.singular}` : `New ${resource.singular}`,
        pageSubtitle: resource.description,
        resource,
        resourceKey: key,
        record: id ? await m.find(id) : null,
        values,
        optionSets,
        errors,
        basePath: `${res.locals.adminPath}/${key}`,
        seo: { ...res.locals.seo, title: 'Fix the errors below', robots: 'noindex,nofollow' },
      });
    }

    let savedId;
    if (id) {
      await m.update(id, row);
      savedId = id;
    } else {
      savedId = await m.create(row);
    }

    // Record the upload in the media library so it is not orphaned.
    // `uploaded` is the list of files from buildRow, so a length check is right
    // here - an empty array is truthy and would run the loop for nothing.
    if (uploaded && uploaded.length) {
      try {
        const records = storage.toMediaRecords(uploaded, {
          folder: resource.uploadFolder,
          uploaderId: req.session.staff ? req.session.staff.id : null,
          uploaderType: 'staff',
        });
        for (const record of records) await storage.recordMedia(record);
      } catch (err) {
        // A media-table failure must not fail the content save.
        logger.warn('Failed to record uploaded media', err);
      }
    }

    await activity.log({
      req,
      action: id ? 'content.updated' : 'content.created',
      entityType: key,
      entityId: savedId,
      description: `${resource.singular} "${clean.str(row[resource.titleField] || '', 80)}" ${id ? 'updated' : 'created'}.`,
    });

    req.session.flashSuccess = id ? `${resource.singular} updated.` : `${resource.singular} created.`;
    return redirectToList();
  } catch (err) {
    return next(err);
  }
};

/** The table a resource's slug column lives in. */
function slugTable(key) {
  return {
    packages: 'services',
    portfolio: 'portfolio',
    pages: 'pages',
    posts: 'posts',
  }[key] || key;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

exports.contentRemove = async (req, res, next) => {
  try {
    const { key, resource } = current(req);
    const m = model(resource);
    const id = Number(req.params.id);

    const record = await m.find(id);
    if (!record) {
      req.session.flashError = `${resource.singular} not found.`;
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
    }

    await m.remove(id);

    await activity.log({
      req,
      action: 'content.deleted',
      entityType: key,
      entityId: id,
      description: `${resource.singular} "${clean.str(record[resource.titleField] || '', 80)}" deleted.`,
    });

    req.session.flashSuccess = `${resource.singular} deleted.`;
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Toggle a boolean column straight from the list
// ---------------------------------------------------------------------------

const TOGGLEABLE = new Set(['status', 'is_featured', 'show_in_footer']);

exports.contentToggle = async (req, res, next) => {
  try {
    const { key, resource } = current(req);
    const m = model(resource);
    const id = Number(req.params.id);
    const field = clean.str(req.params.field, 40);

    if (!TOGGLEABLE.has(field) || !resource.fields.some((f) => f.key === field)) {
      req.session.flashError = 'That field cannot be toggled.';
      return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
    }

    const record = await m.find(id);
    if (!record) {
      req.session.flashError = `${resource.singular} not found.`;
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
    }

    // `status` is a select, the others are booleans.
    const nextValue =
      field === 'status' ? (record.status === 'active' ? 'inactive' : 'active') : record[field] ? '0' : '1';

    await m.update(id, { [field]: nextValue });

    req.session.flashSuccess = `${resource.singular} updated.`;
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/${key}`));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Exported helpers for the route layer
// ---------------------------------------------------------------------------

/** Injects which resource a request is for. Plain middleware, not a factory. */
exports.tagResource = (key) => (req, res, next) => {
  req.adminResource = key;
  next();
};

/**
 * Load the option lists a form needs for its `optionsFrom` selects.
 *
 * Kept in one place so the create form, the edit form and the re-render after a
 * validation error all build their dropdowns the same way.
 *
 * `excludeId` keeps an item from being offered as its own parent - which would
 * make a menu item its own ancestor and detach the whole branch.
 */
async function loadOptionSets(resource, { excludeId = null } = {}) {
  const sets = {};

  for (const field of resource.fields) {
    if (field.optionsFrom === 'serviceCategories') {
      sets[field.key] = await content.listCategories({ onlyActive: false });
    }

    if (field.optionsFrom === 'menuParents') {
      // Only top-level items qualify: the header and mobile partials render one
      // level of nesting, so a child of a child would never appear.
      const rows = await db.query(
        `SELECT id, label, location FROM menus
         WHERE parent_id IS NULL ${excludeId ? 'AND id <> ?' : ''}
         ORDER BY location ASC, sort_order ASC, id ASC`,
        excludeId ? [excludeId] : []
      );

      const locationLabels = resource.locationLabels || {};
      sets[field.key] = rows.map((row) => ({
        // Disambiguate across locations, or "Services" appears three times.
        id: row.id,
        name: `${locationLabels[row.location] || row.location} → ${row.label}`,
      }));
    }
  }

  return sets;
}

/** Multer middleware for resources that accept an image, else a pass-through. */
exports.uploadFor = (key) => {
  const resource = RESOURCES[key];
  const hasImage = resource && resource.fields.some((f) => f.type === 'image');
  if (!hasImage) return (req, res, next) => next();
  // 'any', not a single named field: each image field posts under its own key,
  // so a resource with two of them needs both accepted. The controller then
  // matches each file back to its field.
  //
  // uploadGuardedAny, not raw multer: multipart bodies are CSRF-checked here
  // because the global middleware runs before multer has parsed them.
  return uploadGuardedAny(resource.uploadFolder);
};

module.exports = exports;
