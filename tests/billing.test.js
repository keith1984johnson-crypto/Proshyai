/**
 * Billing logic tests.
 *
 * Runs against a temporary SQLite file with no Stripe account and no network:
 * applyStripeEvent() is deliberately separate from signature verification so
 * the money-handling logic can be tested directly.
 *
 *   node tests/billing.test.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Point the database at a throwaway file before anything requires db.js.
const tmpDb = path.join(os.tmpdir(), `proshy-test-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;

const db = require('../db');
const { CREDIT_GRANTS } = require('../config');
const { applyStripeEvent } = require('../routes/billing');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

function makeUser({ id, customerId, plan = 'none', credits = 25 }) {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, created_at, credits, stripe_customer_id, plan, subscription_status)
     VALUES (?, ?, 'x', ?, ?, ?, ?, 'none')`
  ).run(id, `${id}@test.com`, new Date().toISOString(), credits, customerId, plan);
}

const creditsOf = (id) => db.prepare('SELECT credits FROM users WHERE id = ?').get(id).credits;
const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

console.log('\nbilling');

test('checkout.session.completed records the plan but grants no credits', () => {
  makeUser({ id: 'u1', customerId: 'cus_1', credits: 25 });
  const result = applyStripeEvent({
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { plan: 'monthly' } } }
  });

  assert.strictEqual(result.applied, true);
  assert.strictEqual(userRow('u1').plan, 'monthly');
  assert.strictEqual(userRow('u1').subscription_status, 'active');
  assert.strictEqual(userRow('u1').stripe_subscription_id, 'sub_1');
  assert.strictEqual(creditsOf('u1'), 25, 'credits must not be granted twice for one payment');
});

test('invoice.paid grants exactly the plan\'s credits', () => {
  const before = creditsOf('u1');
  const result = applyStripeEvent({
    id: 'evt_invoice_1',
    type: 'invoice.paid',
    data: { object: { customer: 'cus_1' } }
  });

  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.credits, CREDIT_GRANTS.monthly);
  assert.strictEqual(creditsOf('u1'), before + CREDIT_GRANTS.monthly);
});

test('a retried invoice.paid does not grant twice', () => {
  const before = creditsOf('u1');
  const result = applyStripeEvent({
    id: 'evt_invoice_1', // same id Stripe would resend
    type: 'invoice.paid',
    data: { object: { customer: 'cus_1' } }
  });

  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.reason, 'duplicate event');
  assert.strictEqual(creditsOf('u1'), before);
});

test('the next billing cycle grants again', () => {
  const before = creditsOf('u1');
  applyStripeEvent({
    id: 'evt_invoice_2',
    type: 'invoice.paid',
    data: { object: { customer: 'cus_1' } }
  });
  assert.strictEqual(creditsOf('u1'), before + CREDIT_GRANTS.monthly);
});

test('each plan grants its own amount', () => {
  makeUser({ id: 'u2', customerId: 'cus_2', plan: 'weekly', credits: 0 });
  applyStripeEvent({ id: 'evt_w', type: 'invoice.paid', data: { object: { customer: 'cus_2' } } });
  assert.strictEqual(creditsOf('u2'), CREDIT_GRANTS.weekly);

  makeUser({ id: 'u3', customerId: 'cus_3', plan: 'yearly', credits: 0 });
  applyStripeEvent({ id: 'evt_y', type: 'invoice.paid', data: { object: { customer: 'cus_3' } } });
  assert.strictEqual(creditsOf('u3'), CREDIT_GRANTS.yearly);
});

test('payment failure marks the account past_due without touching credits', () => {
  const before = creditsOf('u1');
  applyStripeEvent({ id: 'evt_fail', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
  assert.strictEqual(userRow('u1').subscription_status, 'past_due');
  assert.strictEqual(creditsOf('u1'), before);
});

test('cancellation clears the plan and keeps earned credits', () => {
  const before = creditsOf('u1');
  applyStripeEvent({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
  assert.strictEqual(userRow('u1').subscription_status, 'canceled');
  assert.strictEqual(userRow('u1').plan, 'none');
  assert.strictEqual(creditsOf('u1'), before, 'credits already paid for are not clawed back');
});

test('a cancelled account gets no credits from a later invoice', () => {
  const before = creditsOf('u1');
  const result = applyStripeEvent({ id: 'evt_after_cancel', type: 'invoice.paid', data: { object: { customer: 'cus_1' } } });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(creditsOf('u1'), before);
});

test('an unknown customer is ignored safely', () => {
  const result = applyStripeEvent({ id: 'evt_x', type: 'invoice.paid', data: { object: { customer: 'cus_nope' } } });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.reason, 'unknown customer');
});

test('a malformed event is ignored safely', () => {
  assert.strictEqual(applyStripeEvent({}).applied, false);
  assert.strictEqual(applyStripeEvent({ type: 'invoice.paid' }).applied, false);
});

console.log(`\n${passed} passed\n`);
try {
  fs.unlinkSync(tmpDb);
} catch {
  /* leave the temp file if it is locked */
}
