const Database = require('better-sqlite3');
const path = require('path');

// Database location. In production DATABASE_PATH points at a mounted
// Railway volume (e.g. /app/data/proshy.db) so accounts, credits and
// subscription records survive redeploys. With no DATABASE_PATH set —
// local development — it falls back to a file next to the app.
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'proshy.db');
const db = new Database(DB_PATH);
console.log(`SQLite database: ${DB_PATH}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'none',  -- none | active | past_due | canceled
    plan TEXT DEFAULT 'none'                  -- none | weekly | monthly | yearly
  );
`);

// --- migrations -------------------------------------------------------
// Additive only, and safe to run on every boot.
//
// SQLite has no "ADD COLUMN IF NOT EXISTS", and probing with PRAGMA
// table_info leaves a prepared Statement alive that trips a better-sqlite3
// teardown assertion on Node 24 (the process aborts at exit). Attempting
// the ALTER and swallowing the duplicate-column error avoids creating any
// statement at all.
function addUserColumn(name, definition) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

// User-supplied OpenAI key (BYOK), encrypted at rest by lib/crypto.js.
// Only the last 4 characters are stored in the clear, so the UI can show
// which key is connected without ever decrypting it.
addUserColumn('openai_key_encrypted', 'TEXT');
addUserColumn('openai_key_last4', 'TEXT');

module.exports = db;
