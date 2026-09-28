/**
 * Every email the application can send.
 *
 * One list, shared by two consumers: the settings registry turns each entry into
 * an editable subject and heading, and the mail service reads them back at send
 * time. Keeping two lists would guarantee drift, and the failure is silent - an
 * operator edits a subject that no longer applies to anything, and the email
 * keeps going out with the old wording.
 *
 * `subject` and `heading` are the built-in defaults, used whenever the matching
 * setting is blank. They are what the application shipped with, so an untouched
 * install sends exactly what it always did.
 *
 * `vars` documents which placeholders each template supports. Substitution is
 * plain `{name}` replacement; an unknown placeholder is left visible rather
 * than silently blanked, so a typo shows up in a test send instead of quietly
 * producing a subject with a hole in it.
 */
'use strict';

const TEMPLATES = [
  {
    key: 'welcome',
    label: 'Welcome — new account',
    subject: 'Welcome to {site}',
    heading: 'Welcome aboard, {first_name}!',
    vars: ['site', 'first_name'],
  },
  {
    key: 'password_reset',
    label: 'Password reset',
    subject: 'Reset your password',
    heading: 'Reset your password',
    vars: ['site', 'first_name'],
  },
  {
    key: 'email_verification',
    label: 'Email verification',
    subject: 'Confirm your email address',
    heading: 'Confirm your email address',
    vars: ['site', 'first_name'],
  },
  {
    key: 'order_confirmation',
    label: 'Order confirmation — to the customer',
    subject: 'Order received - {order_number}',
    heading: 'Order {order_number} received',
    vars: ['site', 'first_name', 'order_number', 'package', 'total'],
  },
  {
    key: 'order_status',
    label: 'Order status change — to the customer',
    subject: 'Order {order_number} is now {status}',
    heading: 'Your order is now {status}',
    vars: ['site', 'first_name', 'order_number', 'status', 'package'],
  },
  {
    key: 'payment_received',
    label: 'Payment confirmed',
    subject: 'Payment received - {amount}',
    heading: 'Payment confirmed',
    vars: ['site', 'first_name', 'amount', 'order_number'],
  },
  {
    key: 'payment_rejected',
    label: 'Payment could not be verified',
    subject: 'We could not verify your payment',
    heading: 'Payment needs another look',
    vars: ['site', 'first_name', 'order_number'],
  },
  {
    key: 'ticket_reply',
    label: 'Support ticket reply',
    subject: 'Re: {ticket_subject} [{ticket_number}]',
    heading: 'New reply on your ticket',
    vars: ['site', 'first_name', 'ticket_subject', 'ticket_number'],
  },
  {
    key: 'contact_ack',
    label: 'Contact form — acknowledgement to the sender',
    subject: 'We received your message',
    heading: 'Thanks for getting in touch',
    vars: ['site', 'name'],
  },
  {
    key: 'contact_notify',
    label: 'Contact form — alert to the admin',
    subject: 'New enquiry from {name}',
    heading: 'New website enquiry',
    vars: ['site', 'name', 'email'],
  },
  {
    key: 'admin_new_order',
    label: 'New order — alert to the admin',
    subject: 'New order {order_number} — {package}',
    heading: 'A new order just came in',
    vars: ['site', 'order_number', 'package', 'total'],
  },
  {
    key: 'test',
    label: 'SMTP test message',
    subject: '{site} - SMTP test',
    heading: 'Your SMTP settings work',
    vars: ['site'],
  },
];

const BY_KEY = TEMPLATES.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

/**
 * Replace {placeholders} with the values supplied.
 *
 * An unknown placeholder is left in place. Blanking it would produce a subject
 * that reads fine and says nothing - "Order  is now" - which is far harder to
 * notice than a visible `{order_number}`.
 */
function fill(text, vars) {
  return String(text || '').replace(/\{([a-z_]+)\}/gi, (match, name) => {
    const value = vars && vars[name];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
}

module.exports = { TEMPLATES, BY_KEY, fill };
