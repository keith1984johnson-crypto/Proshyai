const Database = require('better-sqlite3');
const path = require('path');

// Stored on disk next to the app. Note: most hosts (including Railway
// without a mounted volume) reset the filesystem on redeploy — for real
// production use, attach a persistent volume or move to a hosted Postgres
// database. Fine for getting started.
const db = new Database(path.join(__dirname, 'proshy.db'));

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

module.exports = db;
