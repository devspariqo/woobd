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
// The link in the verification email is /verify-email/<token>, and the handler
// reads req.params.token. Without this route the link 404s - the bare path
// above only ever matched a link with no token in it, which is not what the
// email sends.
router.get('/verify-email/:token', ctrl.verifyEmail);
router.post('/verify-email/resend', security.formLimiter, ctrl.resendVerification);

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
router.get('/forgot-password', auth.requireGuest('customer'), ctrl.forgotForm);
router.post('/forgot-password', security.formLimiter, captcha.honeypot('website'), ctrl.forgotSubmit);
router.get('/reset-password', auth.requireGuest('customer'), ctrl.resetForm);
// Same problem as the verification link: the email sends /reset-password/<token>
// and the handler reads req.params.token, so without this the customer clicked
// a link that 404'd. The bare path above stays for a link with no token, where
// the handler renders its "this link has expired" state.
router.get('/reset-password/:token', auth.requireGuest('customer'), ctrl.resetForm);
router.post('/reset-password', security.formLimiter, ctrl.resetSubmit);

module.exports = router;
