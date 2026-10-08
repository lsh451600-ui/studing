import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as views } from '../functions/api/board-views.js';
import { onRequest as recipeEntry } from '../functions/api/recipes.js';
import { onRequest as privateEntry } from '../functions/api/private.js';
import { onRequest as posts } from '../functions/api/board-posts.js';
import { onRequest as comments } from '../functions/api/board-comments.js';
import { onRequest as recipePosts } from '../functions/api/recipe-posts.js';
import { onRequest as privatePosts } from '../functions/api/private-posts.js';
import { sessionCookie as recipeCookie, ensurePosts as ensureRecipes } from '../src/recipe-server.js';
import { sessionCookie as privateCookie, ensurePosts as ensurePrivate } from '../src/private-server.js';
import { initialize } from '../src/community.js';
function database(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  const db = { prepare(query) { const q = { values: [], bind(...v) { this.values = v; return this; }, async run() { const r = sql.prepare(query).run(...this.values); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; }, async first() { return sql.prepare(query).get(...this.values) || null; }, async all() { return { results: sql.prepare(query).all(...this.values) }; } }; return q; }, async batch(queries) { const out = []; for (const q of queries) out.push(await q.run()); return out; } }; return db;
}
const request = (path, data, signed = false, origin = 'https://example.test', method = data ? 'POST' : 'GET') => new Request('https://example.test/api/' + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: signed ? '__Host-member-access=verified' : '' }, ...(data ? { body: JSON.stringify(data) } : {}) });
function env(t) { return { MEMBERS_DB: database(t), SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret' }; }
function auth(t, { id = 'member-id', username = 'verified-author', nickname = 'verified-nickname' } = {}) { t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id, user_metadata: { username: 'spoofed' } }) : Response.json([{ username, nickname }])); }
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
test('authors can update and delete their own posts, and deletion removes associated comments', async t => {
  auth(t); const settings = env(t);
  const created = await posts({ env: settings, request: request('board-posts', { title: 'Before', body: 'Before body' }, true) });
  const id = (await created.json()).id;
  await comments({ env: settings, request: request('board-comments', { postId: id, body: 'Comment' }, true) });
  const updated = await posts({ env: settings, request: request('board-posts?id=' + id, { title: 'After', body: 'After body' }, true, undefined, 'PATCH') });
  assert.equal(updated.status, 200);
  let detail = await (await posts({ env: settings, request: request('board-posts?id=' + id, null, true) })).json();
  assert.equal(detail.post.title, 'After');
  assert.deepEqual(detail.permissions, { canEdit: true, canDelete: true, permissionsUnavailable: false });
  const removed = await posts({ env: settings, request: request('board-posts?id=' + id, null, true, undefined, 'DELETE') });
  assert.equal(removed.status, 200);
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + id) })).status, 404);
  assert.equal((await settings.MEMBERS_DB.prepare('SELECT id FROM community_comments WHERE post_id = ?').bind(id).all()).results.length, 0);
});
test('the verified lsh451600 login can edit and delete another member post', async t => {
  const settings = env(t); await initialize(settings.MEMBERS_DB);
  const owner = async (id, title) => {
    const result = await settings.MEMBERS_DB.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, 'member', title, 'Body', new Date().toISOString()).run();
    return result.meta.last_row_id;
  };
  const id = await owner('someone-else', 'Original');
  auth(t, { id: 'admin-id', username: 'lsh451600', nickname: 'Operator' });
  const detail = await (await posts({ env: settings, request: request('board-posts?id=' + id, null, true) })).json();
  assert.deepEqual(detail.permissions, { canEdit: true, canDelete: true, permissionsUnavailable: false });
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + id, { title: 'Moderated', body: 'Edited' }, true, undefined, 'PATCH') })).status, 200);
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + id, null, true, undefined, 'DELETE') })).status, 200);
});
test('a different member cannot edit or delete someone else post', async t => {
  auth(t); const settings = env(t); await initialize(settings.MEMBERS_DB);
  const result = await settings.MEMBERS_DB.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind('other-id', 'Other', 'Title', 'Body', new Date().toISOString()).run();
  const id = result.meta.last_row_id;
  for (const method of ['PATCH', 'DELETE']) {
    const response = await posts({ env: settings, request: request('board-posts?id=' + id, method === 'PATCH' ? { title: 'Changed', body: 'Changed' } : null, true, undefined, method) });
    assert.equal(response.status, 403);
  }
});

