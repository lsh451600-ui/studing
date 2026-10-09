import { ensureLevels } from '../src/member-levels.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as views } from '../functions/api/board-views.js';
import { onRequest as recipeEntry } from '../functions/api/recipes.js';
import { onRequest as privateEntry } from '../functions/api/private.js';
import { onRequest as posts } from '../functions/api/board-posts.js';
import { onRequest as recipeComments } from '../functions/api/recipe-comments.js';
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
    await ensureLevels(settings.MEMBERS_DB);
    for (const id of ['owner-id', 'other-id']) await settings.MEMBERS_DB.prepare("INSERT INTO member_levels (member_id,level,updated_by,updated_at) VALUES (?,'special','operator','now')").bind(id).run();
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
    await ensureLevels(settings.MEMBERS_DB);
    for (const id of ['member-id', 'other-id', 'other-member', 'owner-id']) await settings.MEMBERS_DB.prepare("INSERT OR IGNORE INTO member_levels (member_id,level,updated_by,updated_at) VALUES (?,'special','operator','now')").bind(id).run();
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
    if (kind === 'recipe') assert.equal((await entry({ env: settings, request: request('recipes', { password: 'wrong-password' }, true) })).status, 401);
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

async function recipeCommentSetup(t) {
  const settings = { ...env(t), RECIPE_PASSWORD: 'reader-password' };
    await ensureLevels(settings.MEMBERS_DB);
    for (const id of ['member-id', 'other-id', 'other-member', 'owner-id']) await settings.MEMBERS_DB.prepare("INSERT OR IGNORE INTO member_levels (member_id,level,updated_by,updated_at) VALUES (?,'special','operator','now')").bind(id).run();
  await ensureRecipes(settings.MEMBERS_DB);
  for (let i = 0; i < 2; i++) await settings.MEMBERS_DB.prepare('INSERT INTO recipe_posts (author_id,title,body,created_at) VALUES (?,?,?,?)').bind('owner-id', 'Recipe ' + i, 'Body', new Date().toISOString()).run();
  const cookie = (await recipeCookie(settings, 'viewer')).split(';')[0];
  const req = (path, data, signed = true, origin, method) => {
    const initial = request(path, data, signed, origin, method), headers = new Headers(initial.headers);
    headers.set('Cookie', (initial.headers.get('Cookie') || '') + '; ' + cookie);
    return new Request(initial, { headers });
  };
  return { settings, req };
}
test('recipe comments require member and reader access, reject foreign origins and validate inputs', async t => {
  auth(t); const { settings, req } = await recipeCommentSetup(t);
  assert.equal((await recipeComments({ env: settings, request: request('recipe-comments?postId=1', null, true) })).status, 403);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?postId=1', null, false) })).status, 403);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, body: 'Hi' }, true, 'https://other.test') })).status, 403);
  for (const body of ['', '   ', 'x'.repeat(2001)]) assert.equal((await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, body }) })).status, 400);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?postId=invalid') })).status, 400);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments', { postId: 999, body: 'Hi' }) })).status, 404);
});
test('recipe comments persist per recipe with verified nickname and owner moderation', async t => {
  auth(t); const { settings, req } = await recipeCommentSetup(t);
  const created = await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, author: 'forged', body: '<script>literal</script>' }) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  const listed = await (await recipeComments({ env: settings, request: req('recipe-comments?postId=1') })).json();
  assert.equal(listed.comments[0].author, 'verified-nickname'); assert.equal(listed.comments[0].body, '<script>literal</script>');
  assert.equal(listed.comments[0].canEdit, true); assert.ok(!JSON.stringify(listed).includes('member-id'));
  assert.deepEqual((await (await recipeComments({ env: settings, request: req('recipe-comments?postId=2') })).json()).comments, []);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?id=' + id, { body: '수정한 댓글' }, true, undefined, 'PATCH') })).status, 200);
  assert.equal((await (await recipeComments({ env: settings, request: req('recipe-comments?postId=1') })).json()).comments[0].body, '수정한 댓글');
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?id=' + id, null, true, undefined, 'DELETE') })).status, 200);
  assert.deepEqual((await (await recipeComments({ env: settings, request: req('recipe-comments?postId=1') })).json()).comments, []);
});
test('other members cannot modify recipe comments while the verified operator can', async t => {
  auth(t); const { settings, req } = await recipeCommentSetup(t);
  const created = await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, body: '원본 댓글' }) });
  const id = (await created.json()).id;
  auth(t, { id: 'other-member', username: 'ordinary' });
  const listed = await (await recipeComments({ env: settings, request: req('recipe-comments?postId=1') })).json();
  assert.equal(listed.comments[0].canEdit, false); assert.equal(listed.comments[0].canDelete, false);
  for (const method of ['PATCH', 'DELETE']) assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?id=' + id, method === 'PATCH' ? { body: 'forged' } : null, true, undefined, method) })).status, 403);
  auth(t, { id: 'operator-id', username: 'lsh451600' });
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?id=' + id, { body: '운영자 수정' }, true, undefined, 'PATCH') })).status, 200);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments?id=' + id, null, true, undefined, 'DELETE') })).status, 200);
});
test('recipe deletion removes its comments and comment flooding is limited', async t => {
  auth(t); const { settings, req } = await recipeCommentSetup(t);
  for (let i = 0; i < 20; i++) assert.equal((await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, body: '댓글 ' + i }) })).status, 201);
  assert.equal((await recipeComments({ env: settings, request: req('recipe-comments', { postId: 1, body: 'Too many' }) })).status, 429);
  auth(t, { id: 'owner-id', username: 'owner' });
  assert.equal((await recipePosts({ env: settings, request: req('recipe-posts?id=1', null, true, undefined, 'DELETE') })).status, 200);
  assert.equal((await settings.MEMBERS_DB.prepare('SELECT id FROM recipe_comments WHERE post_id = 1').all()).results.length, 0);
});

