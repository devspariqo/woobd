/**
 * Authentication routes: customer signup, signin, Google OAuth, email
 * verification and password reset.
 *
 * Every write path is rate limited. Sign-in additionally uses a captcha and a
 * honeypot when the admin has enabled them.
 */
'use strict';

const express = require('express');

const ctrl = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const security = require('../middleware/security');
const captcha = require('../middleware/captcha');

const router = express.Router();

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
router.get('/signup', auth.requireGuest('customer'), ctrl.signupForm);

router.post(
  '/signup',
  auth.requireGuest('customer'),
  security.authLimiter,
  captcha.honeypot('website'),
  captcha.requireCaptcha('signup'),
  ctrl.signupSubmit
);

// ---------------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------------
router.get('/signin', auth.requireGuest('customer'), ctrl.signinForm);

router.post(
  '/signin',
  auth.requireGuest('customer'),
  security.authLimiter,
  captcha.honeypot('website'),
  captcha.requireCaptcha('login'),
  ctrl.signinSubmit
);

router.get('/signout', ctrl.signout);
router.post('/signout', ctrl.signout);

// ---------------------------------------------------------------------------
// Google OAuth
//
// The callback is a cross-site GET from Google, so it is exempted from CSRF in
// middleware/csrf.js and validated by the `state` parameter instead.
// ---------------------------------------------------------------------------
router.get('/auth/google', ctrl.googleStart);
router.get('/auth/google/callback', ctrl.googleCallback);

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------
router.get('/verify-email', ctrl.verifyEmail);
router.post('/verify-email/resend', security.formLimiter, ctrl.resendVerification);

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
router.get('/forgot-password', auth.requireGuest('customer'), ctrl.forgotForm);
router.post('/forgot-password', security.formLimiter, captcha.honeypot('website'), ctrl.forgotSubmit);
router.get('/reset-password', auth.requireGuest('customer'), ctrl.resetForm);
router.post('/reset-password', security.formLimiter, ctrl.resetSubmit);

module.exports = router;