test('only the comment author can delete, and public reads hide ownership IDs', async t => {
  auth(t); const settings = env(t);
  const created = await posts({ env: settings, request: request('board-posts', { title: 'Title', body: 'Body' }, true) });
  const postId = (await created.json()).id;
  const written = await comments({ env: settings, request: request('board-comments', { postId, body: 'My comment' }, true) });
  const id = (await written.json()).id;
  const other = await settings.MEMBERS_DB.prepare('INSERT INTO community_comments (post_id, author_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(postId, 'other-id', 'Other', 'Other comment', new Date().toISOString()).run();
  const detail = await (await posts({ env: settings, request: request('board-posts?id=' + postId, null, true) })).json();
  assert.equal(detail.comments.find(c => c.id === id).canDelete, true);
  assert.equal(detail.comments.find(c => c.id === other.meta.last_row_id).canDelete, false);
  assert.ok(!JSON.stringify(detail).includes('author_id'));
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + id, null, false, undefined, 'DELETE') })).status, 401);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + id, null, true, 'https://other.test', 'DELETE') })).status, 403);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + other.meta.last_row_id, null, true, undefined, 'DELETE') })).status, 403);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=invalid', null, true, undefined, 'DELETE') })).status, 400);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + id, null, true, undefined, 'DELETE') })).status, 200);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + id, null, true, undefined, 'DELETE') })).status, 404);
  const list = await (await posts({ env: settings, request: request('board-posts') })).json();
  assert.equal(list.posts[0].comments, 1);
});

test('comment authors and the verified operator can edit and delete, but other members cannot', async t => {
  let viewer = { id: 'owner-id', username: 'owner' };
  t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: viewer.id, user_metadata: { username: 'lsh451600' } }) : Response.json([{ username: viewer.username, nickname: viewer.username }]));
  const settings = env(t);
  const created = await posts({ env: settings, request: request('board-posts', { title: 'Title', body: 'Body' }, true) });
  const postId = (await created.json()).id;
  const written = await comments({ env: settings, request: request('board-comments', { postId, body: 'Original' }, true) });
  const id = (await written.json()).id;
  const patch = body => comments({ env: settings, request: request('board-comments?id=' + id, { body }, true, undefined, 'PATCH') });
  assert.equal((await patch('Owner edit')).status, 200);
  assert.equal((await patch(' ')).status, 400);
  viewer = { id: 'other-id', username: 'other' };
  assert.equal((await patch('Forbidden')).status, 403);
  let detail = await (await posts({ env: settings, request: request('board-posts?id=' + postId, null, true) })).json();
  assert.equal(detail.comments[0].canEdit, false);
  viewer = { id: 'operator-id', username: 'lsh451600' };
  detail = await (await posts({ env: settings, request: request('board-posts?id=' + postId, null, true) })).json();
  assert.equal(detail.comments[0].canEdit, true); assert.equal(detail.comments[0].canDelete, true);
  assert.equal((await patch('Operator edit')).status, 200);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + id, null, true, undefined, 'DELETE') })).status, 200);
});
for (const [kind, handler, cookie, ensure] of [['recipe', recipePosts, recipeCookie, ensureRecipes], ['private', privatePosts, privateCookie, ensurePrivate]]) {
  test(kind + ' posts enforce member ownership and operator moderation, including legacy posts', async t => {
    let viewer = { id: 'owner-id', username: 'owner' };
    t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: viewer.id, user_metadata: { username: 'lsh451600' } }) : Response.json([{ username: viewer.username }]));
    const settings = { ...env(t), RECIPE_PASSWORD: '0018', RECIPE_ADMIN_PASSWORD: 'a-secure-admin-password' };
    await ensure(settings.MEMBERS_DB);
    const reader = (await cookie(settings, 'viewer')).split(';')[0];
    const writer = (await cookie(settings, 'admin')).split(';')[0];
    const call = (method, id, data, { signed = true, access = reader, origin } = {}) => {
      const req = request(kind + '-posts' + (id ? '?id=' + id : ''), data, signed, origin, method);
      req.headers.set('Cookie', (req.headers.get('Cookie') || '') + '; ' + access);
      return handler({ env: settings, request: req });
    };
    const seeded = await settings.MEMBERS_DB.prepare('INSERT INTO ' + kind + '_posts (author_id, title, body, created_at) VALUES (?, ?, ?, ?)').bind('owner-id', 'Original', 'Body', new Date().toISOString()).run();
    const id = seeded.meta.last_row_id;
    const legacy = await settings.MEMBERS_DB.prepare('INSERT INTO ' + kind + '_posts (title, body, created_at) VALUES (?, ?, ?)').bind('Legacy', 'Body', new Date().toISOString()).run();
    let listing = await (await call('GET')).json();
    assert.equal(listing.posts.find(p => p.id === id).canEdit, true);
    assert.ok(!JSON.stringify(listing).includes('owner-id'));
    assert.equal((await call('PATCH', id, { title: 'Owner edit', body: 'Updated' })).status, 200);
    assert.equal((await call('PATCH', id, { title: 'x', body: 'y' }, { origin: 'https://other.test' })).status, 403);
    assert.equal((await call('DELETE', id, null, { signed: false, access: writer })).status, 403);
    viewer = { id: 'other-id', username: 'other' };
    assert.equal((await call('PATCH', id, { title: 'Forbidden', body: 'Body' })).status, 403);
    assert.equal((await call('DELETE', id)).status, 403);
    listing = await (await call('GET')).json(); assert.ok(listing.posts.every(p => !p.canEdit && !p.canDelete));
    viewer = { id: 'operator-id', username: 'lsh451600' };
    listing = await (await call('GET')).json(); assert.ok(listing.posts.every(p => p.canEdit && p.canDelete));
    assert.equal((await call('PATCH', legacy.meta.last_row_id, { title: 'Operator edit', body: 'Updated' })).status, 200);
    assert.equal((await call('DELETE', legacy.meta.last_row_id)).status, 200);
    assert.equal((await call('DELETE', id)).status, 200);
    assert.equal((await call('DELETE', id)).status, 404);
  });
}

