/**
 * The payment methods this site can accept.
 *
 * One list, four consumers: the settings registry generates an editable field
 * set from it, the context middleware builds `res.locals.payments` from it, the
 * three public views iterate it, and the customer controller validates a
 * submitted method against it.
 *
 * Before this, every one of those carried its own hardcoded list of four
 * methods - so adding a fifth meant editing five files and remembering all of
 * them. The failure mode was silent in the worst place: a method switched on in
 * the panel but missing from the controller's allow-list is offered to the
 * customer and then rejected when they submit, which reads as the payment
 * system being broken.
 *
 * `kind` decides the shape:
 *   wallet  money is sent to a number. Fields: number, account type.
 *   manual  money is sent some other way and the customer records it. Field: note.
 *   gateway the customer is redirected to a payment provider. No receiving
 *           details at all - the credentials live in the service that talks to
 *           the provider, and are not per-method.
 *
 * `label` is both the display name and the value stored on the payment row, so
 * renaming one after payments exist would orphan the old rows. Add a method
 * rather than renaming one.
 */
'use strict';

const PAYMENT_METHODS = [
  // --- Mobile financial services -------------------------------------------
  {
    key: 'bkash',
    label: 'bKash',
    kind: 'wallet',
    channel: 'wallet',
    tone: 'danger',
    enabled: true,
    number: '01789668276',
    accountType: 'Personal',
    blurb: 'Bangladesh\u2019s largest mobile wallet, and what most shoppers reach for first.',
  },
  {
    key: 'nagad',
    label: 'Nagad',
    kind: 'wallet',
    channel: 'wallet',
    tone: 'warning',
    enabled: true,
    number: '01789668276',
    accountType: 'Personal',
    blurb: 'The postal service wallet. Widely used, and usually the cheapest to cash out.',
  },
  {
    key: 'rocket',
    label: 'Rocket',
    kind: 'wallet',
    channel: 'wallet',
    tone: 'info',
    enabled: true,
    number: '017896682761',
    accountType: 'Personal',
    blurb: 'Dutch-Bangla Bank\u2019s wallet. Common where bKash limits are a problem.',
  },
  {
    key: 'upay',
    label: 'Upay',
    kind: 'wallet',
    channel: 'wallet',
    tone: 'info',
    enabled: false,
    number: '',
    accountType: 'Personal',
    blurb: 'UCB\u2019s wallet. The fourth-largest by users, and worth offering if you take a lot of small orders.',
  },
  {
    key: 'tap',
    label: 'Tap\u2019Pay',
    kind: 'wallet',
    channel: 'wallet',
    tone: 'info',
    enabled: false,
    number: '',
    accountType: 'Personal',
    blurb: 'Trust Axiata\u2019s wallet. Growing quickly among younger customers.',
  },

  // --- Manual methods -------------------------------------------------------
  {
    key: 'bank',
    label: 'Bank transfer',
    kind: 'manual',
    channel: 'bank_transfer',
    tone: 'primary',
    enabled: false,
    note: 'Transfer the amount to our bank account using NPSB or BEFTN, then enter the reference number below. Ask us for the account details if you do not have them.',
    blurb: 'NPSB or BEFTN. No wallet limit, so this is how most large orders are paid.',
  },
  {
    key: 'cod',
    label: 'Cash on delivery',
    kind: 'manual',
    channel: 'cash_on_delivery',
    tone: 'primary',
    // On by default, and the only new method that is: it needs no account
    // details, so it works the moment it is switched on. The others are waiting
    // on a real receiving number or bank account, and inventing one would send
    // somebody's money to the wrong place.
    enabled: true,
    note: 'Pay the courier in cash when your order arrives. Available inside Bangladesh only, and some areas need a partial advance.',
    blurb: 'Pay the courier on arrival. The default choice for physical goods in Bangladesh.',
  },
  {
    key: 'card',
    label: 'Card',
    kind: 'manual',
    channel: 'card',
    tone: 'primary',
    enabled: true,
    note: 'Card payments are processed through our secure gateway. Share the last 4 digits of your card and the transaction reference so we can match it.',
    blurb: 'Visa, Mastercard and Amex through a gateway.',
  },

  // --- Hosted gateway -------------------------------------------------------
  {
    key: 'sslcommerz',
    label: 'Card / Mobile Banking',
    kind: 'gateway',
    channel: 'gateway',
    tone: 'primary',
    enabled: false,
    blurb: 'SSLCommerz: cards, bKash, Nagad, Rocket, Upay and net banking on their own secure pages. Confirms itself, so nothing needs verifying by hand.',
  },
];

/** Fast lookup by key. */
const BY_KEY = PAYMENT_METHODS.reduce((acc, method) => {
  acc[method.key] = method;
  return acc;
}, {});

/**
 * The setting keys a method owns.
 *
 * A wallet has a receiving number and an account type; a manual method has
 * instructions instead; a gateway has neither, because there is nowhere for the
 * customer to send anything. All three have a switch and a logo.
 */
function settingKeys(method) {
  const keys = [`payment_${method.key}_enabled`];

  if (method.kind === 'wallet') {
    keys.push(`payment_${method.key}_number`, `payment_${method.key}_type`);
  } else if (method.kind === 'manual') {
    keys.push(`payment_${method.key}_note`);
  }

  keys.push(`payment_${method.key}_logo`);
  return keys;
}

/** Every setting key any method owns. */
function allSettingKeys() {
  return PAYMENT_METHODS.flatMap(settingKeys);
}

module.exports = { PAYMENT_METHODS, BY_KEY, settingKeys, allSettingKeys };
