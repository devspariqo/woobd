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

/**
 * Every configured API key, in the order they should be tried.
 *
 * A single key is a single point of failure: one that runs out of credit or
 * gets rate-limited takes the assistant offline entirely, and the visitor just
 * sees a dead widget. The admin panel accepts a list (one per line), and the
 * environment variable is used as a fallback when the panel is empty.
 *
 * `settings.secret` decrypts stored values, so a list is stored encrypted like
 * any other credential.
 */
function apiKeys() {
  const split = (value) =>
    String(value || '')
      .split(/[\r\n,]+/)
      .map((key) => key.trim())
      .filter(Boolean);

  // Order matters: the list is the primary setting and is tried first, then the
  // older single-key field, then the environment. Prepending the single key
  // instead would make it win over the list, which contradicts its own label.
  const list = split(settings.secret('chat_api_keys', ''));
  const single = split(settings.secret('chat_api_key', ''));
  const fromEnv = split(config.chat.apiKey);

  const all = [...list, ...single, ...fromEnv];

  // De-duplicate while preserving order, and drop the placeholder so an
  // untouched .env.example does not look like a configured key.
  return [...new Set(all.filter((key) => key && key !== 'CHANGE_ME'))];
}

/** Runtime credentials: the admin panel wins, the environment is the fallback. */
function credentials() {
  return {
    apiKeys: apiKeys(),
    baseUrl: settings.get('chat_base_url') || config.chat.baseUrl,
    model: settings.get('chat_model') || config.chat.model,
  };
}

function isConfigured() {
  return credentials().apiKeys.length > 0;
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
 * One attempt against one key. Returns { ok, reply, error, retryable }.
 *
 * `retryable` marks the failures worth trying the next key for: an auth
 * rejection, a rate limit, or a server error. A malformed reply is not
 * retryable - the request reached a working endpoint, so another key would
 * behave the same way and the extra round trip only makes the visitor wait.
 */
async function attempt({ apiKey, baseUrl, model, messages, timeoutMs }) {
  const controller = new AbortController();
  // Assistant replies stream to a human waiting on a widget - fail fast.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
      logger.warn('Chat API returned an error', {
        status: response.status,
        // Never log the key itself - only enough to tell two keys apart.
        key: apiKey.slice(0, 6) + '…',
        body: raw.slice(0, 300),
      });

      // 401/403: the key is dead or out of credit. 429: rate limited. 5xx: their
      // problem. All worth trying the next key for.
      const retryable = [401, 402, 403, 429].includes(response.status) || response.status >= 500;

      return {
        ok: false,
        retryable,
        error:
          response.status === 401 || response.status === 403
            ? 'The assistant is temporarily unavailable. Please contact us on WhatsApp.'
            : 'I could not reach the assistant just now. Please try again in a moment.',
      };
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      logger.error('Chat API returned non-JSON', { body: raw.slice(0, 300) });
      return { ok: false, retryable: false, error: 'The assistant sent an unreadable reply. Please try again.' };
    }

    const choice = payload.choices && payload.choices[0];
    let reply = choice && choice.message ? choice.message.content : '';

    // Some models wrap reasoning in  thinking tags; strip before showing.
    if (typeof reply === 'string') {
      reply = reply.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
      reply = toPlainText(reply);
    }

    if (!reply) {
      return { ok: false, retryable: true, error: 'The assistant sent an empty reply. Please try a different question.' };
    }

    return { ok: true, reply, usage: payload.usage || null };
  } catch (err) {
    if (err.name === 'AbortError') {
      // A timeout may well be this particular key or route being slow, so the
      // next one is worth a try - but only within the caller's budget.
      return { ok: false, retryable: true, error: 'The assistant took too long to reply. Please try again.' };
    }

    logger.error('Chat request failed', err);
    return {
      ok: false,
      retryable: true,
      error: 'I could not reach the assistant. Please contact us on WhatsApp.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the model, falling back through the configured keys.
 *
 * Returns { ok, reply, error }.
 *
 * History is trimmed before sending so a long conversation cannot grow the
 * request without bound and start costing real money per message.
 */
async function ask({ conversationId, message, customerName }) {
  const { apiKeys: keys, baseUrl, model } = credentials();

  if (!keys.length) {
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

  // Split the waiting budget across the keys rather than giving each one the
  // full 25s - a visitor watching a typing indicator will not wait 75s.
  const totalBudgetMs = 25000;
  const perAttemptMs = Math.max(8000, Math.floor(totalBudgetMs / keys.length));

  let last = null;

  for (let i = 0; i < keys.length; i += 1) {
    const result = await attempt({
      apiKey: keys[i],
      baseUrl,
      model,
      messages,
      timeoutMs: perAttemptMs,
    });

    if (result.ok) {
      if (i > 0) {
        // Worth knowing: it means the earlier key is failing and should be
        // rotated. Without this the fallback is silent and you never find out.
        // `i` is 0-based, so the key that just answered is i + 1 and the one
        // that failed before it is i.
        logger.warn(
          `Chat: key #${i} failed, key #${i + 1} answered. Check the earlier key.`
        );
      }
      return result;
    }

    last = result;

    if (!result.retryable) return result;
    if (i < keys.length - 1) {
      logger.warn(`Chat: key #${i + 1} failed, trying the next of ${keys.length}.`);
    }
  }

  logger.error(`Chat: all ${keys.length} configured key(s) failed.`);
  return last || { ok: false, error: 'The assistant is unavailable right now.' };
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

/**
 * Turn a markdown reply into the plain text the chat bubble expects.
 *
 * The widget renders replies with `textContent`, so markdown arrives on screen
 * literally - a visitor reads "**Starter Package**" with the asterisks in it.
 * Rendering HTML instead would mean trusting model output inside the page, so
 * the formatting is removed and the words kept.
 *
 * Deliberately conservative: it only strips markers that would look like noise.
 * Anything that could be legitimate text is left alone.
 */
function toPlainText(input) {
  let text = String(input || '');

  // Fenced code blocks keep their contents but lose the fences.
  text = text.replace(/```[a-z0-9]*\n?/gi, '');

  // Inline code, bold and italic. Order matters: the doubled markers go first,
  // or `**bold**` would be left as `*bold*` by the italic pass.
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/(^|\W)__(.+?)__(?=\W|$)/g, '$1$2');
  text = text.replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1$2');
  text = text.replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1$2');
  text = text.replace(/`([^`]+)`/g, '$1');

  // Headings: drop the hashes, keep the heading text on its own line.
  text = text.replace(/^#{1,6}\s+(.*)$/gm, '$1');

  // Bullets become a real bullet character, which reads better than a hyphen
  // and cannot be mistaken for punctuation.
  text = text.replace(/^\s*[-*+]\s+/gm, '• ');

  // Block quotes.
  text = text.replace(/^\s*>\s?/gm, '');

  // Horizontal rules.
  text = text.replace(/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/gm, '');

  // Markdown links keep the label; the URL is rarely useful in a chat bubble.
  text = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');

  // Tidy the whitespace the removals leave behind.
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
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
