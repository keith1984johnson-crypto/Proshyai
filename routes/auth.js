const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const COOKIE_NAME = 'shyshy_session';

function setSessionCookie(res, userId) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

// POST /api/auth/signup  { email, password }
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, email.toLowerCase(), passwordHash, new Date().toISOString());

  setSessionCookie(res, id);
  res.json({ id, email: email.toLowerCase(), subscriptionStatus: 'none' });
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  setSessionCookie(res, user.id);
  res.json({ id: user.id, email: user.email, subscriptionStatus: user.subscription_status });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/auth/me  — current logged-in user, or null
router.get('/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.json({ user: null });

  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, subscription_status FROM users WHERE id = ?').get(userId);
    if (!user) return res.json({ user: null });
    res.json({ user: { id: user.id, email: user.email, subscriptionStatus: user.subscription_status } });
  } catch {
    res.json({ user: null });
  }
});

module.exports = { router, JWT_SECRET, COOKIE_NAME };
