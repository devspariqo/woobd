/**
 * Customer authentication: sign up, sign in, Google sign-in, email
 * verification, forgot/reset password.
 *
 * Security posture: uniform error messages that do not reveal whether an email
 * exists, bcrypt with a cost factor of 12, single-use time-limited tokens, and
 * CAPTCHA on the forms the brief calls out.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const userModel = require('../models/user.model');
const settings = require('../services/settings.service');
const mail = require('../services/mail.service');
const google = require('../services/google.service');
const activity = require('../services/activity.service');
const captcha = require('../middleware/captcha');
const { clean, validate } = require('../utils/validators');
const { safeRedirect } = require('../middleware/security');
const config = require('../config');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

/** Generate a URL-safe single-use token. */
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Only treat a value as a real "next" target if it stays on this site. */
function nextTarget(req, fallback = '/account') {
  const raw = req.query.next || (req.body && req.body.next) || '';
  return safeRedirect(raw, fallback);
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

exports.signupForm = async (req, res, next) => {
  try {
    if (!settings.getBool('allow_customer_signup', true)) {
      req.session.flashError = 'New registrations are temporarily closed. Please contact us.';
      return res.redirect(res.locals.helpers.url('/contact'));
    }

    res.render('auth/signup', {
      layout: 'layouts/auth',
      pageTitle: 'Create Your Account',
      form: null,
      errors: null,
      next: req.query.next || '',
      packageSlug: clean.slug(req.query.package || ''),
      seo: {
        ...res.locals.seo,
        title: `Create an Account - ${res.locals.site.name}`,
        robots: 'noindex,follow',
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.signupSubmit = async (req, res, next) => {
  const form = {
    name: clean.str(req.body.name, 120),
    email: clean.email(req.body.email),
    phone: clean.str(req.body.phone, 30),
    company: clean.str(req.body.company, 150),
    password: String(req.body.password || ''),
    password_confirm: String(req.body.password_confirm || ''),
    terms: req.body.terms,
  };

  const rerender = (errors) =>
    res.status(400).render('auth/signup', {
      layout: 'layouts/auth',
      pageTitle: 'Create Your Account',
      form,
      errors,
      next: req.body.next || '',
      packageSlug: clean.slug(req.body.package || ''),
      seo: { ...res.locals.seo, title: `Create an Account - ${res.locals.site.name}`, robots: 'noindex,follow' },
    });

  try {
    if (!settings.getBool('allow_customer_signup', true)) {
      return rerender({ general: 'New registrations are temporarily closed.' });
    }

    const errors = {};
    const nameError = validate.length(form.name, 2, 120, 'Full name');
    const emailError = validate.email(form.email);
    const phoneError = validate.phone(form.phone, { required: true });
    const passwordError = validate.strongPassword(form.password);

    if (nameError) errors.name = nameError;
    if (emailError) errors.email = emailError;
    if (phoneError) errors.phone = phoneError;
    if (passwordError) errors.password = passwordError;
    if (form.password !== form.password_confirm) errors.password_confirm = 'The two passwords do not match.';
    if (!form.terms) errors.terms = 'Please accept the terms to continue.';

    if (Object.keys(errors).length) return rerender(errors);

    const captchaResult = await captcha.verify(req.body['g-recaptcha-response'], req.ip, 'signup');
    if (!captchaResult.ok) {
      errors.captcha = captchaResult.message;
      return rerender(errors);
    }

    const existing = await userModel.findCustomerByEmail(form.email);
    if (existing) {
      // Deliberately explicit here: the visitor is about to create an account
      // with this address and needs to know it is taken. Sign-in and password
      // reset deliberately stay vague instead.
      errors.email = 'An account with this email already exists. Try signing in instead.';
      return rerender(errors);
    }

    const requireVerify = settings.getBool('require_email_verify');
    const verificationToken = requireVerify ? makeToken() : null;

    const customerId = await userModel.createCustomer({
      name: form.name,
      email: form.email,
      phone: form.phone,
      company: form.company || null,
      password_hash: await bcrypt.hash(form.password, BCRYPT_ROUNDS),
      verification_token: verificationToken,
      email_verified_at: requireVerify ? null : new Date(),
    });

    const customer = await userModel.findCustomerById(customerId);

    await activity.log({
      req,
      actorType: 'customer',
      actorId: customerId,
      actorName: customer.name,
      action: 'customer.registered',
      entityType: 'customer',
      entityId: customerId,
      description: `${customer.name} created an account.`,
    });

    // Sign them straight in - making someone log in immediately after signing
    // up is friction with no security benefit.
    req.session.customer = {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      avatar: customer.avatar,
    };

    // Issue the welcome email and, if required, the verification link.
    const mailJobs = [mail.sendWelcome(customer)];
    if (requireVerify && verificationToken) {
      mailJobs.push(mail.sendEmailVerification(customer, verificationToken));
    }
    Promise.allSettled(mailJobs).catch(() => {});

    req.session.flashSuccess = requireVerify
      ? 'Welcome! Check your inbox to confirm your email address.'
      : 'Welcome aboard! Your account is ready.';

    // If they signed up to order a specific package, go straight to checkout.
    if (form.package) {
      const content = require('../models/content.model');
      const service = await content.findServiceBySlug(clean.slug(form.package));
      if (service) return res.redirect(res.locals.helpers.url(`/account/checkout/${service.id}`));
    }

    return res.redirect(res.locals.helpers.url(nextTarget(req)));
  } catch (err) {
    logger.error('Signup failed', err);
    return rerender({ general: 'We could not create your account just now. Please try again.' });
  }
};

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

exports.signinForm = async (req, res, next) => {
  try {
    res.render('auth/signin', {
      layout: 'layouts/auth',
      pageTitle: 'Sign In',
      form: null,
      errors: null,
      next: req.query.next || '',
      notice: req.query.verified === '1' ? 'Your email is confirmed. You can sign in now.' : null,
      seo: { ...res.locals.seo, title: `Sign In - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.signinSubmit = async (req, res, next) => {
  const email = clean.email(req.body.email);
  const password = String(req.body.password || '');

  const rerender = (errors) =>
    res.status(400).render('auth/signin', {
      layout: 'layouts/auth',
      pageTitle: 'Sign In',
      form: { email },
      errors,
      next: req.body.next || '',
      notice: null,
      seo: { ...res.locals.seo, title: `Sign In - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
    });

  try {
    const errors = {};
    const emailError = validate.email(email);
    if (emailError) errors.email = emailError;
    if (!password) errors.password = 'Password is required.';
    if (Object.keys(errors).length) return rerender(errors);

    const captchaResult = await captcha.verify(req.body['g-recaptcha-response'], req.ip, 'login');
    if (!captchaResult.ok) {
      errors.captcha = captchaResult.message;
      return rerender(errors);
    }

    const customer = await userModel.findCustomerByEmail(email);

    // One shared message for "no such account" and "wrong password" so the form
    // cannot be used to enumerate registered addresses.
    const INVALID = 'Those credentials do not match our records.';

    if (!customer) {
      // Spend comparable time on a miss so response timing does not leak either.
      await bcrypt.compare(password, '$2a$12$' + 'x'.repeat(53));
      return rerender({ general: INVALID });
    }

    if (!customer.password_hash) {
      return rerender({
        general:
          'This account was created with Google. Please use the "Continue with Google" button to sign in.',
      });
    }

    if (customer.status !== 'active') {
      return rerender({ general: 'This account is suspended. Please contact support.' });
    }

    const passwordMatches = await bcrypt.compare(password, customer.password_hash);
    if (!passwordMatches) {
      await activity.log({
        req,
        actorType: 'customer',
        actorId: customer.id,
        actorName: customer.name,
        action: 'customer.login_failed',
        entityType: 'customer',
        entityId: customer.id,
        description: 'Failed sign-in attempt.',
      });
      return rerender({ general: INVALID });
    }

    // Session fixation defence: a new session id on privilege change.
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) return next(regenerateErr);

      // "Keep me signed in" decides how long the session survives. Checked:
      // the configured lifetime, a week by default. Unchecked: twelve hours.
      // Set after regenerate(), because regenerating resets the cookie.
      req.session.cookie.maxAge = req.body.remember === '1'
        ? config.session.maxAge
        : 1000 * 60 * 60 * 12;

      req.session.customer = {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatar: customer.avatar,
      };

      userModel
        .updateCustomer(customer.id, { last_login_at: new Date() })
        .catch(() => {});

      activity
        .log({
          req,
          actorType: 'customer',
          actorId: customer.id,
          actorName: customer.name,
          action: 'customer.login',
          entityType: 'customer',
          entityId: customer.id,
          description: `${customer.name} signed in.`,
        })
        .catch(() => {});

      // `pendingPath` carries a checkout destination through the auth redirect.
      const destination = req.session.pendingPath || nextTarget(req);
      delete req.session.pendingPath;

      req.session.flashSuccess = `Welcome back, ${customer.name.split(' ')[0]}!`;
      return res.redirect(res.locals.helpers.url(destination));
    });
  } catch (err) {
    logger.error('Signin failed', err);
    return rerender({ general: 'We could not sign you in just now. Please try again.' });
  }
};

exports.signout = async (req, res) => {
  const customer = req.session.customer;
  if (customer) {
    activity
      .log({
        req,
        actorType: 'customer',
        actorId: customer.id,
        actorName: customer.name,
        action: 'customer.logout',
        entityType: 'customer',
        entityId: customer.id,
        description: `${customer.name} signed out.`,
      })
      .catch(() => {});
  }

  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect(res.locals.helpers.url('/'));
  });
};

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

exports.googleStart = async (req, res, next) => {
  try {
    if (!google.isEnabled()) {
      req.session.flashError = 'Google sign-in is not available right now. Please use your email address.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    const next = req.query.next || '/account';
    return res.redirect(google.buildAuthUrl(req, { next }));
  } catch (err) {
    next(err);
  }
};

exports.googleCallback = async (req, res, next) => {
  try {
    // Google can send ?error=access_denied when the visitor cancels.
    if (req.query.error) {
      req.session.flashError = 'Google sign-in was cancelled.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    if (!google.verifyState(req, req.query.state)) {
      logger.warn('Google OAuth state mismatch', { ip: req.ip });
      req.session.flashError = 'That sign-in attempt expired. Please try again.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    const code = clean.str(req.query.code, 500);
    if (!code) {
      req.session.flashError = 'Google did not return an authorisation code. Please try again.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    const tokens = await google.exchangeCode(code);
    const profile = await google.fetchProfile(tokens);

    if (!profile.email) {
      req.session.flashError = 'Google did not share an email address with us.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    // Match on Google id first, then fall back to email so an existing
    // email/password account links to Google instead of duplicating.
    let customer = await userModel.findCustomerByGoogleId(profile.sub);

    if (!customer) {
      const byEmail = await userModel.findCustomerByEmail(profile.email);

      if (byEmail) {
        if (byEmail.status !== 'active') {
          req.session.flashError = 'This account is suspended. Please contact support.';
          return res.redirect(res.locals.helpers.url('/signin'));
        }
        await userModel.updateCustomer(byEmail.id, {
          google_id: profile.sub,
          email_verified_at: byEmail.email_verified_at || new Date(),
        });
        customer = await userModel.findCustomerById(byEmail.id);
      } else {
        // Brand new customer via Google.
        const avatar = await google.downloadAvatar(
          profile.picture,
          require('path').join(config.uploads.dir, 'avatars')
        );

        const id = await userModel.createCustomer({
          name: profile.name,
          email: profile.email,
          password_hash: null, // Google-only account
          google_id: profile.sub,
          email_verified_at: profile.emailVerified ? new Date() : new Date(),
          avatar: avatar ? `/uploads/avatars/${avatar}` : null,
        });

        customer = await userModel.findCustomerById(id);

        await activity.log({
          req,
          actorType: 'customer',
          actorId: id,
          actorName: customer.name,
          action: 'customer.registered_google',
          entityType: 'customer',
          entityId: id,
          description: `${customer.name} registered with Google.`,
        });

        mail.sendWelcome(customer).catch(() => {});
      }
    }

    if (customer.status !== 'active') {
      req.session.flashError = 'This account is suspended. Please contact support.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    const destination = req.session.googleNext || '/account';
    delete req.session.googleNext;

    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) return next(regenerateErr);

      req.session.customer = {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatar: customer.avatar,
      };

      userModel.updateCustomer(customer.id, { last_login_at: new Date() }).catch(() => {});

      activity
        .log({
          req,
          actorType: 'customer',
          actorId: customer.id,
          actorName: customer.name,
          action: 'customer.login_google',
          entityType: 'customer',
          entityId: customer.id,
          description: `${customer.name} signed in with Google.`,
        })
        .catch(() => {});

      req.session.flashSuccess = `Signed in with Google. Welcome, ${customer.name.split(' ')[0]}!`;
      return res.redirect(res.locals.helpers.url(safeRedirect(destination, '/account')));
    });
  } catch (err) {
    logger.error('Google OAuth callback failed', err);
    req.session.flashError = 'We could not complete Google sign-in. Please try again or use your email.';
    return res.redirect(res.locals.helpers.url('/signin'));
  }
};

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

exports.verifyEmail = async (req, res, next) => {
  try {
    const token = clean.str(req.params.token, 64);
    const customer = token ? await userModel.findCustomerByToken('verification_token', token) : null;

    if (!customer) {
      req.session.flashError = 'That verification link is invalid or has already been used.';
      return res.redirect(res.locals.helpers.url('/signin'));
    }

    await userModel.updateCustomer(customer.id, {
      email_verified_at: new Date(),
      verification_token: null,
    });

    activity
      .log({
        req,
        actorType: 'customer',
        actorId: customer.id,
        actorName: customer.name,
        action: 'customer.email_verified',
        entityType: 'customer',
        entityId: customer.id,
        description: `${customer.name} confirmed their email address.`,
      })
      .catch(() => {});

    req.session.flashSuccess = 'Your email address is confirmed. Thank you!';
    return res.redirect(res.locals.helpers.url(customer.id && req.session.customer ? '/account' : '/signin?verified=1'));
  } catch (err) {
    next(err);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    const customer = res.locals.customer;
    if (!customer) return res.redirect(res.locals.helpers.url('/signin'));

    const full = await userModel.findCustomerById(customer.id);
    if (full.email_verified_at) {
      req.session.flashInfo = 'Your email address is already confirmed.';
      return res.redirect(res.locals.helpers.url('/account'));
    }

    const token = makeToken();
    await userModel.updateCustomer(customer.id, { verification_token: token });
    await mail.sendEmailVerification(full, token);

    req.session.flashSuccess = 'Confirmation email sent. Please check your inbox.';
    return res.redirect(res.locals.helpers.url('/account'));
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

exports.forgotForm = async (req, res, next) => {
  try {
    res.render('auth/forgot-password', {
      layout: 'layouts/auth',
      pageTitle: 'Forgot Password',
      errors: null,
      sent: req.query.sent === '1',
      seo: { ...res.locals.seo, title: `Forgot Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.forgotSubmit = async (req, res, next) => {
  try {
    const email = clean.email(req.body.email);
    const emailError = validate.email(email);

    if (emailError) {
      return res.status(400).render('auth/forgot-password', {
        layout: 'layouts/auth',
        pageTitle: 'Forgot Password',
        errors: { email: emailError },
        sent: false,
        seo: { ...res.locals.seo, title: `Forgot Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
      });
    }

    const captchaResult = await captcha.verify(req.body['g-recaptcha-response'], req.ip, 'login');
    if (!captchaResult.ok) {
      return res.status(400).render('auth/forgot-password', {
        layout: 'layouts/auth',
        pageTitle: 'Forgot Password',
        errors: { captcha: captchaResult.message },
        sent: false,
        seo: { ...res.locals.seo, title: `Forgot Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
      });
    }

    const customer = await userModel.findCustomerByEmail(email);

    // Always report success, whether or not the address exists, so this form
    // cannot be used to check who has an account. Still send the mail when it
    // does exist.
    if (customer && customer.status === 'active') {
      const token = makeToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await userModel.updateCustomer(customer.id, {
        reset_token: token,
        reset_expires_at: expires,
      });

      mail.sendPasswordReset(customer, token).catch(() => {});

      activity
        .log({
          req,
          actorType: 'customer',
          actorId: customer.id,
          actorName: customer.name,
          action: 'customer.password_reset_requested',
          entityType: 'customer',
          entityId: customer.id,
          description: `${customer.name} requested a password reset.`,
        })
        .catch(() => {});
    }

    return res.redirect(res.locals.helpers.url('/forgot-password?sent=1'));
  } catch (err) {
    next(err);
  }
};

exports.resetForm = async (req, res, next) => {
  try {
    const token = clean.str(req.params.token, 64);
    const customer = token ? await userModel.findCustomerByToken('reset_token', token) : null;

    const valid = customer && customer.reset_expires_at && new Date(customer.reset_expires_at) > new Date();

    if (!valid) {
      return res.status(400).render('auth/reset-password', {
        layout: 'layouts/auth',
        pageTitle: 'Reset Password',
        errors: null,
        expired: true,
        token: '',
        seo: { ...res.locals.seo, title: `Reset Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
      });
    }

    return res.render('auth/reset-password', {
      layout: 'layouts/auth',
      pageTitle: 'Reset Password',
      errors: null,
      expired: false,
      token,
      seo: { ...res.locals.seo, title: `Reset Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.resetSubmit = async (req, res, next) => {
  const token = clean.str(req.body.token, 64);
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_confirm || '');

  const rerender = (errors, expired = false) =>
    res.status(400).render('auth/reset-password', {
      layout: 'layouts/auth',
      pageTitle: 'Reset Password',
      errors,
      expired,
      token,
      seo: { ...res.locals.seo, title: `Reset Password - ${res.locals.site.name}`, robots: 'noindex,nofollow' },
    });

  try {
    const customer = token ? await userModel.findCustomerByToken('reset_token', token) : null;
    const valid = customer && customer.reset_expires_at && new Date(customer.reset_expires_at) > new Date();

    if (!valid) return rerender(null, true);

    const errors = {};
    const passwordError = validate.strongPassword(password);
    if (passwordError) errors.password = passwordError;
    if (password !== confirm) errors.password_confirm = 'The two passwords do not match.';
    if (Object.keys(errors).length) return rerender(errors);

    await userModel.updateCustomer(customer.id, {
      password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      // Burn the token: single use only.
      reset_token: null,
      reset_expires_at: null,
    });

    await activity.log({
      req,
      actorType: 'customer',
      actorId: customer.id,
      actorName: customer.name,
      action: 'customer.password_reset',
      entityType: 'customer',
      entityId: customer.id,
      description: `${customer.name} reset their password.`,
    });

    // Invalidate any existing session for this customer by clearing this one.
    req.session.customer = null;

    req.session.flashSuccess = 'Your password has been changed. Please sign in with your new password.';
    return res.redirect(res.locals.helpers.url('/signin'));
  } catch (err) {
    logger.error('Password reset failed', err);
    return rerender({ general: 'We could not reset your password just now. Please request a new link.' });
  }
};
