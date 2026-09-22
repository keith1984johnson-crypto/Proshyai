const crypto = require('crypto');

// AES-256-GCM encryption for user-supplied provider keys.
//
// Threat model: the SQLite file lives on a mounted volume. If that file is
// ever copied, leaked, or restored from a backup by someone who should not
// have it, the keys inside must be useless without a secret that lives
// somewhere else (an environment variable, not the database).
//
// GCM is authenticated: decryption fails loudly if the ciphertext was
// tampered with, rather than silently returning garbage.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the size GCM is specified for
const SALT = 'proshy-openai-key-v1';

/**
 * Returns true when the server is configured to store user keys.
 * Without KEY_ENCRYPTION_SECRET we refuse to store anything rather than
 * fall back to writing plaintext keys to disk.
 */
function isConfigured() {
  return typeof process.env.KEY_ENCRYPTION_SECRET === 'string'
    && process.env.KEY_ENCRYPTION_SECRET.length >= 16;
}

function derivedKey() {
  if (!isConfigured()) {
    throw new Error('KEY_ENCRYPTION_SECRET is not set (must be at least 16 characters)');
  }
  // scrypt stretches the secret into a 32-byte key suitable for AES-256.
  return crypto.scryptSync(process.env.KEY_ENCRYPTION_SECRET, SALT, 32);
}

/** Encrypt a string. Returns "iv:authTag:ciphertext", all base64. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Decrypt a value produced by encrypt(). Returns null if it cannot be read. */
function decrypt(stored) {
  if (!stored || typeof stored !== 'string') return null;
  try {
    const [ivB64, tagB64, dataB64] = stored.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong secret, corrupted row, or tampering — treat as "no key".
    return null;
  }
}

/** Last 4 characters, for showing the user which key is connected. */
function fingerprint(apiKey) {
  return typeof apiKey === 'string' && apiKey.length >= 4 ? apiKey.slice(-4) : '????';
}

module.exports = { encrypt, decrypt, isConfigured, fingerprint };