for (const nickname of [null, '', '   ']) {
  test('authors without a nickname use their verified login ID: ' + JSON.stringify(nickname), async t => {
    auth(t, { username: 'verified-author', nickname }); const settings = env(t);
    const created = await posts({ env: settings, request: request('board-posts', { title: '아이디 표시', body: '닉네임 없는 글', author: 'forged' }, true) });
    assert.equal(created.status, 201); const id = (await created.json()).id;
    assert.equal((await comments({ env: settings, request: request('board-comments', { postId: id, body: '닉네임 없는 댓글' }, true) })).status, 201);
    const detail = await (await posts({ env: settings, request: request('board-posts?id=' + id) })).json();
    assert.equal(detail.post.author, 'verified-author');
    assert.equal(detail.comments[0].author, 'verified-author');
  });
}

test('board categories persist and ordinary authors cannot create or promote notices', async t => {
  auth(t); const settings = env(t);
  const write = category => posts({ env: settings, request: request('board-posts', { title: '분류 테스트', body: '본문', category }, true) });
  assert.equal((await write('공지')).status, 403);
  assert.equal((await write('잘못된 분류')).status, 400);
  const created = await write('질문'); assert.equal(created.status, 201); const id = (await created.json()).id;
  const edit = category => posts({ env: settings, request: request('board-posts?id=' + id, { title: '수정', body: '본문', category }, true, 'https://example.test', 'PATCH') });
  assert.equal((await edit('공지')).status, 403);
  assert.equal((await edit('정보')).status, 200);
  const detail = await (await posts({ env: settings, request: request('board-posts?id=' + id) })).json();
  assert.equal(detail.post.category, '정보');
  const list = await (await posts({ env: settings, request: request('board-posts') })).json();
  assert.equal(list.posts[0].category, '정보');
});

test('verified operator can create and edit notices even with a different nickname', async t => {
  auth(t, { username: 'lsh451600', nickname: '운영팀' }); const settings = env(t);
  const created = await posts({ env: settings, request: request('board-posts', { title: '공지사항', body: '안내', category: '공지' }, true) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + id, { title: '공지 수정', body: '안내 수정' }, true, 'https://example.test', 'PATCH') })).status, 200);
  const detail = await (await posts({ env: settings, request: request('board-posts?id=' + id) })).json();
  assert.equal(detail.post.category, '공지'); assert.equal(detail.post.title, '공지 수정');
});


