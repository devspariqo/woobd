/**
 * SMTP transport and the transactional email templates.
 *
 * Configuration is read from the settings table first and the environment
 * second, so the operator can rotate credentials from the admin panel without
 * a redeploy. When SMTP is not configured the send is logged and skipped rather
 * than throwing - a mail outage must not break signup or checkout.
 */
'use strict';

const nodemailer = require('nodemailer');

const config = require('../config');
const settings = require('../services/settings.service');
const logger = require('../utils/logger');
const helpers = require('../utils/helpers');

let transporter = null;
let transporterKey = '';

/** Build (or reuse) a transport. Rebuilt when the SMTP settings change. */
function getTransport() {
  const options = {
    host: settings.secret('smtp_host', config.smtp.host),
    port: settings.getInt('smtp_port', config.smtp.port),
    secure: settings.getBool('smtp_secure', config.smtp.secure),
    user: settings.secret('smtp_user', config.smtp.user),
    password: settings.secret('smtp_password', config.smtp.password),
  };

  const key = `${options.host}:${options.port}:${options.secure}:${options.user}`;
  if (transporter && transporterKey === key) return transporter;

  if (!options.host || !options.user || !options.password) return null;

  transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password },
    // Hostinger's mail server can be slow under load; give it room.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    pool: true,
    maxConnections: 3,
    tls: { rejectUnauthorized: false },
  });
  transporterKey = key;
  return transporter;
}

function resetTransport() {
  if (transporter && typeof transporter.close === 'function') transporter.close();
  transporter = null;
  transporterKey = '';
}

/**
 * The branded shell every message is wrapped in.
 *
 * Table-based with inline styles, because that is the only thing Outlook,
 * Gmail and Apple Mail all agree on. No external CSS, no flexbox, no grid.
 *
 * Design notes worth keeping:
 *   - The header carries the LIGHT logo on white. `logo_light` is the artwork
 *     drawn for a light background; the dark variant would disappear here. The
 *     site's own name is the fallback when no logo is uploaded.
 *   - A colour strip under the header ties the message to the brand without
 *     putting the logo on a saturated field, where a light-background logo
 *     would be invisible.
 *   - The footer is the part people actually scroll to when they want to reply
 *     or call, so it carries the full set rather than just an address.
 */
