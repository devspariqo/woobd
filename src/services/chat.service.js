/**
 * Live chat assistant.
 *
 * Talks to an OpenAI-compatible /chat/completions endpoint. Conversation
 * history lives in the database keyed by a session token, so the widget keeps
 * context across page loads and the admin panel can read back transcripts.
 */
'use strict';

const crypto = require('crypto');

const config = require('../config');
const db = require('../config/database');
const settings = require('../services/settings.service');
const logger = require('../utils/logger');

/** Runtime credentials: the admin panel wins, the environment is the fallback. */
function credentials() {
  return {
    apiKey: settings.secret('chat_api_key', config.chat.apiKey),
    baseUrl: settings.get('chat_base_url') || config.chat.baseUrl,
    model: settings.get('chat_model') || config.chat.model,
  };
}

function isConfigured() {
  const { apiKey } = credentials();
  return Boolean(apiKey && apiKey.trim() && apiKey !== 'CHANGE_ME');
}

function isEnabled() {
  return settings.getBool('chat_enabled', true) && isConfigured();
}

/** Get or create the conversation row for this browser. */
async function ensureConversation({ sessionToken, customerId, visitorIp, pageUrl }) {
  let token = sessionToken;
  if (!token || !/^[a-f0-9]{32,64}$/i.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
  }

  const existing = await db.queryOne('SELECT * FROM chat_conversations WHERE session_token = ? LIMIT 1', [token]);

  if (existing) {
    // Attach a customer id once they sign in mid-conversation.
    if (customerId && !existing.customer_id) {
      await db.query('UPDATE chat_conversations SET customer_id = ? WHERE id = ?', [customerId, existing.id]);
      existing.customer_id = customerId;
    }
    if (pageUrl && pageUrl !== existing.page_url) {
      await db.query('UPDATE chat_conversations SET page_url = ? WHERE id = ?', [pageUrl, existing.id]);
    }
    return existing;
  }

  const id = await db.insert('chat_conversations', {
    session_token: token,
    customer_id: customerId || null,
    visitor_ip: visitorIp || null,
    page_url: pageUrl || null,
  });

  return db.queryOne('SELECT * FROM chat_conversations WHERE id = ?', [id]);
}

async function history(conversationId, limit) {
  const rows = await db.query(
    `SELECT role, content FROM chat_messages
     WHERE conversation_id = ? AND role IN ('user','assistant')
     ORDER BY id DESC LIMIT ?`,
    [conversationId, limit]
  );
  // Query is newest-first for the LIMIT, but the model needs oldest-first.
  return rows.reverse();
}

async function appendMessage(conversationId, role, content) {
  await db.insert('chat_messages', { conversation_id: conversationId, role, content });
  await db.query('UPDATE chat_conversations SET message_count = message_count + 1 WHERE id = ?', [conversationId]);
}

/**
 * Ask the model. Returns { ok, reply, error }.
 *
 * History is trimmed before sending so a long conversation cannot grow the
 * request without bound and start costing real money per message.
 */
async function ask({ conversationId, message, customerName }) {
  const { apiKey, baseUrl, model } = credentials();

  if (!apiKey) {
    return {
      ok: false,
      error: 'The assistant is not configured yet. Please reach us on WhatsApp in the meantime.',
    };
  }

  const maxHistory = settings.getInt('chat_max_history', 10) || 10;
  const priorMessages = await history(conversationId, maxHistory);

  let systemPrompt = settings.get('chat_system_prompt') || '';

  // Give the model live facts so it does not invent prices or opening hours.
  const facts = [
    `Current packages and prices are listed at ${config.app.url}/services - never quote a price that is not on that page.`,
    `Office: ${settings.get('office_address')}. Hours: ${settings.get('office_hours')}.`,
    `Contact: WhatsApp ${settings.get('whatsapp_number')}, email ${settings.get('contact_email')}.`,
    `Accepted payments: bKash, Nagad, Rocket and card. Payment is verified within 24 hours.`,
  ].join('\n');

  systemPrompt = `${systemPrompt}\n\nFacts you may rely on:\n${facts}`;
  if (customerName) {
    systemPrompt += `\nThe visitor is a signed-in customer named ${customerName}.`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...priorMessages,
    { role: 'user', content: message },
  ];

  const controller = new AbortController();
  // Assistant replies stream to a human waiting on a widget - fail fast.
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();

    if (!response.ok) {
      logger.error('Chat API returned an error', { status: response.status, body: raw.slice(0, 500) });
      return {
        ok: false,
        error:
          response.status === 401
            ? 'The assistant is temporarily unavailable. Please contact us on WhatsApp.'
            : 'I could not reach the assistant just now. Please try again in a moment.',
      };
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      logger.error('Chat API returned non-JSON', { body: raw.slice(0, 300) });
      return { ok: false, error: 'The assistant sent an unreadable reply. Please try again.' };
    }

    const choice = payload.choices && payload.choices[0];
    let reply = choice && choice.message ? choice.message.content : '';

    // Some models wrap reasoning in  thinking tags; strip before showing.
    if (typeof reply === 'string') {
      reply = reply.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
    }

    if (!reply) {
      return { ok: false, error: 'The assistant sent an empty reply. Please try a different question.' };
    }

    return { ok: true, reply, usage: payload.usage || null };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, error: 'The assistant took too long to reply. Please try again.' };
    }
    logger.error('Chat request failed', err);
    return { ok: false, error: 'I could not reach the assistant. Please contact us on WhatsApp.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Admin transcript view. */
async function listConversations({ limit = 50, offset = 0, status = null } = {}) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE c.status = ?';
    params.push(status);
  }
  params.push(limit, offset);

  return db.query(
    `SELECT c.*, cu.name AS customer_name, cu.email AS customer_email
     FROM chat_conversations c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
}

async function getConversation(id) {
  const conversation = await db.queryOne(
    `SELECT c.*, cu.name AS customer_name, cu.email AS customer_email
     FROM chat_conversations c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = ? LIMIT 1`,
    [id]
  );
  if (!conversation) return null;
  const messages = await db.query(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC',
    [id]
  );
  return { conversation, messages };
}

module.exports = {
  isConfigured,
  isEnabled,
  credentials,
  ensureConversation,
  history,
  appendMessage,
  ask,
  listConversations,
  getConversation,
};
