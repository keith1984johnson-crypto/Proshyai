const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const { CREDIT_GRANTS, CREDIT_PACKS } = require('../config');

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/**
 * Stripe price id per plan. Each plan is a different price in Stripe, so
 * they need separate ids — a single STRIPE_PRICE_ID would charge everyone
 * the same amount regardless of which plan they picked.
 *
 * STRIPE_PRICE_ID is still honoured as a fallback so an existing
 * single-price setup keeps working.
 */
function priceIdFor(plan) {
  const perPlan = {
    weekly: process.env.STRIPE_PRICE_WEEKLY,
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly: process.env.STRIPE_PRICE_YEARLY
  };
  if (perPlan[plan]) return perPlan[plan];

  // One-off packs use their own prices, e.g. STRIPE_PRICE_STARTER.
  if (CREDIT_PACKS[plan]) {
    return process.env[`STRIPE_PRICE_${plan.toUpperCase()}`] || null;
  }

  return process.env.STRIPE_PRICE_ID || null;
}

/** Add credits to an account and return the new balance. */
function grantCredits(userId, amount) {
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
  const row = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  return row ? row.credits : null;
}

/** True the first time an event id is seen; false on Stripe's retries. */
function claimEvent(eventId, eventType) {
  if (!eventId) return true; // synthetic/test events without an id
  const seen = db.prepare('SELECT id FROM processed_stripe_events WHERE id = ?').get(eventId);
  if (seen) return false;
  db.prepare('INSERT INTO processed_stripe_events (id, type, processed_at) VALUES (?, ?, ?)')
    .run(eventId, eventType, new Date().toISOString());
  return true;
}

function userByCustomerId(customerId) {
  return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId);
}

/**
 * Apply one Stripe event to the database.
 *
 * Exported separately from the HTTP handler so it can be tested directly
 * with fabricated events — signature verification is an HTTP concern, the
 * business logic is not.
 *
 * Returns a short description of what happened, for logging and tests.
 */
function applyStripeEvent(event) {
  const type = event && event.type;
  const object = event && event.data && event.data.object;
  if (!type || !object) return { applied: false, reason: 'malformed event' };

  switch (type) {
    // Subscription created. Record the plan and subscription, but do NOT
    // grant credits here: invoice.paid fires for the first period too, and
    // granting in both places would double-credit every new subscriber.
    case 'checkout.session.completed': {
      const meta = object.metadata || {};
      const user = userByCustomerId(object.customer);
      if (!user) return { applied: false, reason: 'unknown customer' };

      // A one-off pack has no invoice cycle, so this event IS the payment.
      const pack = meta.pack && CREDIT_PACKS[meta.pack] ? meta.pack : null;
      if (pack) {
        if (!claimEvent(event.id, type)) {
          return { applied: false, reason: 'duplicate event' };
        }
        const credits = CREDIT_PACKS[pack].credits;
        const balance = grantCredits(user.id, credits);
        return { applied: true, action: 'pack-purchased', userId: user.id, pack, credits, balance };
      }

      const plan = meta.plan || null;

      db.prepare(
        'UPDATE users SET stripe_subscription_id = ?, subscription_status = ?, plan = COALESCE(?, plan) WHERE id = ?'
      ).run(object.subscription, 'active', plan, user.id);

      return { applied: true, action: 'subscription-started', userId: user.id, plan };
    }

    // Money actually arrived — this is the only place credits are granted,
    // and it repeats every billing cycle, which is what makes the plans
    // "top up automatically".
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const user = userByCustomerId(object.customer);
      if (!user) return { applied: false, reason: 'unknown customer' };

      if (!claimEvent(event.id, type)) {
        return { applied: false, reason: 'duplicate event' };
      }

      const plan = user.plan && CREDIT_GRANTS[user.plan] ? user.plan : null;
      if (!plan) return { applied: false, reason: 'no known plan on account' };

      const credits = CREDIT_GRANTS[plan];
      const balance = grantCredits(user.id, credits);
      db.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').run('active', user.id);

      return { applied: true, action: 'credits-granted', userId: user.id, plan, credits, balance };
    }

    case 'invoice.payment_failed': {
      const user = userByCustomerId(object.customer);
      if (!user) return { applied: false, reason: 'unknown customer' };
      db.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').run('past_due', user.id);
      return { applied: true, action: 'marked-past-due', userId: user.id };
    }

    case 'customer.subscription.updated': {
      const user = userByCustomerId(object.customer);
      if (!user) return { applied: false, reason: 'unknown customer' };
      db.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').run(object.status, user.id);
      return { applied: true, action: 'status-updated', userId: user.id, status: object.status };
    }

    case 'customer.subscription.deleted': {
      const user = userByCustomerId(object.customer);
      if (!user) return { applied: false, reason: 'unknown customer' };
      db.prepare("UPDATE users SET subscription_status = 'canceled', plan = 'none' WHERE id = ?").run(user.id);
      return { applied: true, action: 'canceled', userId: user.id };
    }

    default:
      return { applied: false, reason: `ignored event type ${type}` };
  }
}