test('notices stay above newer ordinary posts without duplicating or skipping older pages', async t => {
  const settings = env(t); await initialize(settings.MEMBERS_DB);
  for (let id = 1; id <= 45; id++) {
    await settings.MEMBERS_DB.prepare('INSERT INTO community_posts (id,author_id,author,title,body,category,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, 'member', '작성자', '제목 ' + id, '본문', [1, 12, 44].includes(id) ? '공지' : '잡담', '2026-10-09T00:00:00Z').run();
  }
  const get = async path => (await posts({ env: settings, request: request(path) })).json();
  const first = await get('board-posts');
  assert.deepEqual(first.posts.slice(0, 3).map(p => p.id), [44, 12, 1]);
  assert.equal(first.posts[3].id, 45); assert.equal(first.posts.length, 23);
  const second = await get('board-posts?before=' + first.next);
  const third = await get('board-posts?before=' + second.next);
  assert.equal(second.posts.some(p => p.category === '공지'), false);
  assert.equal(third.next, null);
  const all = [...first.posts, ...second.posts, ...third.posts];
  assert.equal(all.length, 45); assert.equal(new Set(all.map(p => p.id)).size, 45);
  const filtered = await get('board-posts?q=' + encodeURIComponent('제목 1'));
  assert.deepEqual(filtered.posts.slice(0, 2).map(p => p.id), [12, 1]);
  assert.ok(filtered.posts.every(p => p.title.includes('제목 1')));
});

test('secret posts protect bodies and comments from other members and allow owner/operator', async t => {
  const settings = env(t); let id = 'owner', username = 'owner';
  t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id }) : Response.json([{ username }]));
  const created = await posts({ env: settings, request: request('board-posts', { title: '비밀 문의', body: 'hidden-needle', is_secret: true }, true) });
  assert.equal(created.status, 201); const postId = (await created.json()).id;
  const detail = () => posts({ env: settings, request: request('board-posts?id=' + postId, null, true) });
  const added = await comments({ env: settings, request: request('board-comments', { postId, body: 'secret-comment' }, true) });
  assert.equal(added.status, 201); const commentId = (await added.json()).id;
  assert.equal((await (await detail()).json()).post.body, 'hidden-needle');
  id = 'other'; username = 'other';
  const denied = await detail(); assert.equal(denied.status, 403); assert.ok(!(await denied.text()).includes('hidden-needle'));
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + postId) })).status, 403);
  const list = await (await posts({ env: settings, request: request('board-posts') })).json(); assert.equal(list.posts[0].is_secret, 1); assert.equal(list.posts[0].body, undefined);
  const search = await (await posts({ env: settings, request: request('board-posts?q=hidden-needle') })).json(); assert.equal(search.posts.length, 0);
  assert.equal((await comments({ env: settings, request: request('board-comments', { postId, body: 'intrusion' }, true) })).status, 403);
  assert.equal((await comments({ env: settings, request: request('board-comments?id=' + commentId, { body: 'intrusion' }, true, undefined, 'PATCH') })).status, 403);
  assert.equal((await views({ env: settings, request: request('board-views?id=' + postId, {}, true) })).status, 403);
  username = 'lsh451600'; assert.equal((await detail()).status, 200);
  assert.equal((await comments({ env: settings, request: request('board-comments', { postId, body: '운영자 답변' }, true) })).status, 201);
  id = 'owner'; username = 'owner';
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + postId, { title: '공개 문의', body: 'now-public', is_secret: false }, true, undefined, 'PATCH') })).status, 200);
  assert.equal((await posts({ env: settings, request: request('board-posts?id=' + postId) })).status, 200);
  assert.equal((await posts({ env: settings, request: request('board-posts', { title: 'x', body: 'y', is_secret: 'false' }, true) })).status, 400);
});
