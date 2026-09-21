const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, COOKIE_NAME } = require('../routes/auth');

// Attaches req.user (with live credit balance) if a valid session cookie is
// present. Never blocks the request — demo mode must stay open to everyone.
function identifyUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        credits: user.credits,
        plan: user.plan,
        subscriptionStatus: user.subscription_status
      };
    }
  } catch {
    // invalid/expired token — treat as logged out
  }
  next();
}

// Deducts `cost` credits from the logged-in user. Call this only after a
// real (non-demo) generation succeeds. Returns the new balance.
function deductCredits(userId, cost) {
  db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(cost, userId);
  const row = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  return row.credits;
}

module.exports = { identifyUser, deductCredits };
