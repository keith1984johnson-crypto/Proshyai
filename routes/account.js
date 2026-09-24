const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const { encrypt, decrypt, isConfigured, fingerprint } = require('../lib/crypto');
const gemini = require('../lib/gemini');

const router = express.Router();

// Bring-your-own-key (BYOK) for Gemini.
//
// Rules this module enforces:
//   1. A key is only ever stored encrypted (lib/crypto.js, AES-256-GCM).
//   2. A key is NEVER returned to the browser — not even masked beyond the
//      last four characters, which are stored separately for display.
//   3. A key is validated against Google before it is saved, so a typo is
//      rejected at paste time instead of silently failing at generation.
//   4. If KEY_ENCRYPTION_SECRET is not configured, saving is refused rather
//      than falling back to writing plaintext keys to disk.

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Log in first.' });
  }
  next();
}

/** GET /api/account/gemini-key/status -> { connected, last4, available } */
router.get('/gemini-key/status', (req, res) => {
  if (!req.user) {
    return res.json({ connected: false, available: isConfigured() });
  }

  const row = db
    .prepare('SELECT gemini_key_encrypted, gemini_key_last4 FROM users WHERE id = ?')
    .get(req.user.id);

  res.json({
    connected: Boolean(row && row.gemini_key_encrypted),
    last4: row && row.gemini_key_last4 ? row.gemini_key_last4 : null,
    available: isConfigured()
  });
});

/** POST /api/account/gemini-key  { apiKey } */
router.post('/gemini-key', requireAuth, async (req, res) => {
  const { apiKey } = req.body;

  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'Paste your Gemini key.' });
  }

  const key = apiKey.trim();

  if (!key.startsWith('AIza')) {
    return res.status(400).json({
      error: key.startsWith('sk-')
        ? 'That looks like an OpenAI key. ProShy uses Gemini now — get a free key at aistudio.google.com/apikey (it starts with "AIza").'
        : 'That does not look like a Gemini key — they start with "AIza".'
    });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'This server cannot store keys securely right now (KEY_ENCRYPTION_SECRET is not set). Contact support.'
    });
  }

  // Validate before storing: a key that cannot list models is not usable.
  let quotaWarning = null;
  try {
    const check = await gemini.verifyKey(key);
    if (check.status === 400 || check.status === 401 || check.status === 403) {
      return res.status(400).json({ error: 'Google rejected that key. Check it and try again.' });
    }
    if (check.status === 429) {
      quotaWarning = 'Key saved, but it is currently rate limited. Generations may fall back to demo until it resets.';
    } else if (!check.ok) {
      return res.status(400).json({ error: `Google returned ${check.status} for that key.` });
    }
  } catch {
    return res.status(502).json({ error: 'Could not reach Google to verify the key. Try again shortly.' });
  }

  db.prepare('UPDATE users SET gemini_key_encrypted = ?, gemini_key_last4 = ? WHERE id = ?')
    .run(encrypt(key), fingerprint(key), req.user.id);

  res.json({ connected: true, last4: fingerprint(key), warning: quotaWarning });
});

/** DELETE /api/account/gemini-key */
router.delete('/gemini-key', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET gemini_key_encrypted = NULL, gemini_key_last4 = NULL WHERE id = ?')
    .run(req.user.id);
  res.json({ connected: false });
});

/**
 * Returns the key a generation should use: the user's own if they have
 * connected one, otherwise the server's. Never sent to the browser.
 */
function resolveGeminiKey(user) {
  if (user && user.id) {
    const row = db.prepare('SELECT gemini_key_encrypted FROM users WHERE id = ?').get(user.id);
    const userKey = row && decrypt(row.gemini_key_encrypted);
    if (userKey) return userKey;
  }
  return process.env.GEMINI_API_KEY || null;
}

/** True when the request can do real Gemini work with somebody's key. */
function hasGeminiKey(user) {
  return Boolean(resolveGeminiKey(user));
}

module.exports = { router, resolveGeminiKey, hasGeminiKey };