test('views persist atomically, repeat reads are deduplicated, and list reads do not increment', async t => {
  const settings = env(t); await initialize(settings.MEMBERS_DB);
  await settings.MEMBERS_DB.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind('owner', 'Owner', 'Title', 'Body', new Date().toISOString()).run();
  let list = await (await posts({ env: settings, request: request('board-posts') })).json(); assert.equal(list.posts[0].views, 0);
  const open = cookie => {
    const req = request('board-views?id=1', null, false, undefined, 'POST'); if (cookie) req.headers.set('Cookie', cookie);
    return views({ env: settings, request: req });
  };
  const first = await open(); assert.equal(first.status, 200); assert.equal((await first.json()).views, 1);
  const cookie = first.headers.getSetCookie()[0].split(';')[0];
  assert.ok(first.headers.getSetCookie()[0].includes('Max-Age=1800'));
  assert.equal((await (await open(cookie)).json()).views, 1);
  assert.equal((await (await open()).json()).views, 2);
  list = await (await posts({ env: settings, request: request('board-posts') })).json(); assert.equal(list.posts[0].views, 2);
  assert.equal((await views({ env: settings, request: request('board-views?id=1') })).status, 405);
  assert.equal((await views({ env: settings, request: request('board-views?id=1', null, false, 'https://other.test', 'POST') })).status, 403);
  assert.equal((await views({ env: settings, request: request('board-views?id=invalid', null, false, undefined, 'POST') })).status, 400);
  assert.equal((await views({ env: settings, request: request('board-views?id=999', null, false, undefined, 'POST') })).status, 404);
});
for (const [kind, entry, handler] of [['recipe', recipeEntry, recipePosts], ['private', privateEntry, privatePosts]]) {
  test(kind + ' verified operator can publish without RECIPE_ADMIN_PASSWORD; ordinary accounts cannot', async t => {
    let operator = true;
    t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user'
      ? Response.json({ id: 'member-id', user_metadata: { username: 'lsh451600' } })
      : Response.json([{ username: operator ? 'lsh451600' : 'ordinary-member' }]));
    const settings = { ...env(t), RECIPE_PASSWORD: 'reader-password' };
    const entered = await entry({ env: settings, request: request(kind === 'recipe' ? 'recipes' : 'private', { password: settings.RECIPE_PASSWORD }, true) });
    assert.equal(entered.status, 200);
    const access = await entered.json(); assert.equal(access.canWrite, true); assert.equal(access.accountWriter, true); assert.equal(access.adminConfigured, true);
    const cookies = entered.headers.getSetCookie().filter(c => !c.includes('Max-Age=0')).map(c => c.split(';')[0]).join('; ');
    const create = () => {
      const req = request(kind + '-posts', { title: 'Operator post', body: 'Saved content' }, true);
      req.headers.set('Cookie', '__Host-member-access=verified; ' + cookies);
      return handler({ env: settings, request: req });
    };
    assert.equal((await create()).status, 201);
    operator = false;
    assert.equal((await create()).status, 403);
    const normal = await (await entry({ env: settings, request: request(kind === 'recipe' ? 'recipes' : 'private', { password: settings.RECIPE_PASSWORD }, true) })).json();
    assert.equal(normal.canWrite, false); assert.equal(normal.accountWriter, false);
    operator = true;
    assert.equal((await entry({ env: settings, request: request(kind === 'recipe' ? 'recipes' : 'private', { password: 'wrong-password' }, true) })).status, 401);
  });
}

test('view-count migration preserves existing posts and starts them at zero', async t => {
  const db = database(t);
  await db.prepare('CREATE TABLE community_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, author TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  await db.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind('owner', 'Owner', 'Existing title', 'Existing body', new Date().toISOString()).run();
  await initialize(db); await initialize(db);
  const post = await db.prepare('SELECT title, body, views FROM community_posts WHERE id = 1').first();
  assert.equal(post.title, 'Existing title'); assert.equal(post.body, 'Existing body'); assert.equal(post.views, 0);
});
