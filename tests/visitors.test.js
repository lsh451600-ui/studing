import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest, koreaDay } from '../functions/api/visitors.js';
function database(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  return { prepare(query) { return { query, values: [], bind(...values) { this.values = values; return this; } }; },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map(({ query, values }) => {
          const statement = sql.prepare(query);
          if (query.startsWith('SELECT')) return { results: statement.all(...values) };
          statement.run(...values); return { success: true, results: [] };
        });
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
}
function request(cookie = '', origin = 'https://studing.pages.dev') {
  return new Request('https://studing.pages.dev/api/visitors', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
}
test('daily counter resets at Korean midnight, not UTC midnight', () => {
  assert.equal(koreaDay(Date.parse('2026-10-07T14:59:59Z')), '2026-10-07');
  assert.equal(koreaDay(Date.parse('2026-10-07T15:00:00Z')), '2026-10-08');
});
test('refresh and navigation count once per browser per day; next day adds to cumulative total', async t => {
  const env = { MEMBERS_DB: database(t) }; let now = Date.parse('2026-10-07T14:59:59Z');
  t.mock.method(Date, 'now', () => now);
  const first = await onRequest({ env, request: request() });
  assert.deepEqual(await first.json(), { available: true, day: '2026-10-07', today: 1, total: 1 });
  const cookie = first.headers.get('Set-Cookie').split(';')[0];
  assert.ok(first.headers.get('Set-Cookie').includes('HttpOnly; Secure'));
  assert.equal((await (await onRequest({ env, request: request(cookie) })).json()).total, 1);
  const other = await onRequest({ env, request: request() });
  assert.equal((await other.json()).today, 2);
  now = Date.parse('2026-10-07T15:00:00Z');
  const tomorrow = await (await onRequest({ env, request: request(cookie) })).json();
  assert.deepEqual(tomorrow, { available: true, day: '2026-10-08', today: 1, total: 3 });
  assert.ok(!JSON.stringify(tomorrow).includes(cookie.split('=')[1]));
});
test('unavailable storage and foreign origins do not invent counts or set visitor cookies', async () => {
  const missing = await onRequest({ env: {}, request: request() });
  assert.equal(missing.status, 503); assert.equal(missing.headers.get('Set-Cookie'), null);
  assert.deepEqual(await missing.json(), { available: false });
  assert.equal((await onRequest({ env: {}, request: request('', 'https://other.example') })).status, 403);
});
