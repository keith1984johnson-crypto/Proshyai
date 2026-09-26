/**
 * Google sign-in linking rules.
 *
 *   node tests/oauth.test.js
 *
 * The rule that matters: an existing account is only ever linked to a
 * Google identity when Google reports the address as verified. Without
 * that check, anyone who could create an unverified Google account for
 * someone else's address could take over their ProShy account.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDb = path.join(os.tmpdir(), `proshy-oauth-test-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.FREE_TRIAL_CREDITS = '25';

const db = require('../db');
const { resolveGoogleUser } = require('../routes/oauth');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

function makePasswordUser(email) {
  const id = `u-${email}`;
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, created_at, credits)
     VALUES (?, ?, 'hash', ?, 25)`
  ).run(id, email, new Date().toISOString());
  return id;
}

const userRow = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);

(async () => {
  console.log('\ngoogle sign-in');

  await test('a verified Google email links to the existing account', async () => {
    const id = makePasswordUser('linkme@test.com');
    const out = await resolveGoogleUser({
      email: 'linkme@test.com',
      email_verified: true,
      sub: 'google-sub-1'
    });

    assert.strictEqual(out.status, 'success');
    assert.strictEqual(out.userId, id, 'must reuse the existing account, not create a second one');
    assert.strictEqual(userRow('linkme@test.com').google_id, 'google-sub-1');
  });

  await test('an UNVERIFIED Google email is refused, and links nothing', async () => {
    makePasswordUser('victim@test.com');
    const out = await resolveGoogleUser({
      email: 'victim@test.com',
      email_verified: false,
      sub: 'attacker-sub'
    });

    assert.strictEqual(out.status, 'unverified_email');
    assert.strictEqual(userRow('victim@test.com').google_id, null, 'account must not be linked');
  });

  await test('a missing email_verified claim is treated as unverified', async () => {
    makePasswordUser('noclaim@test.com');
    const out = await resolveGoogleUser({ email: 'noclaim@test.com', sub: 'sub-x' });
    assert.strictEqual(out.status, 'unverified_email');
  });

  await test('the string "true" is accepted, since JWT claims vary', async () => {
    makePasswordUser('stringy@test.com');
    const out = await resolveGoogleUser({
      email: 'stringy@test.com',
      email_verified: 'true',
      sub: 'sub-str'
    });
    assert.strictEqual(out.status, 'success');
  });

  await test('a new Google user gets an account with the free trial', async () => {
    const out = await resolveGoogleUser({
      email: 'brandnew@test.com',
      email_verified: true,
      sub: 'google-sub-2'
    });

    assert.strictEqual(out.status, 'welcome');
    const row = userRow('brandnew@test.com');
    assert.strictEqual(row.credits, 25);
    assert.strictEqual(row.google_id, 'google-sub-2');
  });

  await test('signing in again does not create a second account or re-grant credits', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.prepare('UPDATE users SET credits = 4 WHERE email = ?').run('brandnew@test.com');

    const out = await resolveGoogleUser({
      email: 'brandnew@test.com',
      email_verified: true,
      sub: 'google-sub-2'
    });

    assert.strictEqual(out.status, 'success');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before);
    assert.strictEqual(userRow('brandnew@test.com').credits, 4, 'trial must not be granted twice');
  });

  await test('the email is normalised to lower case', async () => {
    await resolveGoogleUser({ email: 'MiXeD@Test.com', email_verified: true, sub: 'sub-mixed' });
    assert.ok(userRow('mixed@test.com'), 'stored lower case');
  });

  console.log(`\n${passed} passed\n`);
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
})();