function wrapLayout({ title, body, ctaText, ctaUrl, footerNote, preheader }) {
  const primary = settings.get('theme_primary', '#5b21f0');
  const primaryDark = settings.get('theme_primary_dark', '#4316c4');
  const siteName = settings.get('site_name', 'WooBD.Com');
  const siteUrl = config.app.url;
  const address = settings.get('office_address', '');
  const email = settings.get('contact_email', '');
  const phone = settings.get('contact_phone', '');
  const whatsapp = settings.get('whatsapp_link', '');
  const whatsappLabel = settings.get('whatsapp_number', '');
  const facebook = settings.get('social_facebook', '');
  const linkedin = settings.get('social_linkedin', '');
  const instagram = settings.get('social_instagram', '');
  const youtube = settings.get('social_youtube', '');

  // Absolute, because a relative path is meaningless in an inbox.
  const logoPath = settings.get('logo_light', '');
  const logoUrl = logoPath
    ? (/^https?:\/\//i.test(logoPath) ? logoPath : `${siteUrl}${helpers.url(logoPath)}`)
    : '';

  const socials = [
    facebook && { label: 'Facebook', url: facebook },
    linkedin && { label: 'LinkedIn', url: linkedin },
    instagram && { label: 'Instagram', url: instagram },
    youtube && { label: 'YouTube', url: youtube },
  ].filter(Boolean);

  // Shown in the inbox preview line next to the subject. Without it the client
  // pulls whatever text it finds first, which is usually "View this in browser".
  const preview = preheader || title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${helpers.escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <div style="display:none;font-size:1px;color:#eef0f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${helpers.escapeHtml(preview)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f7;padding:32px 12px;">
    <tr>
      <td align="center">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 28px rgba(16,18,35,.09);">

          <!-- Header: logo on white -->
          <tr>
            <td align="center" style="padding:30px 32px 22px;background:#ffffff;">
              ${
                logoUrl
                  ? `<img src="${logoUrl}" alt="${helpers.escapeHtml(siteName)}" height="42" style="display:block;height:42px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;">`
                  : `<span style="font-size:21px;font-weight:800;color:#101223;letter-spacing:-.3px;">${helpers.escapeHtml(siteName)}</span>`
              }
            </td>
          </tr>

          <!-- Brand strip -->
          <tr>
            <td style="height:5px;line-height:5px;font-size:0;background:${primary};">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:34px 34px 8px;">
              <h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;color:#101223;font-weight:700;letter-spacing:-.2px;">${helpers.escapeHtml(title)}</h1>
              <div style="font-size:15px;line-height:1.68;color:#3d4257;">${body}</div>
              ${
                ctaText && ctaUrl
                  ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;">
                      <tr>
                        <td style="background:${primary};border-radius:10px;box-shadow:0 4px 12px rgba(91,33,240,.24);">
                          <a href="${ctaUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${helpers.escapeHtml(ctaText)}</a>
                        </td>
                      </tr>
                     </table>`
                  : ''
              }
              ${
                footerNote
                  ? `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #eceef6;font-size:13px;line-height:1.65;color:#767c94;">${footerNote}</p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:26px 34px 30px;background:#f7f8fc;border-top:1px solid #e7e9f2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:13px;line-height:1.7;color:#767c94;padding-bottom:14px;">
                    <strong style="color:#101223;font-size:14px;">${helpers.escapeHtml(siteName)}</strong><br>
                    ${address ? `${helpers.escapeHtml(address)}<br>` : ''}
                    ${email ? `<a href="mailto:${helpers.escapeHtml(email)}" style="color:${primary};text-decoration:none;">${helpers.escapeHtml(email)}</a>` : ''}
                    ${email && phone ? ' &nbsp;·&nbsp; ' : ''}
                    ${phone ? `<a href="tel:${helpers.escapeHtml(String(phone).replace(/\s/g, ''))}" style="color:${primary};text-decoration:none;">${helpers.escapeHtml(phone)}</a>` : ''}
                  </td>
                </tr>
                ${
                  whatsapp || socials.length
                    ? `<tr>
                        <td style="padding-bottom:14px;font-size:13px;line-height:1.9;">
                          ${whatsapp ? `<a href="${whatsapp}" style="color:${primary};text-decoration:none;font-weight:600;">WhatsApp${whatsappLabel ? ` ${helpers.escapeHtml(whatsappLabel)}` : ''}</a>` : ''}
                          ${whatsapp && socials.length ? `<span style="color:#c3c7d6;"> &nbsp;·&nbsp; </span>` : ''}
                          ${socials.map((s) => `<a href="${s.url}" style="color:${primary};text-decoration:none;font-weight:600;">${s.label}</a>`).join('<span style="color:#c3c7d6;"> &nbsp;·&nbsp; </span>')}
                        </td>
                      </tr>`
                    : ''
                }
                <tr>
                  <td style="padding-top:16px;border-top:1px solid #e7e9f2;font-size:12px;line-height:1.7;color:#9aa0b6;">
                    <a href="${siteUrl}" style="color:${primaryDark};text-decoration:none;font-weight:600;">${helpers.escapeHtml(String(siteUrl).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a><br>
                    You are receiving this because you have an account or placed an order with us.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send a message.
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string}>}
 */
async function send({ to, subject, html, text, replyTo }) {
  if (!settings.getBool('smtp_enabled', true)) {
    logger.info('Mail skipped - SMTP disabled', { to, subject });
    return { ok: false, skipped: true };
  }

  const transport = getTransport();
  const fromName = settings.get('mail_from_name', config.smtp.fromName);
  const fromEmail = settings.secret('mail_from_email', config.smtp.fromEmail);

  if (!transport) {
    logger.warn('Mail skipped - SMTP not configured', { to, subject });
    return { ok: false, skipped: true, error: 'SMTP not configured' };
  }

  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      text: text || undefined,
      replyTo: replyTo || fromEmail,
    });
    logger.info('Mail sent', { to, subject, id: info.messageId });
    return { ok: true, id: info.messageId };
  } catch (err) {
    logger.error('Mail send failed', { to, subject, error: err.message });
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Verify the SMTP credentials with a real connection. Used by the admin panel
 *  "send test email" button so a silent mail failure is caught early. */
async function verify() {
  const transport = getTransport();
  if (!transport) return { ok: false, error: 'SMTP is not configured.' };
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendTest(to) {
  return send({
    to,
    subject: `${settings.get('site_name')} - SMTP test`,
    html: wrapLayout({
      title: 'Your SMTP settings work',
      body: '<p>This is a test message confirming that outgoing mail is configured correctly. Order confirmations, password resets and ticket replies will now be delivered.</p>',
      ctaText: 'Open the dashboard',
      ctaUrl: `${config.app.url}${helpers.url('/admin/dashboard')}`,
    }),
    text: 'Your SMTP settings work. Outgoing mail is configured correctly.',
  });
}

async function sendWelcome(customer) {
  return send({
    to: customer.email,
    subject: `Welcome to ${settings.get('site_name')}`,
    html: wrapLayout({
      title: `Welcome aboard, ${customer.name.split(' ')[0]}!`,
      body: `<p>Your account is ready. From your dashboard you can browse packages, place an order, upload payment proof and track delivery progress.</p>
             <p style="margin-top:14px;"><strong>Email:</strong> ${helpers.escapeHtml(customer.email)}</p>`,
      ctaText: 'Go to my dashboard',
      ctaUrl: `${config.app.url}${helpers.url('/account')}`,
      footerNote: 'If you did not create this account you can safely ignore this email.',
    }),
    text: `Welcome to ${settings.get('site_name')}, ${customer.name}. Your account is ready: ${config.app.url}${helpers.url('/account')}`,
  });
}

async function sendPasswordReset(customer, token) {
  const link = `${config.app.url}${helpers.url(`/reset-password/${token}`)}`;
  return send({
    to: customer.email,
    subject: 'Reset your password',
    html: wrapLayout({
      title: 'Reset your password',
      body: `<p>Hi ${helpers.escapeHtml(customer.name)}, we received a request to reset the password on your account.</p>
             <p>This link is valid for one hour and can only be used once.</p>`,
      ctaText: 'Choose a new password',
      ctaUrl: link,
      footerNote: `If the button does not work, paste this address into your browser:<br><span style="word-break:break-all;color:#5b21f0;">${link}</span><br><br>If you did not request this, no action is needed - your password is unchanged.`,
    }),
    text: `Reset your password: ${link} (valid for one hour)`,
  });
}

async function sendEmailVerification(customer, token) {
  const link = `${config.app.url}${helpers.url(`/verify-email/${token}`)}`;
  return send({
    to: customer.email,
    subject: 'Confirm your email address',
    html: wrapLayout({
      title: 'Confirm your email address',
      body: `<p>Hi ${helpers.escapeHtml(customer.name)}, please confirm your email address to activate every feature of your account.</p>`,
      ctaText: 'Confirm my email',
      ctaUrl: link,
      footerNote: 'If you did not sign up, you can ignore this message.',
    }),
    text: `Confirm your email: ${link}`,
  });
}

async function sendOrderConfirmation(customer, order) {
  return send({
    to: customer.email,
    subject: `Order received - ${order.order_number}`,
    html: wrapLayout({
      title: `Order ${order.order_number} received`,
      body: `<p>Thanks ${helpers.escapeHtml(customer.name.split(' ')[0])}, we have your order and the team is reviewing it.</p>
             <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:18px;border-collapse:collapse;font-size:14px;">
               <tr><td style="padding:9px 0;border-bottom:1px solid #eceef6;color:#767c94;">Package</td><td style="padding:9px 0;border-bottom:1px solid #eceef6;text-align:right;font-weight:600;">${helpers.escapeHtml(order.service_title)}</td></tr>
               <tr><td style="padding:9px 0;border-bottom:1px solid #eceef6;color:#767c94;">Billing</td><td style="padding:9px 0;border-bottom:1px solid #eceef6;text-align:right;">${helpers.escapeHtml(helpers.humanise(order.billing_cycle))}</td></tr>
               <tr><td style="padding:9px 0;border-bottom:1px solid #eceef6;color:#767c94;">Total</td><td style="padding:9px 0;border-bottom:1px solid #eceef6;text-align:right;font-weight:700;">${helpers.money(order.total, settings.get('currency_symbol'))}</td></tr>
               <tr><td style="padding:9px 0;color:#767c94;">Payment</td><td style="padding:9px 0;text-align:right;">${helpers.escapeHtml(helpers.humanise(order.payment_status))}</td></tr>
             </table>
             <p style="margin-top:18px;">Next step: send the amount by bKash, Nagad or Rocket, then submit the transaction ID from your order page.</p>`,
      ctaText: 'View order',
      ctaUrl: `${config.app.url}${helpers.url(`/account/orders/${order.id}`)}`,
    }),
    text: `Order ${order.order_number} received. Total ${order.total}. View it: ${config.app.url}${helpers.url(`/account/orders/${order.id}`)}`,
  });
}

async function sendOrderStatusUpdate(customer, order, note) {
  const statusLabels = {
    pending: 'Pending review',
    in_progress: 'In progress',
    active: 'Active - your site is live',
    completed: 'Completed',
    cancelled: 'Cancelled',
    on_hold: 'On hold',
  };
  const label = statusLabels[order.status] || helpers.humanise(order.status);
  const isLive = order.status === 'active';

  return send({
    to: customer.email,
    subject: `Order ${order.order_number} is now ${label.toLowerCase()}`,
    html: wrapLayout({
      title: `Your order is now ${label}`,
      body: `<p>Hi ${helpers.escapeHtml(customer.name.split(' ')[0])}, the status of <strong>${helpers.escapeHtml(order.order_number)}</strong> (${helpers.escapeHtml(order.service_title)}) has changed.</p>
             ${note ? `<p style="margin-top:14px;padding:13px 16px;background:#f7f8fc;border-left:3px solid ${settings.get('theme_primary')};border-radius:0 8px 8px 0;">${helpers.escapeHtml(note)}</p>` : ''}
             ${isLive ? '<p style="margin-top:14px;">Your website is live and your access details are waiting in your dashboard.</p>' : ''}`,
      ctaText: isLive ? 'View my website details' : 'View order',
      ctaUrl: `${config.app.url}${helpers.url(`/account/orders/${order.id}`)}`,
    }),
    text: `Order ${order.order_number} is now ${label}. ${config.app.url}${helpers.url(`/account/orders/${order.id}`)}`,
  });
}

async function sendPaymentReceived(customer, payment) {
  return send({
    to: customer.email,
    subject: `Payment received - ${helpers.money(payment.amount, settings.get('currency_symbol'))}`,
    html: wrapLayout({
      title: 'Payment confirmed',
      body: `<p>Hi ${helpers.escapeHtml(customer.name.split(' ')[0])}, we have verified your payment of <strong>${helpers.money(payment.amount, settings.get('currency_symbol'))}</strong> via ${helpers.escapeHtml(payment.method)}.</p>
             <p>${payment.order_id ? 'Your order is moving forward.' : 'Thank you for your business.'}</p>`,
      ctaText: 'View my orders',
      ctaUrl: `${config.app.url}${helpers.url('/account/orders')}`,
    }),
    text: `Payment of ${payment.amount} confirmed via ${payment.method}.`,
  });
}

async function sendPaymentRejected(customer, payment, reason) {
  return send({
    to: customer.email,
    subject: 'We could not verify your payment',
    html: wrapLayout({
      title: 'Payment needs another look',
      body: `<p>Hi ${helpers.escapeHtml(customer.name.split(' ')[0])}, we were unable to verify the payment you submitted${payment.transaction_id ? ` (transaction ${helpers.escapeHtml(payment.transaction_id)})` : ''}.</p>
             ${reason ? `<p style="margin-top:14px;padding:13px 16px;background:#fff5f5;border-left:3px solid #e02b2b;border-radius:0 8px 8px 0;">${helpers.escapeHtml(reason)}</p>` : ''}
             <p style="margin-top:14px;">Please double-check the transaction ID and amount, then submit it again. If you believe this is a mistake, contact us on WhatsApp and we will sort it out.</p>`,
      ctaText: 'Submit payment again',
      ctaUrl: `${config.app.url}${helpers.url('/account/orders')}`,
    }),
    text: 'We could not verify your payment. Please resubmit the transaction details.',
  });
}

async function sendTicketReply(customer, ticket, reply) {
  return send({
    to: customer.email,
    subject: `Re: ${ticket.subject} [${ticket.ticket_number}]`,
    html: wrapLayout({
      title: 'New reply on your ticket',
      body: `<p>Hi ${helpers.escapeHtml(customer.name.split(' ')[0])}, our team replied to <strong>${helpers.escapeHtml(ticket.subject)}</strong>.</p>
             <div style="margin-top:16px;padding:15px 17px;background:#f7f8fc;border-radius:10px;font-size:14.5px;">${helpers.escapeHtml(reply.message).replace(/\n/g, '<br>')}</div>`,
      ctaText: 'Open the ticket',
      ctaUrl: `${config.app.url}${helpers.url(`/account/tickets/${ticket.id}`)}`,
    }),
    text: `New reply on ticket ${ticket.ticket_number}: ${reply.message}`,
  });
}

async function sendContactAcknowledgement(entry) {
  return send({
    to: entry.email,
    subject: 'We received your message',
    html: wrapLayout({
      title: 'Thanks for getting in touch',
      body: `<p>Hi ${helpers.escapeHtml(entry.name)}, your message reached us and a member of the team will reply within one business day.</p>
             <p style="margin-top:14px;color:#767c94;font-size:14px;"><strong>Your message:</strong><br>${helpers.escapeHtml(entry.message).replace(/\n/g, '<br>')}</p>`,
      ctaText: 'Browse our packages',
      ctaUrl: `${config.app.url}${helpers.url('/services')}`,
    }),
    text: 'We received your message and will reply within one business day.',
  });
}

async function sendContactNotification(entry) {
  const to = settings.get('notify_admin_email') || settings.get('contact_email');
  if (!to) return { ok: false, skipped: true };
  return send({
    to,
    subject: `New enquiry from ${entry.name}`,
    replyTo: entry.email,
    html: wrapLayout({
      title: 'New website enquiry',
      body: `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
               <tr><td style="padding:8px 0;border-bottom:1px solid #eceef6;color:#767c94;width:110px;">Name</td><td style="padding:8px 0;border-bottom:1px solid #eceef6;">${helpers.escapeHtml(entry.name)}</td></tr>
               <tr><td style="padding:8px 0;border-bottom:1px solid #eceef6;color:#767c94;">Email</td><td style="padding:8px 0;border-bottom:1px solid #eceef6;">${helpers.escapeHtml(entry.email)}</td></tr>
               <tr><td style="padding:8px 0;border-bottom:1px solid #eceef6;color:#767c94;">Phone</td><td style="padding:8px 0;border-bottom:1px solid #eceef6;">${helpers.escapeHtml(entry.phone || '—')}</td></tr>
               <tr><td style="padding:8px 0;border-bottom:1px solid #eceef6;color:#767c94;">Subject</td><td style="padding:8px 0;border-bottom:1px solid #eceef6;">${helpers.escapeHtml(entry.subject || '—')}</td></tr>
               <tr><td style="padding:8px 0;color:#767c94;vertical-align:top;">Message</td><td style="padding:8px 0;">${helpers.escapeHtml(entry.message).replace(/\n/g, '<br>')}</td></tr>
             </table>`,
      ctaText: 'Open in admin panel',
      ctaUrl: `${config.app.url}${helpers.url('/admin/contacts')}`,
    }),
    text: `New enquiry from ${entry.name} <${entry.email}>: ${entry.message}`,
  });
}

/**
 * Tell the team a new order came in.
 *
 * Goes to the contact address plus every active staff account - admin, manager
 * and editor. Relying on the contact address alone means an order sits unseen
 * whenever that mailbox is not the one somebody checks.
 *
 * Recipients are de-duplicated, because the contact address is often also a
 * staff account and nobody wants two copies.
 */
async function sendAdminNewOrder(order, customer) {
  if (!settings.getBool('notify_admin_new_order', true)) return { ok: false, skipped: true };

  const recipients = new Set();

  const contactEmail = String(settings.get('contact_email', '') || '').trim();
  if (contactEmail) recipients.add(contactEmail);

  try {
    // Lazy require: the user model pulls in the database pool, and mail is
    // imported by things that must still load when the database is down.
    const userModel = require('../models/user.model');
    const staff = await userModel.listStaff({ perPage: 100, status: 'active' });

    for (const member of staff.rows || []) {
      const email = String(member.email || '').trim();
      if (email) recipients.add(email);
    }
  } catch (err) {
    // A staff lookup failure must not cost us the notification entirely - the
    // contact address is still a valid recipient.
    logger.warn('Could not list staff for the new-order notification', err);
  }

  if (!recipients.size) return { ok: false, skipped: true };

  const rows = [
    ['Order', order.order_number, true],
    ['Customer', `${customer.name} <${customer.email}>`],
    ['Package', order.service_title],
    order.billing_cycle && order.billing_cycle !== 'one_time'
      ? ['Billing', `${order.term_months || 1} months, ${order.billing_cycle}`]
      : null,
    order.domain_name ? ['Domain', order.domain_name] : null,
    ['Total', helpers.money(order.total, settings.get('currency_symbol')), true],
    ['Payment', String(order.payment_status || 'unpaid').replace(/_/g, ' ')],
  ].filter(Boolean);

  const detailTable = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
    ${rows
      .map(
        ([label, value, strong]) =>
          `<tr>
             <td style="padding:10px 0;border-bottom:1px solid #eceef6;color:#767c94;width:120px;vertical-align:top;">${helpers.escapeHtml(label)}</td>
             <td style="padding:10px 0;border-bottom:1px solid #eceef6;${strong ? 'font-weight:700;' : ''}">${helpers.escapeHtml(String(value))}</td>
           </tr>`
      )
      .join('')}
  </table>`;

  return send({
    to: [...recipients].join(', '),
    subject: `New order ${order.order_number} — ${order.service_title}`,
    replyTo: customer.email,
    html: wrapLayout({
      title: 'A new order just came in',
      preheader: `${order.order_number} from ${customer.name} — ${helpers.money(order.total, settings.get('currency_symbol'))}`,
      body: `<p style="margin:0 0 18px;">A new order has been placed and is waiting for review.</p>${detailTable}`,
      ctaText: 'Open the order',
      ctaUrl: `${config.app.url}${helpers.url(`/admin/orders/${order.id}`)}`,
      footerNote: 'Replying to this email goes straight to the customer.',
    }),
    text: `New order ${order.order_number} from ${customer.name} <${customer.email}>. Total ${order.total}.`,
  });
}

module.exports = {
  send,
  verify,
  resetTransport,
  wrapLayout,
  sendTest,
  sendWelcome,
  sendPasswordReset,
  sendEmailVerification,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendPaymentReceived,
  sendPaymentRejected,
  sendTicketReply,
  sendContactAcknowledgement,
  sendContactNotification,
  sendAdminNewOrder,
};
