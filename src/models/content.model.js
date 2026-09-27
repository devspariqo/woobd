/**
 * Services, portfolio, testimonials, FAQs, clients, pages and posts.
 *
 * The public site and the admin CRUD screens share these functions - the only
 * difference is that public callers pass `status: 'active'`.
 */
'use strict';

const db = require('../config/database');
const { paginate } = require('../utils/paginator');
const helpers = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Services / packages
// ---------------------------------------------------------------------------

async function listServices({ page = 1, perPage = 12, search = '', status = '', categoryId = null, featured = null, sort = 'sort_order' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(s.title LIKE ? OR s.short_description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('s.status = ?');
    params.push(status);
  }
  if (categoryId) {
    conditions.push('s.category_id = ?');
    params.push(categoryId);
  }
  if (featured !== null) {
    conditions.push('s.is_featured = ?');
    params.push(featured ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Whitelist the sort column - it is interpolated, so it must never come
  // straight from the query string.
  const sortColumns = {
    sort_order: 's.sort_order ASC, s.id DESC',
    newest: 's.id DESC',
    oldest: 's.id ASC',
    price_low: 's.price ASC',
    price_high: 's.price DESC',
    title: 's.title ASC',
  };
  const orderBy = sortColumns[sort] || sortColumns.sort_order;

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM services s ${where}`,
    countParams: params,
    rowSql: `SELECT s.*, c.name AS category_name, c.slug AS category_slug
             FROM services s
             LEFT JOIN service_categories c ON c.id = s.category_id
             ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function findServiceById(id) {
  return db.queryOne(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug
     FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
     WHERE s.id = ? LIMIT 1`,
    [id]
  );
}

async function findServiceBySlug(slug) {
  return db.queryOne(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug
     FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
     WHERE s.slug = ? LIMIT 1`,
    [slug]
  );
}

async function createService(data) {
  return db.insert('services', data);
}

async function updateService(id, data) {
  return db.update('services', data, 'id = ?', [id]);
}

async function deleteService(id) {
  return db.query('DELETE FROM services WHERE id = ?', [id]);
}

async function incrementServiceViews(id) {
  // Fire and forget; a failed counter must not break the page render.
  db.query('UPDATE services SET views = views + 1 WHERE id = ?', [id]).catch(() => {});
}

/** Related packages for the single-service sidebar. */
async function relatedServices(service, limit = 3) {
  return db.query(
    `SELECT id, title, slug, image, price, sale_price, short_description
     FROM services
     WHERE status = 'active' AND id != ?
       ${service.category_id ? 'AND (category_id = ? OR category_id IS NULL)' : ''}
     ORDER BY is_featured DESC, sort_order ASC LIMIT ?`,
    service.category_id ? [service.id, service.category_id, limit] : [service.id, limit]
  );
}

async function serviceCounts() {
  return db.queryOne(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(is_featured = 1) AS featured,
            COALESCE(SUM(price),0) AS catalogue_value
     FROM services`
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function listCategories({ onlyActive = false } = {}) {
  return db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM services s WHERE s.category_id = c.id) AS service_count
     FROM service_categories c
     ${onlyActive ? "WHERE EXISTS (SELECT 1 FROM services s WHERE s.category_id = c.id AND s.status = 'active')" : ''}
     ORDER BY c.sort_order ASC, c.name ASC`
  );
}

async function findCategoryById(id) {
  return db.queryOne('SELECT * FROM service_categories WHERE id = ? LIMIT 1', [id]);
}

async function createCategory(data) {
  return db.insert('service_categories', data);
}

async function updateCategory(id, data) {
  return db.update('service_categories', data, 'id = ?', [id]);
}

async function deleteCategory(id) {
  return db.query('DELETE FROM service_categories WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

async function listPortfolio({ page = 1, perPage = 9, search = '', status = '', category = '', featured = null, sort = 'sort_order' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(title LIKE ? OR client_name LIKE ? OR short_description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (featured !== null) {
    conditions.push('is_featured = ?');
    params.push(featured ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortColumns = { sort_order: 'sort_order ASC, id DESC', newest: 'id DESC', oldest: 'id ASC', title: 'title ASC' };

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM portfolio ${where}`,
    countParams: params,
    rowSql: `SELECT * FROM portfolio ${where} ORDER BY ${sortColumns[sort] || sortColumns.sort_order} LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function findPortfolioById(id) {
  return db.queryOne('SELECT * FROM portfolio WHERE id = ? LIMIT 1', [id]);
}

async function findPortfolioBySlug(slug) {
  return db.queryOne('SELECT * FROM portfolio WHERE slug = ? LIMIT 1', [slug]);
}

async function createPortfolio(data) {
  return db.insert('portfolio', data);
}

async function updatePortfolio(id, data) {
  return db.update('portfolio', data, 'id = ?', [id]);
}

async function deletePortfolio(id) {
  return db.query('DELETE FROM portfolio WHERE id = ?', [id]);
}

/** Distinct project categories, for the portfolio filter bar. */
async function portfolioCategories() {
  const rows = await db.query(
    "SELECT DISTINCT category FROM portfolio WHERE status = 'active' AND category IS NOT NULL AND category != '' ORDER BY category ASC"
  );
  return rows.map((row) => row.category);
}

async function relatedPortfolio(project, limit = 3) {
  return db.query(
    `SELECT id, title, slug, thumbnail, category, client_name
     FROM portfolio
     WHERE status = 'active' AND id != ? ${project.category ? 'AND category = ?' : ''}
     ORDER BY id DESC LIMIT ?`,
    project.category ? [project.id, project.category, limit] : [project.id, limit]
  );
}

// ---------------------------------------------------------------------------
// Testimonials / FAQ / Clients
// ---------------------------------------------------------------------------

async function listTestimonials({ status = '', limit = 0, featuredOnly = false } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (featuredOnly) conditions.push('rating >= 4');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit ? 'LIMIT ?' : '';
  if (limit) params.push(limit);

  return db.query(
    `SELECT * FROM testimonials ${where} ORDER BY sort_order ASC, id DESC ${limitClause}`,
    params
  );
}

async function findTestimonialById(id) {
  return db.queryOne('SELECT * FROM testimonials WHERE id = ? LIMIT 1', [id]);
}

async function createTestimonial(data) {
  return db.insert('testimonials', data);
}

async function updateTestimonial(id, data) {
  return db.update('testimonials', data, 'id = ?', [id]);
}

async function deleteTestimonial(id) {
  return db.query('DELETE FROM testimonials WHERE id = ?', [id]);
}

async function listFaqs({ status = '', limit = 0, category = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  if (limit) params.push(limit);

  return db.query(`SELECT * FROM faqs ${where} ORDER BY sort_order ASC, id ASC ${limit ? 'LIMIT ?' : ''}`, params);
}

async function findFaqById(id) {
  return db.queryOne('SELECT * FROM faqs WHERE id = ? LIMIT 1', [id]);
}

async function createFaq(data) {
  return db.insert('faqs', data);
}

async function updateFaq(id, data) {
  return db.update('faqs', data, 'id = ?', [id]);
}

async function deleteFaq(id) {
  return db.query('DELETE FROM faqs WHERE id = ?', [id]);
}

async function listClients({ status = '' } = {}) {
  return db.query(
    `SELECT * FROM clients ${status ? 'WHERE status = ?' : ''} ORDER BY sort_order ASC, id ASC`,
    status ? [status] : []
  );
}

async function findClientById(id) {
  return db.queryOne('SELECT * FROM clients WHERE id = ? LIMIT 1', [id]);
}

async function createClient(data) {
  return db.insert('clients', data);
}

async function updateClient(id, data) {
  return db.update('clients', data, 'id = ?', [id]);
}

async function deleteClient(id) {
  return db.query('DELETE FROM clients WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Pages & posts
// ---------------------------------------------------------------------------

async function findPageBySlug(slug) {
  return db.queryOne('SELECT * FROM pages WHERE slug = ? LIMIT 1', [slug]);
}

async function findPageById(id) {
  return db.queryOne('SELECT * FROM pages WHERE id = ? LIMIT 1', [id]);
}

async function listPages({ status = '', footerOnly = false } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (footerOnly) conditions.push('show_in_footer = 1');

  return db.query(
    `SELECT * FROM pages ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY title ASC`,
    params
  );
}

async function createPage(data) {
  return db.insert('pages', data);
}

async function updatePage(id, data) {
  return db.update('pages', data, 'id = ?', [id]);
}

async function deletePage(id) {
  return db.query('DELETE FROM pages WHERE id = ?', [id]);
}

async function listPosts({ page = 1, perPage = 9, search = '', status = '', featured = '' } = {}) {
  const conditions = [];
  const params = [];
  if (search) {
    conditions.push('(title LIKE ? OR excerpt LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (featured === '1') conditions.push('p.is_featured = 1');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM posts p ${where}`,
    countParams: params,
    rowSql: `SELECT p.*, u.name AS author_name FROM posts p
             LEFT JOIN users u ON u.id = p.author_id
             ${where} ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function findPostBySlug(slug) {
  return db.queryOne(
    `SELECT p.*, u.name AS author_name, u.role AS author_role, u.avatar AS author_avatar
       FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.slug = ? LIMIT 1`,
    [slug]
  );
}

async function findPostById(id) {
  return db.queryOne(
    `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE p.id = ? LIMIT 1`,
    [id]
  );
}

/**
 * A post is public when it is published AND its date has arrived.
 *
 * The date check is what makes scheduling work: setting a future publish date
 * holds the post back without needing a cron job to flip its status.
 */
const PUBLIC_POST_SQL = "p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= NOW())";

/** Published posts, newest first, with paging and an optional search. */
async function listPublishedPosts({ page = 1, perPage = 9, search = '', category = '' } = {}) {
  const conditions = [PUBLIC_POST_SQL];
  const params = [];

  if (search) {
    conditions.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    conditions.push('p.category = ?');
    params.push(category);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM posts p ${where}`,
    countParams: params,
    rowSql: `SELECT p.*, u.name AS author_name FROM posts p
             LEFT JOIN users u ON u.id = p.author_id
             ${where} ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

/** Posts flagged for the homepage, newest first. */
async function featuredPosts(limit = 3) {
  return db.query(
    `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE ${PUBLIC_POST_SQL} AND p.is_featured = 1
      ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    [limit]
  );
}

/**
 * Most-read posts, for the sidebar.
 *
 * Ordered by views, then by date, so a brand new blog with no traffic yet
 * still shows something sensible instead of an empty box.
 */
async function topPosts(limit = 5) {
  return db.query(
    `SELECT p.id, p.title, p.slug, p.category, p.featured_image, p.published_at, p.view_count
       FROM posts p WHERE ${PUBLIC_POST_SQL}
      ORDER BY p.view_count DESC, COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    [limit]
  );
}

/** Latest posts, for the sidebar. `excludeId` keeps the current post out of it. */
async function recentPosts(limit = 7, excludeId = null) {
  return db.query(
    `SELECT p.id, p.title, p.slug, p.category, p.featured_image, p.published_at
       FROM posts p WHERE ${PUBLIC_POST_SQL} ${excludeId ? 'AND p.id <> ?' : ''}
      ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    excludeId ? [excludeId, limit] : [limit]
  );
}

/** Categories in use, with how many posts each holds. */
async function postCategories() {
  return db.query(
    `SELECT p.category, COUNT(*) AS total FROM posts p
      WHERE ${PUBLIC_POST_SQL} AND category IS NOT NULL AND category <> ''
      GROUP BY p.category ORDER BY total DESC, p.category ASC`
  );
}

/**
 * Posts related to the one being read.
 *
 * Same category first, then topped up with the latest posts so the row is never
 * short - a single-category blog would otherwise show one or two cards under a
 * heading that promises six.
 */
async function relatedPosts(post, limit = 6) {
  const rows = await db.query(
    `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE ${PUBLIC_POST_SQL} AND p.id <> ?
        ${post.category ? 'AND p.category = ?' : ''}
      ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    post.category ? [post.id, post.category, limit] : [post.id, limit]
  );

  if (rows.length >= limit) return rows;

  const seen = new Set([post.id, ...rows.map((r) => r.id)]);
  const filler = await db.query(
    `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
      WHERE ${PUBLIC_POST_SQL}
      ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    [limit * 2]
  );

  for (const row of filler) {
    if (rows.length >= limit) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }

  return rows;
}

/** Count a read. Fire-and-forget: a failed counter must not fail the page. */
async function incrementPostViews(id) {
  return db.query('UPDATE posts SET view_count = view_count + 1 WHERE id = ?', [id]);
}

/** Every published post, for the sitemap. */
async function publishedPostIndex() {
  return db.query(
    `SELECT p.slug, p.updated_at FROM posts p WHERE ${PUBLIC_POST_SQL}
      ORDER BY COALESCE(p.published_at, p.created_at) DESC`
  );
}

async function createPost(data) {
  return db.insert('posts', data);
}

async function updatePost(id, data) {
  return db.update('posts', data, 'id = ?', [id]);
}

async function deletePost(id) {
  return db.query('DELETE FROM posts WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

async function listMenus({ location = '' } = {}) {
  return db.query(
    `SELECT m.*, p.label AS parent_label FROM menus m
     LEFT JOIN menus p ON p.id = m.parent_id
     ${location ? 'WHERE m.location = ?' : ''}
     ORDER BY m.location ASC, m.sort_order ASC, m.id ASC`,
    location ? [location] : []
  );
}

async function findMenuById(id) {
  return db.queryOne('SELECT * FROM menus WHERE id = ? LIMIT 1', [id]);
}

async function createMenu(data) {
  return db.insert('menus', data);
}

async function updateMenu(id, data) {
  return db.update('menus', data, 'id = ?', [id]);
}

async function deleteMenu(id) {
  // Remove children first so the dropdown tree cannot end up orphaned.
  await db.query('DELETE FROM menus WHERE parent_id = ?', [id]);
  return db.query('DELETE FROM menus WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

async function listMedia({ page = 1, perPage = 24, folder = '', search = '', type = '' } = {}) {
  const conditions = [];
  const params = [];

  if (folder) {
    conditions.push('folder = ?');
    params.push(folder);
  }
  if (search) {
    conditions.push('(original_name LIKE ? OR alt_text LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (type === 'image') conditions.push("mime_type LIKE 'image/%'");
  if (type === 'document') conditions.push("mime_type NOT LIKE 'image/%'");

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return paginate({
    countSql: `SELECT COUNT(*) AS total FROM media ${where}`,
    countParams: params,
    rowSql: `SELECT * FROM media ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    rowParams: params,
    page,
    perPage,
  });
}

async function findMediaById(id) {
  return db.queryOne('SELECT * FROM media WHERE id = ? LIMIT 1', [id]);
}

async function deleteMedia(id) {
  return db.query('DELETE FROM media WHERE id = ?', [id]);
}

async function mediaFolders() {
  const rows = await db.query('SELECT folder, COUNT(*) AS total FROM media GROUP BY folder ORDER BY folder ASC');
  return rows;
}

module.exports = {
  listServices, findServiceById, findServiceBySlug, createService, updateService, deleteService,
  incrementServiceViews, relatedServices, serviceCounts,
  listCategories, findCategoryById, createCategory, updateCategory, deleteCategory,
  listPortfolio, findPortfolioById, findPortfolioBySlug, createPortfolio, updatePortfolio, deletePortfolio,
  portfolioCategories, relatedPortfolio,
  listTestimonials, findTestimonialById, createTestimonial, updateTestimonial, deleteTestimonial,
  listFaqs, findFaqById, createFaq, updateFaq, deleteFaq,
  listClients, findClientById, createClient, updateClient, deleteClient,
  findPageBySlug, findPageById, listPages, createPage, updatePage, deletePage,
  listPosts, findPostBySlug, findPostById, createPost, updatePost, deletePost,
  listPublishedPosts, featuredPosts, topPosts, recentPosts, postCategories, relatedPosts,
  incrementPostViews, publishedPostIndex,
  listMenus, findMenuById, createMenu, updateMenu, deleteMenu,
  listMedia, findMediaById, deleteMedia, mediaFolders,
};
