import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as session } from '../functions/api/session.js';
import { onRequest as account } from '../functions/api/account.js';
import { onRequest as posts } from '../functions/api/board-posts.js';
import { initialize } from '../src/community.js';
import { onRequest } from '../functions/api/nickname.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'public',
  SUPABASE_SECRET_KEY: 'secret'
};
function request(nickname) {
  return new Request('https://example.test/api/nickname', {
    method: 'POST',
    headers: {
      Origin: 'https://example.test',
      'Content-Type': 'application/json',
      Cookie: '__Host-member-access=session-token'
    },
    body: JSON.stringify({ nickname })
  });
}
function mockNicknameSave(t, expected) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    if (new URL(url).pathname === '/auth/v1/user') {
      return Response.json({ id: 'member-id' });
    }
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/update_member_nickname');
    assert.equal(JSON.parse(options.body).requested_nickname, expected);
    return Response.json(expected);
  });
  return () => assert.equal(calls, 2);
}

test('nickname accepts symbols, spaces, non-Latin text and emoji independently of login ID rules', async t => {
  const nickname = '食堂 🍜 (訪問者) !';
  const done = mockNicknameSave(t, nickname);
  const response = await onRequest({ env, request: request(nickname) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nickname, nickname);
  done();
});

test('nickname rejects blank, control-character and overlong values before saving', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).pathname, '/auth/v1/user');
    return Response.json({ id: 'member-id' });
  });
  for (const nickname of ['   ', 'line\nbreak', 'a'.repeat(41)]) {
    const response = await onRequest({ env, request: request(nickname) });
    assert.equal(response.status, 400);
  }
});

function nicknameDB(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  return { prepare(query) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async run() { const result = sql.prepare(query).run(...values); return { meta: { last_row_id: Number(result.lastInsertRowid) } }; }, async first() { return sql.prepare(query).get(...values); }, async all() { return { results: sql.prepare(query).all(...values) }; } };
  }, async batch(queries) { return Promise.all(queries.map(query => query.run())); } };
}
test('D1 nicknames persist across account reads without the Supabase nickname migration and update old/new posts', async t => {
  const settings = { ...env, MEMBERS_DB: nicknameDB(t) };
  await initialize(settings.MEMBERS_DB);
  await settings.MEMBERS_DB.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind('member-id', 'Old', 'Title', 'Body', new Date().toISOString()).run();
  await settings.MEMBERS_DB.prepare('INSERT INTO community_comments (post_id, author_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(1, 'member-id', 'Old', 'Comment', new Date().toISOString()).run();
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') return Response.json({ id: 'member-id', user_metadata: { username: 'login-id' } });
    assert.equal(parsed.pathname, '/rest/v1/member_profiles');
    if (parsed.searchParams.get('select').includes('nickname') || parsed.searchParams.has('nickname')) return Response.json({ code: '42703' }, { status: 400 });
    return Response.json([{ username: 'login-id', phone: '01012345678' }]);
  });
  const nickname = '食堂 🍜 (새 닉네임) !';
  assert.equal((await onRequest({ env: settings, request: request(nickname) })).status, 200);
  const read = () => new Request('https://example.test/api/account', { headers: { Cookie: '__Host-member-access=session-token' } });
  assert.equal((await (await account({ env: settings, request: read() })).json()).account.nickname, nickname);
  const identity = await (await session({ env: settings, request: new Request('https://example.test/api/session', { headers: { Cookie: '__Host-member-access=session-token' } }) })).json();
  assert.equal(identity.user.username, 'login-id');
  assert.equal(identity.user.nickname, nickname);
  const body = await (await posts({ env: settings, request: new Request('https://example.test/api/board-posts?id=1') })).json();
  assert.equal(body.post.author, nickname); assert.equal(body.comments[0].author, nickname);
  const create = request('unused');
  const posted = await posts({ env: settings, request: new Request('https://example.test/api/board-posts', { method: 'POST', headers: create.headers, body: JSON.stringify({ title: 'New', body: 'New body' }) }) });
  assert.equal(posted.status, 201);
  assert.equal((await settings.MEMBERS_DB.prepare('SELECT author FROM community_posts WHERE id = ?').bind((await posted.json()).id).first()).author, nickname);
  assert.equal((await onRequest({ env: settings, request: request('다음 닉네임') })).status, 200);
  assert.equal((await (await account({ env: settings, request: read() })).json()).account.nickname, '다음 닉네임');
});
test('D1 nickname uniqueness and verified user ID are enforced, including old Supabase names', async t => {
  const settings = { ...env, MEMBERS_DB: nicknameDB(t) }; let userId = 'first-id', legacyName = false;
  t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).pathname === '/auth/v1/user') return Response.json({ id: userId });
    assert.equal(new URL(url).pathname, '/rest/v1/member_profiles');
    return Response.json(legacyName ? [{ id: 'legacy-id' }] : []);
  });
  assert.equal((await onRequest({ env: settings, request: request('Saved name') })).status, 200);
  userId = 'other-id';
  assert.equal((await onRequest({ env: settings, request: request('SAVED NAME') })).status, 409);
  legacyName = true;
  assert.equal((await onRequest({ env: settings, request: request('Legacy name') })).status, 409);
});
test('nickname storage failures never report success', async t => {
  const settings = { ...env, MEMBERS_DB: { prepare() { throw new Error('D1 unavailable'); } } };
  t.mock.method(globalThis, 'fetch', async url => new URL(url).pathname === '/auth/v1/user' ? Response.json({ id: 'member-id' }) : Response.json([]));
  assert.equal((await onRequest({ env: settings, request: request('Name') })).status, 503);
});
