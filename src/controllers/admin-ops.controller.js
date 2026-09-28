/**
 * Admin operations screens.
 *
 * These are the records the business runs on - what has been invoiced, what
 * recurs, what customers are asking, what came in through the contact form, and
 * what staff have been doing. They are mostly read-only lists with a small
 * number of deliberate actions, so unlike the CMS screens they each get their
 * own handler rather than being generated from a registry.
 */
'use strict';

const orderModel = require('../models/order.model');
const userModel = require('../models/user.model');
const activity = require('../services/activity.service');
const mail = require('../services/mail.service');
const chatService = require('../services/chat.service');
const adminCtrl = require('./admin.controller');
const { clean } = require('../utils/validators');
const { fromQuery } = require('../utils/paginator');
const logger = require('../utils/logger');

const PER_PAGE = 20;

/** Common locals every admin screen needs. */
async function chrome(res, navKey) {
  res.locals.navActive = navKey;
  res.locals.badges = await adminCtrl.badgeCounts();
}

// ===========================================================================
// Invoices
// ===========================================================================

exports.invoices = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, PER_PAGE);

    const [result, counts] = await Promise.all([
      orderModel.listInvoices({
        page,
        perPage,
        search: clean.str(req.query.q || '', 120),
        status: clean.str(req.query.status, 20),
      }),
      orderModel.invoiceCounts(),
    ]);

    await chrome(res, 'invoices');

    res.render('admin/invoices', {
      layout: 'layouts/admin',
      pageTitle: 'Invoices',
      pageSubtitle: 'Everything billed to customers.',
      invoices: result.rows,
      pager: result,
      counts,
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Invoices', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.invoiceDetail = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const invoice = await orderModel.findInvoiceById(id);

    if (!invoice) {
      req.session.flashError = 'Invoice not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/invoices`));
    }

    const [items, customer, order] = await Promise.all([
      orderModel.invoiceItems(id),
      userModel.findCustomerById(invoice.customer_id),
      invoice.order_id ? orderModel.findOrderById(invoice.order_id) : null,
    ]);

    await chrome(res, 'invoices');

    res.render('admin/invoice-detail', {
      layout: 'layouts/admin',
      pageTitle: invoice.invoice_number,
      pageSubtitle: 'Invoice detail',
      invoice,
      items,
      customer,
      order,
      seo: { ...res.locals.seo, title: invoice.invoice_number, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const invoice = await orderModel.findInvoiceById(id);
    if (!invoice) {
      req.session.flashError = 'Invoice not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/invoices`));
    }

    const status = clean.str(req.body.status, 20);
    const allowed = ['draft', 'unpaid', 'paid', 'void', 'refunded'];
    if (!allowed.includes(status)) {
      req.session.flashError = 'That invoice status is not valid.';
      return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/invoices/${id}`));
    }

    const patch = { status };
    // Stamp the payment time only on the transition into paid.
    if (status === 'paid' && invoice.status !== 'paid') patch.paid_at = new Date();
    if (status !== 'paid') patch.paid_at = null;

    if (req.body.due_date) {
      const due = clean.str(req.body.due_date, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(due)) patch.due_date = due;
    }

    await orderModel.updateInvoice(id, patch);

    await activity.log({
      req,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      description: `Invoice ${invoice.invoice_number} set to ${status}.`,
    });

    req.session.flashSuccess = `Invoice ${invoice.invoice_number} updated.`;
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/invoices/${id}`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Subscriptions
// ===========================================================================

exports.subscriptions = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, PER_PAGE);

    const [result, counts, due] = await Promise.all([
      orderModel.listSubscriptions({
        page,
        perPage,
        search: clean.str(req.query.q || '', 120),
        status: clean.str(req.query.status, 20),
      }),
      orderModel.subscriptionCounts(),
      orderModel.dueSubscriptions(30),
    ]);

    await chrome(res, 'subscriptions');

    res.render('admin/subscriptions', {
      layout: 'layouts/admin',
      pageTitle: 'Subscriptions',
      pageSubtitle: 'Recurring care plans and retainers.',
      subscriptions: result.rows,
      pager: result,
      counts,
      dueSoon: due,
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Subscriptions', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateSubscription = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const subscription = await orderModel.findSubscriptionById(id);
    if (!subscription) {
      req.session.flashError = 'Subscription not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/subscriptions`));
    }

    const action = clean.str(req.body.action, 20);
    let patch = null;

    if (action === 'advance') {
      // Roll the billing date forward by one cycle.
      await orderModel.advanceSubscription(id);
      req.session.flashSuccess = `${subscription.plan_name} advanced to the next billing date.`;
    } else if (action === 'cancel') {
      patch = { status: 'cancelled', cancelled_at: new Date() };
    } else if (action === 'pause') {
      patch = { status: 'past_due' };
    } else if (action === 'resume') {
      patch = { status: 'active', cancelled_at: null };
    } else {
      req.session.flashError = 'Unknown subscription action.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/subscriptions`));
    }

    if (patch) {
      await orderModel.updateSubscription(id, patch);
      await activity.log({
        req,
        action: 'subscription.updated',
        entityType: 'subscription',
        entityId: id,
        description: `Subscription "${subscription.plan_name}" set to ${patch.status}.`,
      });
      req.session.flashSuccess = `${subscription.plan_name} is now ${patch.status}.`;
    }

    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/subscriptions`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Support tickets
// ===========================================================================

exports.tickets = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, PER_PAGE);

    const [result, counts] = await Promise.all([
      orderModel.listTickets({
        page,
        perPage,
        search: clean.str(req.query.q || '', 120),
        status: clean.str(req.query.status, 20),
        priority: clean.str(req.query.priority, 20),
        department: clean.str(req.query.department, 20),
      }),
      orderModel.ticketCounts(),
    ]);

    await chrome(res, 'tickets');

    res.render('admin/tickets', {
      layout: 'layouts/admin',
      pageTitle: 'Support tickets',
      pageSubtitle: 'Customer questions and issues.',
      tickets: result.rows,
      pager: result,
      counts,
      activeStatus: clean.str(req.query.status, 20),
      activePriority: clean.str(req.query.priority, 20),
      activeDepartment: clean.str(req.query.department, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Support tickets', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.ticketDetail = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ticket = await orderModel.findTicketById(id);

    if (!ticket) {
      req.session.flashError = 'Ticket not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets`));
    }

    const [replies, customer, order, staff] = await Promise.all([
      orderModel.ticketReplies(id),
      userModel.findCustomerById(ticket.customer_id),
      ticket.order_id ? orderModel.findOrderById(ticket.order_id) : null,
      userModel.listStaff({ page: 1, perPage: 100 }),
    ]);

    await chrome(res, 'tickets');

    res.render('admin/ticket-detail', {
      layout: 'layouts/admin',
      pageTitle: ticket.subject,
      pageSubtitle: `${ticket.ticket_number} · opened ${res.locals.helpers.timeAgo(ticket.created_at)}`,
      ticket,
      replies,
      customer,
      order,
      staff: staff.rows,
      seo: { ...res.locals.seo, title: ticket.ticket_number, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

/** Post a staff reply, email the customer, and move the ticket to `answered`. */
exports.replyTicket = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ticket = await orderModel.findTicketById(id);

    if (!ticket) {
      req.session.flashError = 'Ticket not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets`));
    }

    const message = clean.text(req.body.message, 20000);
    if (!message) {
      req.session.flashError = 'Write a reply before sending.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets/${id}`));
    }

    const staff = req.session.staff;
    const attachment = req.files && req.files.length ? req.files[0] : null;

    const replyId = await orderModel.createTicketReply({
      ticket_id: id,
      author_type: 'staff',
      author_id: staff.id,
      author_name: staff.name,
      message,
      attachment: attachment ? `/uploads/tickets/${attachment.filename}` : null,
    });

    // Replying moves the ticket to `answered` unless it was explicitly closed.
    const patch = { last_reply_at: new Date() };
    if (ticket.status !== 'closed') patch.status = 'answered';
    await orderModel.updateTicket(id, patch);

    await activity.log({
      req,
      action: 'ticket.replied',
      entityType: 'ticket',
      entityId: id,
      description: `Replied to ticket ${ticket.ticket_number}.`,
    });

    const customer = await userModel.findCustomerById(ticket.customer_id);
    mail
      .sendTicketReply(customer, ticket, { message })
      .catch((err) => logger.warn('Ticket reply email failed', err));

    req.session.flashSuccess = `Reply sent to ${customer ? customer.name : 'the customer'}.`;
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets/${id}`));
  } catch (err) {
    next(err);
  }
};

exports.updateTicket = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ticket = await orderModel.findTicketById(id);
    if (!ticket) {
      req.session.flashError = 'Ticket not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets`));
    }

    const patch = {};

    const status = clean.str(req.body.status, 20);
    if (['open', 'pending', 'answered', 'closed'].includes(status)) patch.status = status;

    const priority = clean.str(req.body.priority, 20);
    if (['low', 'medium', 'high', 'urgent'].includes(priority)) patch.priority = priority;

    const department = clean.str(req.body.department, 20);
    if (['general', 'billing', 'technical', 'sales'].includes(department)) patch.department = department;

    if (req.body.assigned_to !== undefined) {
      const assigned = clean.int(req.body.assigned_to, { min: 0, fallback: 0 });
      patch.assigned_to = assigned > 0 ? assigned : null;
    }

    if (!Object.keys(patch).length) {
      req.session.flashError = 'Nothing to update.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets/${id}`));
    }

    await orderModel.updateTicket(id, patch);

    await activity.log({
      req,
      action: 'ticket.updated',
      entityType: 'ticket',
      entityId: id,
      description: `Ticket ${ticket.ticket_number} updated: ${Object.keys(patch).join(', ')}.`,
    });

    req.session.flashSuccess = 'Ticket updated.';
    return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/tickets/${id}`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Contact messages
// ===========================================================================

exports.contacts = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, PER_PAGE);

    const result = await orderModel.listContactMessages({
      page,
      perPage,
      search: clean.str(req.query.q || '', 120),
      status: clean.str(req.query.status, 20),
    });

    await chrome(res, 'contacts');

    res.render('admin/contacts', {
      layout: 'layouts/admin',
      pageTitle: 'Contact messages',
      pageSubtitle: 'Enquiries submitted through the website forms.',
      messages: result.rows,
      pager: result,
      activeStatus: clean.str(req.query.status, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Contact messages', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateContact = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const message = await orderModel.findContactMessageById(id);
    if (!message) {
      req.session.flashError = 'Message not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/contacts`));
    }

    const action = clean.str(req.body.action, 20);

    if (action === 'delete') {
      await orderModel.deleteContactMessage(id);
      await activity.log({
        req,
        action: 'contact.deleted',
        entityType: 'contact_message',
        entityId: id,
        description: `Deleted the enquiry from ${message.email}.`,
      });
      req.session.flashSuccess = 'Message deleted.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/contacts`));
    }

    const status = clean.str(req.body.status, 20);
    if (!['new', 'read', 'replied', 'archived'].includes(status)) {
      req.session.flashError = 'That status is not valid.';
      return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/contacts`));
    }

    await orderModel.updateContactMessage(id, { status });

    req.session.flashSuccess = `Marked as ${status}.`;
    return res.redirect(req.get('referer') || res.locals.helpers.url(`${res.locals.adminPath}/contacts`));
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Activity log
// ===========================================================================

exports.activity = async (req, res, next) => {
  try {
    const { page, perPage } = fromQuery(req.query, 30);

    const result = await activity.paginate({
      page,
      perPage,
      actorType: clean.str(req.query.actor, 20),
      search: clean.str(req.query.q || '', 120),
    });

    await chrome(res, 'activity');

    res.render('admin/activity', {
      layout: 'layouts/admin',
      pageTitle: 'Activity log',
      pageSubtitle: 'A record of what staff and the system have done.',
      entries: result.rows,
      pager: result,
      activeActor: clean.str(req.query.actor, 20),
      search: clean.str(req.query.q || '', 120),
      seo: { ...res.locals.seo, title: 'Activity log', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

// ===========================================================================
// Live chat
//
// The widget is a stateless API endpoint, so nothing in the panel has ever
// shown what visitors actually asked. These four actions are read-mostly on
// purpose: a transcript is a record of what a customer was told, and editing it
// would destroy the only evidence if they later dispute the answer.
// ===========================================================================

exports.chatConversations = async (req, res, next) => {
  try {
    const status = clean.str(req.query.status, 20);
    const filter = status === 'open' || status === 'closed' ? status : null;

    const [conversations, stats] = await Promise.all([
      chatService.listConversations({ limit: 200, status: filter }),
      chatService.counts(),
    ]);

    await chrome(res, 'chat');

    res.render('admin/chat', {
      layout: 'layouts/admin',
      pageTitle: 'Live chat',
      pageSubtitle: 'Every conversation the website assistant has had with a visitor.',
      conversations,
      stats,
      activeStatus: status,
      // Surfaced so the empty state can explain WHY there is nothing here: no
      // key, or the widget switched off, are different problems with different
      // fixes, and an empty list on its own says neither.
      chatConfigured: chatService.isConfigured(),
      chatEnabled: chatService.isEnabled(),
      seo: { ...res.locals.seo, title: 'Live chat', robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.chatConversation = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const detail = await chatService.getConversation(id);

    if (!detail) {
      req.session.flashError = 'Conversation not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/chat`));
    }

    await chrome(res, 'chat');

    res.render('admin/chat-conversation', {
      layout: 'layouts/admin',
      pageTitle: `Conversation #${detail.conversation.id}`,
      pageSubtitle: detail.conversation.page_url || 'Started from the website widget.',
      conversation: detail.conversation,
      messages: detail.messages,
      seo: { ...res.locals.seo, title: `Conversation #${id}`, robots: 'noindex,nofollow' },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateChatConversation = async (req, res, next) => {
  const id = Number(req.params.id);

  try {
    const detail = await chatService.getConversation(id);
    if (!detail) {
      req.session.flashError = 'Conversation not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/chat`));
    }

    const status = await chatService.setStatus(id, clean.str(req.body.status, 20));

    await activity.log({
      req,
      actorType: 'staff',
      actorId: req.session.staff.id,
      actorName: req.session.staff.name,
      action: 'chat.status',
      entityType: 'chat_conversation',
      entityId: id,
      description: `Conversation #${id} marked ${status}.`,
    });

    req.session.flashSuccess = status === 'closed'
      ? `Conversation #${id} closed.`
      : `Conversation #${id} reopened.`;
  } catch (err) {
    req.session.flashError = 'That conversation could not be updated.';
    logger.error('Could not update a chat conversation', err);
  }

  return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/chat/${id}`));
};

exports.deleteChatConversation = async (req, res, next) => {
  const id = Number(req.params.id);

  try {
    const detail = await chatService.getConversation(id);
    if (!detail) {
      req.session.flashError = 'Conversation not found.';
      return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/chat`));
    }

    await chatService.deleteConversation(id);

    await activity.log({
      req,
      actorType: 'staff',
      actorId: req.session.staff.id,
      actorName: req.session.staff.name,
      action: 'chat.deleted',
      entityType: 'chat_conversation',
      entityId: id,
      description: `Conversation #${id} deleted (${detail.messages.length} message(s)).`,
    });

    req.session.flashSuccess = `Conversation #${id} deleted.`;
  } catch (err) {
    req.session.flashError = 'That conversation could not be deleted.';
    logger.error('Could not delete a chat conversation', err);
  }

  return res.redirect(res.locals.helpers.url(`${res.locals.adminPath}/chat`));
};

module.exports = exports;
