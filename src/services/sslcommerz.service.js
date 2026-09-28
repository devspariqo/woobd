/**
 * SSLCommerz — the hosted payment gateway.
 *
 * The flow is a redirect, not an API call that returns a verdict:
 *
 *   1. We POST the order to SSLCommerz and get back a GatewayPageURL.
 *   2. The customer is sent there and pays, on SSLCommerz's own pages. Card
 *      details never touch this server, which is the point of using a gateway.
 *   3. SSLCommerz sends the customer back to success_url with a `val_id`, and
 *      separately calls ipn_url.
 *
 * Step 3 is a claim, not proof. Anyone can type the success URL into a browser,
 * and the val_id in it is just a string until it has been checked. So the only
 * thing that marks an order paid is `validate()` - a server-to-server call to
 * SSLCommerz asking "is this transaction real, and for how much". Both the
 * browser redirect and the IPN go through it, and the unique index on
 * `payments.gateway_ref` makes a second confirmation of the same transaction a
 * no-op rather than a second credit.
 *
 * Sandbox and live are separate hosts with separate credentials. Mixing them is
 * the classic way to ship a broken checkout: sandbox credentials against the
 * live host are simply rejected, and live credentials against the sandbox take
 * money nowhere.
 */
'use strict';

const settings = require('./settings.service');
const logger = require('../utils/logger');

const SANDBOX = {
  api: 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php',
  validation: 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php',
};

const LIVE = {
  api: 'https://securepay.sslcommerz.com/gwprocess/v4/api.php',
  validation: 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php',
};

/** How long to wait on the gateway before giving up. */
const TIMEOUT_MS = 20000;

function isLive() {
  return settings.get('sslcommerz_mode') === 'live';
}

function endpoints() {
  return isLive() ? LIVE : SANDBOX;
}

function credentials() {
  return {
    storeId: String(settings.secret('sslcommerz_store_id', process.env.SSLCOMMERZ_STORE_ID) || '').trim(),
    storePassword: String(settings.secret('sslcommerz_store_password', process.env.SSLCOMMERZ_STORE_PASSWORD) || '').trim(),
  };
}

/**
 * Whether the gateway can be offered at checkout.
 *
 * Both halves of the credential pair are required. One without the other is a
 * checkout that sends the customer to SSLCommerz to be told the store does not
 * exist.
 */
function isConfigured() {
  const { storeId, storePassword } = credentials();
  return Boolean(storeId && storePassword);
}

function isEnabled() {
  return settings.getBool('payment_sslcommerz_enabled') && isConfigured();
}

/**
 * Ask SSLCommerz to open a payment session.
 *
 * @returns {Promise<{ok:boolean, gatewayUrl?:string, error?:string, raw?:object}>}
 */
async function initiate({ payment, order, customer, urls }) {
  const { storeId, storePassword } = credentials();

  if (!isConfigured()) {
    return { ok: false, error: 'SSLCommerz is not configured.' };
  }

  const body = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePassword,
    total_amount: Number(payment.amount).toFixed(2),
    currency: payment.currency || 'BDT',

    // Our own id for this attempt, and the key the callbacks are matched back
    // on. Never the gateway's - theirs does not exist until after this call.
    tran_id: payment.transaction_id,

    success_url: urls.success,
    fail_url: urls.fail,
    cancel_url: urls.cancel,
    ipn_url: urls.ipn,

    cus_name: customer.name || 'Customer',
    cus_email: customer.email || '',
    cus_add1: customer.address || 'N/A',
    cus_add2: '',
    cus_city: customer.city || 'Dhaka',
    cus_state: customer.city || 'Dhaka',
    cus_postcode: customer.postcode || '1000',
    cus_country: 'Bangladesh',
    cus_phone: customer.phone || 'N/A',
    cus_fax: '',

    ship_name: customer.name || 'Customer',
    ship_add1: customer.address || 'N/A',
    ship_add2: '',
    ship_city: customer.city || 'Dhaka',
    ship_state: customer.city || 'Dhaka',
    ship_postcode: customer.postcode || '1000',
    ship_country: 'Bangladesh',

    // Nothing is shipped - these are services - but SSLCommerz requires the
    // fields to be present.
    shipping_method: 'NO',
    num_of_item: '1',

    product_name: String(order.service_title || 'Order').slice(0, 250),
    product_category: 'Service',
    product_profile: 'general',
  });

  try {
    const res = await fetch(endpoints().api, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // SSLCommerz answers with HTML when the store credentials are wrong, so
      // a parse failure is a credential problem far more often than a network
      // one. Saying that is more useful than "Unexpected token <".
      logger.error('SSLCommerz sent a non-JSON response to initiate', { status: res.status, body: text.slice(0, 300) });
      return { ok: false, error: 'The payment gateway rejected the request. Check the store ID and password, and that the mode matches the credentials.', raw: { status: res.status } };
    }

    if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
      const reason = data.failedreason || data.status || 'unknown';
      logger.warn('SSLCommerz refused to open a session', { reason, tran_id: payment.transaction_id });
      return { ok: false, error: `The payment gateway refused the request (${reason}).`, raw: data };
    }

    return { ok: true, gatewayUrl: data.GatewayPageURL, raw: data };
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logger.error('Could not reach SSLCommerz', err);
    return {
      ok: false,
      error: timedOut ? 'The payment gateway did not respond in time. Please try again.' : 'Could not reach the payment gateway.',
    };
  }
}

/**
 * Ask SSLCommerz whether a transaction is real, and for how much.
 *
 * This is the only function that may mark a payment as settled. Everything the
 * customer's browser sends is treated as a hint about which transaction to
 * check, never as the answer.
 *
 * @returns {Promise<{ok:boolean, status?:string, amount?:number, data?:object, error?:string}>}
 */
async function validate(valId) {
  const { storeId, storePassword } = credentials();
  const id = String(valId || '').trim();

  if (!isConfigured()) return { ok: false, error: 'SSLCommerz is not configured.' };
  if (!id) return { ok: false, error: 'No transaction reference was supplied.' };

  const url = new URL(endpoints().validation);
  url.searchParams.set('val_id', id);
  url.searchParams.set('store_id', storeId);
  url.searchParams.set('store_passwd', storePassword);
  url.searchParams.set('format', 'json');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      logger.error('SSLCommerz sent a non-JSON response to validate', { status: res.status, body: text.slice(0, 300) });
      return { ok: false, error: 'The gateway sent an unreadable response.' };
    }

    // VALID and VALIDATED both mean the money is real. VALIDATED additionally
    // means it has already been settled into the merchant account, which is
    // true for some payment methods and not others - refusing one of the two
    // would reject perfectly good card payments.
    const status = String(data.status || '').toUpperCase();
    const settled = status === 'VALID' || status === 'VALIDATED';

    if (!settled) {
      logger.warn('SSLCommerz did not confirm a transaction', { val_id: id, status: data.status });
      return { ok: false, status, error: `The gateway did not confirm this payment (${data.status || 'no status'}).`, data };
    }

    return { ok: true, status, amount: Number(data.amount), data };
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logger.error('Could not reach the SSLCommerz validator', err);
    return {
      ok: false,
      error: timedOut ? 'The gateway did not confirm the payment in time.' : 'Could not reach the payment gateway to confirm the payment.',
    };
  }
}

module.exports = {
  isConfigured,
  isEnabled,
  isLive,
  credentials,
  endpoints,
  initiate,
  validate,
};
