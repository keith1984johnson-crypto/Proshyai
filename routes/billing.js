const express = require('express');
const Stripe = require('stripe');
const db = require('../db');

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// POST /api/billing/create-checkout-session
// Logged-in user starts a subscription checkout.
router.post('/create-checkout-session', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet (missing STRIPE_SECRET_KEY).' });
  if (!process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: 'Billing is not configured yet (missing STRIPE_PRICE_ID).' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${req.protocol}://${req.get('host')}/?checkout=success`,
    cancel_url: `${req.protocol}://${req.get('host')}/?checkout=canceled`
  });

  res.json({ url: session.url });
});

// GET /api/billing/status — current subscription status for the logged-in user
router.get('/status', (req, res) => {
  if (!req.user) return res.json({ subscriptionStatus: 'none' });
  const user = db.prepare('SELECT subscription_status FROM users WHERE id = ?').get(req.user.id);
  res.json({ subscriptionStatus: user?.subscription_status || 'none' });
});

// POST /api/billing/webhook — Stripe calls this when subscription events happen.
// Must use the raw body for signature verification (wired up in server.js).
async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const updateByCustomerId = (customerId, status) => {
    db.prepare('UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?').run(status, customerId);
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      db.prepare('UPDATE users SET stripe_subscription_id = ?, subscription_status = ? WHERE stripe_customer_id = ?')
        .run(session.subscription, 'active', session.customer);
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const status = sub.status === 'active' ? 'active' : sub.status; // active | past_due | canceled | etc.
      updateByCustomerId(sub.customer, status);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      updateByCustomerId(sub.customer, 'canceled');
      break;
    }
    default:
      break; // ignore other event types
  }

  res.json({ received: true });
}

module.exports = { router, stripeWebhookHandler };
