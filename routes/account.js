const express = require('express');
const fetch = require('node-fetch');
const db = require('../db');
const { encrypt, decrypt, isConfigured, fingerprint } = require('../lib/crypto');

const router = express.Router();

// Bring-your-own-key (BYOK) for OpenAI.
//
// Rules this module enforces:
//   1. A key is only ever stored encrypted (lib/crypto.js, AES-256-GCM).
//   2. A key is NEVER returned to the browser — not even masked beyond the
//      last four characters, which are stored separately for display.
//   3. A key is validated against OpenAI before it is saved, so a typo is
//      rejected at paste time instead of silently failing at generation.
//   4. If KEY_ENCRYPTION_SECRET is not configured, saving is refused rather
//      than falling back to writing plaintext keys to disk.

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Log in first.' });
  }
  next();
}

/** GET /api/account/openai-key/status -> { connected, last4, available } */
router.get('/openai-key/status', (req, res) => {
  if (!req.user) {
    return res.json({ connected: false, available: isConfigured() });
  }

  const row = db
    .prepare('SELECT openai_key_encrypted, openai_key_last4 FROM users WHERE id = ?')
    .get(req.user.id);

  res.json({
    connected: Boolean(row && row.openai_key_encrypted),
    last4: row && row.openai_key_last4 ? row.openai_key_last4 : null,
    available: isConfigured()
  });
});

/** POST /api/account/openai-key  { apiKey } */
router.post('/openai-key', requireAuth, async (req, res) => {
  const { apiKey } = req.body;

  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ error: 'Paste your OpenAI key.' });
  }

  const key = apiKey.trim();

  if (!key.startsWith('sk-')) {
    return res.status(400).json({
      error: key.startsWith('proj_')
        ? 'That is a Project ID, not an API key. Keys start with "sk-" and are created at platform.openai.com/api-keys.'
        : 'That does not look like an OpenAI key — they start with "sk-".'
    });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'This server cannot store keys securely right now (KEY_ENCRYPTION_SECRET is not set). Contact support.'
    });
  }

  // Validate before storing: a key that cannot list models is not usable.
  try {
    const check = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });

    if (check.status === 401) {
      return res.status(400).json({ error: 'OpenAI rejected that key. Check it and try again.' });
    }
    if (!check.ok && check.status !== 429) {
      return res.status(400).json({ error: `OpenAI returned ${check.status} for that key.` });
    }
    // 429 means the key is valid but out of quota — worth saving, with a warning.
    var quotaWarning = check.status === 429
      ? 'Key saved, but the account has no credits — add a balance at platform.openai.com to generate.'
      : null;
  } catch {
    return res.status(502).json({ error: 'Could not reach OpenAI to verify the key. Try again shortly.' });
  }

  db.prepare('UPDATE users SET openai_key_encrypted = ?, openai_key_last4 = ? WHERE id = ?')
    .run(encrypt(key), fingerprint(key), req.user.id);

  res.json({ connected: true, last4: fingerprint(key), warning: quotaWarning });
});

/** DELETE /api/account/openai-key */
router.delete('/openai-key', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET openai_key_encrypted = NULL, openai_key_last4 = NULL WHERE id = ?')
    .run(req.user.id);
  res.json({ connected: false });
});

/**
 * Returns the key a generation should use: the user's own if they have
 * connected one, otherwise the server's. Never sent to the browser.
 */
function resolveOpenAIKey(user) {
  if (user && user.id) {
    const row = db.prepare('SELECT openai_key_encrypted FROM users WHERE id = ?').get(user.id);
    const userKey = row && decrypt(row.openai_key_encrypted);
    if (userKey) return userKey;
  }
  return process.env.OPENAI_API_KEY || null;
}

/** True when the request can do real OpenAI work with somebody's key. */
function hasOpenAIKey(user) {
  return Boolean(resolveOpenAIKey(user));
}

module.exports = { router, resolveOpenAIKey, hasOpenAIKey };
