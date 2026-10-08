import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as posts } from '../functions/api/board-posts.js';
import { onRequest as comments } from '../functions/api/board-comments.js';
function database(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  const db = { prepare(query) { const q = { values: [], bind(...v) { this.values = v; return this; }, async run() { const r = sql.prepare(query).run(...this.values); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; }, async first() { return sql.prepare(query).get(...this.values) || null; }, async all() { return { results: sql.prepare(query).all(...this.values) }; } }; return q; }, async batch(queries) { const out = []; for (const q of queries) out.push(await q.run()); return out; } }; return db;
}
const request = (path, data, signed = false, origin = 'https://example.test') => new Request('https://example.test/api/' + path, { method: data ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: signed ? '__Host-member-access=verified' : '' }, ...(data ? { body: JSON.stringify(data) } : {}) });
function env(t) { return { MEMBERS_DB: database(t), SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret' }; }
function auth(t) { t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: 'member-id', user_metadata: { username: 'spoofed' } }) : Response.json([{ username: 'verified-author', nickname: 'verified-nickname' }])); }
test('anonymous visitors and foreign origins cannot post or comment', async t => {
  const settings = env(t);
  assert.equal((await posts({ env: settings, request: request('board-posts', { title: 'a', body: 'b' }) })).status, 401);
  assert.equal((await comments({ env: settings, request: request('board-comments', { postId: 1, body: 'b' }) })).status, 401);
  assert.equal((await posts({ env: settings, request: request('board-posts', { title: 'a', body: 'b' }, true, 'https://other.test') })).status, 403);
});
test('posts and comments persist with verified profile author and public read never exposes user IDs', async t => {
  auth(t); const settings = env(t);
  const created = await posts({ env: settings, request: request('board-posts', { title: '외식 이야기', body: '<script>literal</script>', author: 'forged' }, true) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  assert.equal((await comments({ env: settings, request: request('board-comments', { postId: id, body: '좋은 경험입니다.' }, true) })).status, 201);
  const list = await (await posts({ env: settings, request: request('board-posts') })).json();
  assert.equal(list.posts[0].comments, 1);
  const detail = await (await posts({ env: settings, request: request('board-posts?id=' + id) })).json();
  assert.equal(detail.post.author, 'verified-nickname'); assert.equal(detail.post.body, '<script>literal</script>');
  assert.equal(detail.comments[0].body, '좋은 경험입니다.'); assert.ok(!JSON.stringify(detail).includes('member-id'));
});
test('missing storage, invalid IDs and content, nonexistent comment targets and flooding fail safely', async t => {
  auth(t); const settings = env(t);
  assert.equal((await posts({ env: {}, request: request('board-posts') })).status, 503);
  assert.equal((await posts({ env: settings, request: request('board-posts?id=1 OR 1=1') })).status, 400);
  assert.equal((await posts({ env: settings, request: request('board-posts', { title: ' ', body: 'x' }, true) })).status, 400);
  assert.equal((await comments({ env: settings, request: request('board-comments', { postId: 999, body: 'x' }, true) })).status, 404);
  for (let i = 0; i < 5; i++) assert.equal((await posts({ env: settings, request: request('board-posts', { title: 'title', body: 'body' }, true) })).status, 201);
  assert.equal((await posts({ env: settings, request: request('board-posts', { title: 'title', body: 'body' }, true) })).status, 429);
});
