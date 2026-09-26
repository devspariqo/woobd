/**
 * Public site routes: marketing pages, portfolio, legal pages and the two
 * unauthenticated endpoints (contact form, newsletter, chat).
 *
 * Everything here is reachable without signing in, so each write path carries
 * its own rate limit and captcha/honeypot defence.
 */
'use strict';

const express = require('express');

const ctrl = require('../controllers/public.controller');
const security = require('../middleware/security');
const captcha = require('../middleware/captcha');

const router = express.Router();

// ---------------------------------------------------------------------------
// Marketing pages
// ---------------------------------------------------------------------------
router.get('/', ctrl.home);
router.get('/about', ctrl.about);
router.get('/services', ctrl.services);
router.get('/services/:slug', ctrl.serviceSingle);
router.get('/portfolio', ctrl.portfolio);
router.get('/portfolio/:slug', ctrl.portfolioSingle);
router.get('/contact', ctrl.contactForm);
router.get('/live-chat', ctrl.staticPage('live-chat'));

// ---------------------------------------------------------------------------
// Legal / static pages.
//
// Rendered from the `pages` table when a row exists, and from built-in copy
// otherwise, so the footer links never 404 on a fresh install.
// ---------------------------------------------------------------------------
router.get('/privacy-policy', ctrl.staticPage('privacy-policy'));
router.get('/terms-conditions', ctrl.staticPage('terms-conditions'));
router.get('/refund-policy', ctrl.staticPage('refund-policy'));
router.get('/page/:slug', ctrl.staticPage());

// ---------------------------------------------------------------------------
// Writes - limited + honeypot-checked
// ---------------------------------------------------------------------------
router.post(
  '/contact',
  security.formLimiter,
  captcha.honeypot('website'),
  captcha.requireCaptcha('contact'),
  ctrl.contactSubmit
);

router.post('/newsletter', security.formLimiter, captcha.honeypot('website'), ctrl.newsletterSubscribe);

// The chat widget is polled from the browser, so it gets its own generous limit
// keyed by session rather than a form limit.
router.post('/api/chat', security.chatLimiter, ctrl.chatMessage);

module.exports = router;