// POST /api/billing/create-checkout-session  { plan }
router.post('/create-checkout-session', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet (missing STRIPE_SECRET_KEY).' });

  const plan = String((req.body && req.body.plan) || '').toLowerCase();
  const isPack = Boolean(CREDIT_PACKS[plan]);

  if (!isPack && !CREDIT_GRANTS[plan]) {
    return res.status(400).json({
      error: `Unknown plan "${plan}". Choose ${Object.keys(CREDIT_GRANTS).join(', ')} or ${Object.keys(CREDIT_PACKS).join(', ')}.`
    });
  }

  const price = priceIdFor(plan);
  if (!price) {
    return res.status(503).json({
      error: `Billing is not configured for the ${plan} plan (missing STRIPE_PRICE_${plan.toUpperCase()}).`
    });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
    }

    // Record the chosen plan immediately: invoice.paid can arrive before
    // checkout.session.completed, and the grant depends on knowing the plan.
    // A one-off pack is not a plan, so it must not overwrite one.
    if (!isPack) {
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: isPack ? 'payment' : 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      metadata: isPack ? { userId: user.id, pack: plan } : { userId: user.id, plan },
      ...(isPack ? {} : { subscription_data: { metadata: { userId: user.id, plan } } }),
      success_url: `${req.protocol}://${req.get('host')}/?checkout=success`,
      cancel_url: `${req.protocol}://${req.get('host')}/?checkout=canceled`
    });

    res.json({ url: session.url, plan, credits: isPack ? CREDIT_PACKS[plan].credits : CREDIT_GRANTS[plan] });
  } catch (err) {
    console.error('[billing] checkout failed:', err.message);
    res.status(502).json({ error: 'Could not start checkout. Try again shortly.' });
  }
});

// GET /api/billing/status — subscription state for the logged-in user
router.get('/status', (req, res) => {
  if (!req.user) return res.json({ subscriptionStatus: 'none', plan: 'none' });

  const user = db.prepare('SELECT subscription_status, plan, credits FROM users WHERE id = ?').get(req.user.id);
  res.json({
    subscriptionStatus: (user && user.subscription_status) || 'none',
    plan: (user && user.plan) || 'none',
    credits: user ? user.credits : 0,
    creditsPerCycle: user && CREDIT_GRANTS[user.plan] ? CREDIT_GRANTS[user.plan] : null
  });
});

// POST /api/billing/webhook — raw body, wired up before express.json() in server.js
async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[billing] webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const result = applyStripeEvent(event);
    if (result.applied) {
      console.log(`[billing] ${event.type}: ${JSON.stringify(result)}`);
    }
    res.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry, which is what we want for a transient failure.
    console.error('[billing] failed to apply event:', err.message);
    res.status(500).send('Failed to apply event');
  }
}

module.exports = { router, stripeWebhookHandler, applyStripeEvent, grantCredits, priceIdFor };
