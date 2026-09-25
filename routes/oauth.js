const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const db = require('../db');
const { FREE_TRIAL_CREDITS } = require('../config');
const { JWT_SECRET, COOKIE_NAME } = require('./auth');

const router = express.Router();

// Sign in with Google (OAuth 2.0 authorization code flow).
//
// Credentials come from the environment and are never written down here.
// The callback URL is derived from APP_URL so the same build works on the
// Railway domain, proshyai.com, or anywhere else it is hosted later.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'proshy_oauth_state';

/** Only these three scopes: enough to identify the user, nothing more. */
const SCOPES = ['openid', 'email', 'profile'];

function appUrl() {
  return (process.env.APP_URL || 'https://proshyai.com').replace(/\/+$/, '');
}

/** The redirect URI registered with Google. */
function callbackUrl() {
  return process.env.GOOGLE_CALLBACK_URL || `${appUrl()}/api/auth/google/callback`;
}

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function setSessionCookie(res, userId) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

/** Where to send the browser back to, with a short status for the UI. */
function finish(res, status) {
  res.redirect(`${appUrl()}/?login=${status}`);
}

/** GET /api/auth/google — start the flow. */
router.get('/google', (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }

  // CSRF protection: a random value echoed back by Google and compared
  // against a cookie the browser also sends.
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    access_type: 'online',
    prompt: 'select_account'
  });

  res.redirect(`${AUTH_ENDPOINT}?${params.toString()}`);
});

/** GET /api/auth/google/callback — Google sends the user back here. */
router.get('/google/callback', async (req, res) => {
  if (!isConfigured()) return finish(res, 'unconfigured');

  const { code, state, error } = req.query;
  if (error) return finish(res, 'cancelled');
  if (!code) return finish(res, 'failed');

  const expectedState = req.cookies ? req.cookies[STATE_COOKIE] : null;
  res.clearCookie(STATE_COOKIE);
  if (!state || !expectedState || state !== expectedState) {
    return finish(res, 'state_mismatch');
  }

  let profile;
  try {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(),
        grant_type: 'authorization_code'
      })
    });

    if (!tokenRes.ok) {
      console.error('[google] token exchange failed:', (await tokenRes.text()).slice(0, 200));
      return finish(res, 'failed');
    }

    const tokens = await tokenRes.json();
    // The id_token came straight from Google's token endpoint over TLS, in
    // exchange for our client secret, so its contents can be trusted without
    // re-verifying the signature. (Signature checks matter when a token
    // arrives from the browser instead.)
    profile = jwt.decode(tokens.id_token);
    if (!profile || !profile.email) return finish(res, 'failed');
  } catch (err) {
    console.error('[google] sign-in failed:', err.message);
    return finish(res, 'failed');
  }

  const outcome = await resolveGoogleUser(profile);
  if (outcome.status === 'unverified_email') return finish(res, 'unverified_email');

  setSessionCookie(res, outcome.userId);
  return finish(res, outcome.status);
});

/**
 * Decide what a Google profile means for our user table, and apply it.
 *
 * Exported so the linking rule can be tested directly: whether an existing
 * account is linked hinges on Google's email_verified claim, and that is
 * the kind of rule that should not be verified only by reading it.
 */
async function resolveGoogleUser(profile) {
  const email = String(profile.email).toLowerCase();
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (existing) {
    // Only ever attach a Google identity to an existing account when Google
    // says the address is verified. Otherwise anyone able to create an
    // unverified Google account for someone else's address could take over
    // their ProShy account.
    if (!emailVerified) return { status: 'unverified_email' };

    if (!existing.google_id) {
      db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.sub, existing.id);
    }
    return { status: 'success', userId: existing.id, linked: true };
  }

  // New account. A random password hash keeps the column non-null; the user
  // can set a real password later through the normal reset path.
  const id = uuidv4();
  const filler = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at, credits, google_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, email, filler, new Date().toISOString(), FREE_TRIAL_CREDITS, profile.sub);

  return { status: 'welcome', userId: id, created: true };
}


module.exports = { router, isConfigured, callbackUrl, resolveGoogleUser };
