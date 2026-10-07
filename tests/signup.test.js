import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, hashPassword, validate } from '../functions/api/register.js';

const body = { username: 'reader_1', password: 'a long test password', phone: '010-1234-5678', email: 'READER@example.com' };
const request = (data = body, origin = 'https://studing.pages.dev') => new Request('https://studing.pages.dev/api/register', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(data),
});
class Database {
  constructor() { this.saved = []; this.attempts = 0; }
  prepare(sql) {
    const db = this;
    return { values: [], bind(...values) { this.values = values; return this; },
      async first() { return { attempts: ++db.attempts }; },
      async run() {
        if (sql.includes('INSERT INTO members')) {
          if (db.saved.some(a => a[1].toLowerCase() === this.values[1].toLowerCase() || a[4] === this.values[4])) {
            throw new Error('D1_ERROR: UNIQUE constraint failed: members.username');
          }
          db.saved.push(this.values);
        }
        return { success: true };
      },
    };
  }
  async batch(statements) { return Promise.all(statements.map(s => s.run())); }
}

test('normalizes phone/email and rejects invalid or oversized fields', () => {
  assert.equal(validate(body).phone, '01012345678');
  assert.equal(validate(body).email, 'reader@example.com');
  for (const invalid of [{ password: 'short' }, { phone: 'hello' }, { email: 'bad' }, { username: '<script>' }, { username: 'a'.repeat(21) }]) {
    assert.equal(validate({ ...body, ...invalid }), null);
  }
});
test('password salts differ and plaintext is never stored in the encoding', async () => {
  const [a, b] = await Promise.all([hashPassword(body.password), hashPassword(body.password)]);
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!a.includes(body.password));
});
test('requires the database and rejects cross-origin requests', async () => {
  assert.equal((await onRequest({ request: request(), env: {} })).status, 503);
  assert.equal((await onRequest({ request: request(body, 'https://other.example'), env: { MEMBERS_DB: new Database() } })).status, 403);
  const response = await onRequest({ request: new Request('https://studing.pages.dev/api/register'), env: {} });
  assert.equal((await response.json()).available, false);
});
test('successful registration persists hash and normalized details, rejects duplicates', async () => {
  const db = new Database();
  const response = await onRequest({ request: request(), env: { MEMBERS_DB: db } });
  assert.equal(response.status, 201);
  assert.equal(db.saved.length, 1);
  assert.equal(db.saved[0][1], 'reader_1');
  assert.ok(db.saved[0][2].startsWith('pbkdf2-sha256$'));
  assert.equal(db.saved[0][3], '01012345678');
  assert.equal(db.saved[0][4], 'reader@example.com');
  assert.ok(!(await response.text()).includes(body.password));
  assert.equal((await onRequest({ request: request(), env: { MEMBERS_DB: db } })).status, 409);
});
test('rate limit blocks before hashing/inserting and malformed bodies do not write accounts', async () => {
  const db = new Database(); db.attempts = 5;
  assert.equal((await onRequest({ request: request(), env: { MEMBERS_DB: db } })).status, 429);
  assert.equal(db.saved.length, 0);
  assert.equal((await onRequest({ request: request({ ...body, username: 'bad' }), env: { MEMBERS_DB: db } })).status, 400);
  assert.equal((await onRequest({ request: request({ ...body, password: 'x'.repeat(5000) }), env: { MEMBERS_DB: db } })).status, 400);
  assert.equal(db.saved.length, 0);
});
