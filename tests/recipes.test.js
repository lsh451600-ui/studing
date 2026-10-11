import test, { beforeEach } from 'node:test';
import { ensureLevels } from '../src/member-levels.js';
beforeEach(t => { t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: 'reader-id' }) : Response.json([{ username: 'reader' }])); });
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as enter } from '../functions/api/recipes.js';
import { onRequest as admin } from '../functions/api/recipe-admin.js';
import { onRequest as posts } from '../functions/api/recipe-posts.js';
import { onRequest as image } from '../functions/api/recipe-image.js';
import { onRequest as file } from '../functions/api/recipe-file.js';
import { authorized, validatePost, matchesPassword, sessionCookie, ensurePosts, listPosts } from '../src/recipe-server.js';
class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql); let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() { const r = statement.run(...values); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; },
    };
  }
}
const makeEnv = () => ({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret', RECIPE_PASSWORD: '0018', RECIPE_ADMIN_PASSWORD: 'private-author-password-example', MEMBERS_DB: new D1() });
function request(path, { method = 'GET', data, cookie = '', origin = 'https://studing.pages.dev' } = {}) {
  const headers = { Cookie: cookie };
  if (method !== 'GET') { headers.Origin = origin; headers['Content-Type'] = 'application/json'; }
  return new Request('https://studing.pages.dev' + path, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
const cookieOf = response => response.headers.getSetCookie().filter(c => !c.includes('Max-Age=0')).map(c => c.split(';')[0]).join('; ');
async function loginViewer(env) {
  await ensureLevels(env.MEMBERS_DB);
  await env.MEMBERS_DB.prepare("INSERT OR REPLACE INTO member_levels (member_id,level,updated_by,updated_at) VALUES ('reader-id','special','operator','now')").run();
  const response = await enter({ env, request: request('/api/recipes', { method: 'POST', cookie: '__Host-member-access=verified', data: { password: env.RECIPE_PASSWORD } }) });
  assert.equal(response.status, 200); return cookieOf(response) + '; __Host-member-access=verified';
}
async function loginAdmin(env, viewer) {
  const response = await admin({ env, request: request('/api/recipe-admin', { method: 'POST', cookie: viewer, data: { password: env.RECIPE_ADMIN_PASSWORD } }) });
  assert.equal(response.status, 403); return viewer;
}

function operator(t, env) {
  Object.assign(env, { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret' });
  t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: 'operator-id' }) : Response.json([{ username: 'lsh451600' }]));
}
test('exact passwords and missing configuration fail closed', async () => {
  assert.equal(await matchesPassword('0018', '18'), false);
  assert.equal((await enter({ env: {}, request: request('/api/recipes', { method: 'POST', data: { password: '0018' } }) })).status, 401);
  const response = await enter({ env: {}, request: request('/api/recipes') });
  assert.equal(response.status, 401);
});
test('anonymous, reader-only and forged requests cannot create posts', async () => {
  const env = makeEnv(), data = { title: '제목', body: '내용' };
  const call = cookie => posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie, data }) });
  assert.equal((await call('')).status, 403);
  assert.equal((await call(await loginViewer(env))).status, 403);
  assert.equal((await call('recipe_admin=admin.9999999999.fake.fake')).status, 403);
  assert.equal((await call('role=admin')).status, 403);
});
test('operator account is required and old password cookies cannot grant publishing', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  const wrong = await admin({ env, request: request('/api/recipe-admin', { method: 'POST', cookie: viewer, data: { password: env.RECIPE_PASSWORD } }) });
  assert.equal(wrong.status, 403);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: viewer }), env, 'admin'), false);
  const promoted = viewer.replaceAll('viewer', 'admin');
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: promoted }), env, 'admin'), false);
  const same = { ...env, RECIPE_ADMIN_PASSWORD: env.RECIPE_PASSWORD };
  assert.equal((await admin({ env: same, request: request('/api/recipe-admin', { method: 'POST', cookie: await loginViewer(same), data: { password: same.RECIPE_ADMIN_PASSWORD } }) })).status, 403);
});
test('owner writes persist in SQLite, readers can read posts and protected images', async t => {
  const env = makeEnv(), viewer = await loginViewer(env), owner = await loginAdmin(env, viewer);
  operator(t, env); const memberCookie = owner + '; __Host-member-access=verified';
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2y3sAAAAASUVORK5CYII=';
  const data = { title: '한식 레시피', body: '<script>literal text</script>\n재료와 순서', image: { type: 'image/png', base64 } };
  const created = await posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie: memberCookie, data }) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  const listing = await posts({ env, request: request('/api/recipe-posts', { cookie: viewer }) });
  const list = await listing.json(); assert.equal(list.posts.length, 1); assert.equal(list.posts[0].body, data.body);
  assert.equal(list.posts[0].image_url, '/api/recipe-image?id=' + id); assert.equal(list.posts[0].image_base64, undefined);
  assert.equal((await image({ env, request: request('/api/recipe-image?id=' + id) })).status, 403);
  const photo = await image({ env, request: request('/api/recipe-image?id=' + id, { cookie: viewer }) });
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('Content-Type'), 'image/png');
  assert.equal(new Uint8Array(await photo.arrayBuffer())[0], 137);
});
test('write and owner login reject cross-origin and invalid image payloads', async () => {
  const env = makeEnv(), owner = await loginAdmin(env, await loginViewer(env));
  assert.equal((await posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie: owner, origin: 'https://other.example', data: { title: 'x', body: 'y' } }) })).status, 403);
  assert.throws(() => validatePost({ title: 'x', body: 'y', image: { type: 'image/png', base64: btoa('<script>not an image</script>') } }));
  assert.throws(() => validatePost({ title: '', body: 'y' }));
  assert.throws(() => validatePost({ title: 'x', body: 'y', image: { type: 'image/png', base64: 'A'.repeat(1398108) } }));
});
test('recipe categories, literal search, and safe non-image downloads persist', async t => {
  const env = makeEnv(), viewer = await loginViewer(env), owner = await loginAdmin(env, viewer);
  operator(t, env); const memberCookie = owner + '; __Host-member-access=verified';
  const pdf = btoa('%PDF-1.7\nrecipe attachment');
  const created = await posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie: memberCookie, data: {
    category: '베이커리', title: '검색 가능한 식빵', body: '밀가루와 우유', attachment: { name: '식빵.pdf', type: 'application/pdf', base64: pdf }
  } }) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  const searchPath = '/api/recipe-posts?q=' + encodeURIComponent('식빵') + '&category=' + encodeURIComponent('베이커리');
  const found = await posts({ env, request: request(searchPath, { cookie: viewer }) });
  const result = await found.json(); assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].category, '베이커리'); assert.equal(result.posts[0].attachment_name, '식빵.pdf');
  assert.equal(result.posts[0].downloads, 0);
  assert.equal((await file({ env, request: request('/api/recipe-file?id=' + id) })).status, 403);
  const download = await file({ env, request: request('/api/recipe-file?id=' + id, { cookie: viewer }) });
  assert.equal(download.status, 200); assert.equal(download.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(download.headers.get('X-Recipe-Downloads'), '1');
  const again = await file({ env, request: request('/api/recipe-file?id=' + id, { cookie: viewer }) });
  assert.equal(again.headers.get('X-Recipe-Downloads'), '2');
  assert.equal((await file({ env, request: request('/api/recipe-file?id=999999', { cookie: viewer }) })).status, 404);
  const counted = await posts({ env, request: request(searchPath, { cookie: viewer }) });
  assert.equal((await counted.json()).posts[0].downloads, 2);
  assert.match(download.headers.get('Content-Disposition'), /filename\*=UTF-8''/); assert.equal(new TextDecoder().decode(await download.arrayBuffer()), '%PDF-1.7\nrecipe attachment');
  assert.throws(() => validatePost({ category: '기타', title: 'x', body: 'y' }));
  assert.throws(() => validatePost({ category: '한식', title: 'x', body: 'y', attachment: { name: 'bad.pdf', type: 'application/pdf', base64: btoa('<html>') } }));
});
test('membership grants viewing independently of legacy password cookies and secrets', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: 'recipe_viewer=forged' }), env), false);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: viewer }), { ...env, RECIPE_PASSWORD: undefined, RECIPE_ADMIN_PASSWORD: undefined }), true);
  const response = await enter({ env, request: request('/api/recipes', { method: 'DELETE', cookie: viewer }) });
  assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 2);
  for (const cookie of response.headers.getSetCookie()) assert.ok(cookie.includes('Max-Age=0'));
  const ownerCookie = await sessionCookie(env, 'admin');
  assert.ok(ownerCookie.includes('HttpOnly; Secure; SameSite=Strict'));
});
test('pagination preserves older posts and missing storage cannot report successful upload', async t => {
  const env = makeEnv(), viewer = await loginViewer(env);
  for (let i = 0; i < 22; i++) await env.MEMBERS_DB.prepare('INSERT INTO recipe_posts (title, body, created_at) VALUES (?, ?, ?)').bind('Post '+i, 'body', new Date().toISOString()).run();
  const page = await posts({ env, request: request('/api/recipe-posts', { cookie: viewer }) }); const first = await page.json();
  assert.equal(first.posts.length, 10); assert.equal(first.total, 22); assert.equal(first.totalPages, 3); assert.equal(first.page, 1);
  const second = await posts({ env, request: request('/api/recipe-posts?page=2', { cookie: viewer }) });
  const middle = await second.json(); assert.equal(middle.posts.length, 10); assert.equal(middle.page, 2);
  const last = await (await posts({ env, request: request('/api/recipe-posts?page=3', { cookie: viewer }) })).json();
  assert.equal(last.posts.length, 2); assert.equal(last.posts[1].title, 'Post 0');
  assert.equal(new Set([...first.posts, ...middle.posts, ...last.posts].map(p => p.id)).size, 22);
  const searched = await (await posts({ env, request: request('/api/recipe-posts?q=Post%200', { cookie: viewer }) })).json();
  assert.equal(searched.posts.length, 1); assert.equal(searched.posts[0].title, 'Post 0'); assert.equal(searched.totalPages, 1);
  const searchPage = await (await posts({ env, request: request('/api/recipe-posts?q=Post&page=2', { cookie: viewer }) })).json();
  assert.equal(searchPage.posts.length, 10); assert.equal(searchPage.total, 22);
  for (const invalid of ['0', '-1', 'abc', '1.5', '9007199254740992']) {
    assert.equal((await posts({ env, request: request('/api/recipe-posts?page=' + invalid, { cookie: viewer }) })).status, 400);
  }
  const clamped = await (await posts({ env, request: request('/api/recipe-posts?page=99', { cookie: viewer }) })).json();
  assert.equal(clamped.page, 3); assert.equal(clamped.posts.length, 2);
  const owner = await loginAdmin(env, viewer);
  operator(t, env); const memberCookie = owner + '; __Host-member-access=verified';
  assert.equal((await posts({ env: { ...env, MEMBERS_DB: undefined }, request: request('/api/recipe-posts', { method: 'POST', cookie: memberCookie, data: { title: 'x', body: 'y' } }) })).status, 503);
});

test('writer password alone cannot publish a recipe without the operator account', async () => {
  const env = makeEnv(), owner = await loginAdmin(env, await loginViewer(env));
  const response = await posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie: owner, data: { title: 'Forbidden', body: 'No operator login' } }) });
  assert.equal(response.status, 403);
});

test('existing recipes gain a persistent download counter without losing content', async () => {
  const db = new D1();
  await db.prepare('CREATE TABLE recipe_posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, image_base64 TEXT, image_type TEXT, created_at TEXT NOT NULL)').run();
  await db.prepare("INSERT INTO recipe_posts (id,title,body,created_at) VALUES (1,'기존 레시피','재료와 조리법','2026-10-08T00:00:00Z')").run();
  await ensurePosts(db);
  assert.equal((await listPosts(db)).posts[0].downloads, 0);
  assert.equal((await listPosts(db)).posts[0].comment_count, 0);
  await db.prepare("INSERT INTO recipe_comments (post_id,author_id,author,body,created_at) VALUES (1,'member','회원','댓글','2026-10-09T00:00:00Z')").run();
  assert.equal((await listPosts(db)).posts[0].comment_count, 1);
  await db.prepare('DELETE FROM recipe_comments WHERE post_id = 1').run();
  assert.equal((await listPosts(db)).posts[0].comment_count, 0);
  await db.prepare('UPDATE recipe_posts SET downloads = downloads + 1 WHERE id = 1').run();
  await ensurePosts(db);
  const post = (await listPosts(db)).posts[0];
  assert.equal(post.downloads, 1); assert.equal(post.title, '기존 레시피'); assert.equal(post.body, '재료와 조리법');
});

test('recipe sorting applies before pagination and preserves search and category filters', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  const titles = ['하', '파', '타', '카', '차', '자', '아', '사', '바', '마', '라', '다', '나', '가'];
  for (let i = 0; i < titles.length; i++) {
    await env.MEMBERS_DB.prepare('INSERT INTO recipe_posts (title,body,category,downloads,created_at) VALUES (?,?,?,?,?)')
      .bind(titles[i] + ' 레시피', '공통 검색', i % 2 ? '한식' : '베이커리', i % 4, '2026-10-08T00:00:00Z').run();
  }
  const get = async query => (await posts({ env, request: request('/api/recipe-posts?' + query, { cookie: viewer }) })).json();
  const alphabetical = [...(await get('sort=title')).posts, ...(await get('sort=title&page=2')).posts];
  assert.deepEqual(alphabetical.map(p => p.title), [...titles].reverse().map(t => t + ' 레시피'));
  const popular = [...(await get('sort=downloads')).posts, ...(await get('sort=downloads&page=2')).posts];
  assert.equal(popular.length, 14);
  for (let i = 1; i < popular.length; i++) {
    assert.ok(popular[i - 1].downloads >= popular[i].downloads);
    if (popular[i - 1].downloads === popular[i].downloads) assert.ok(popular[i - 1].id > popular[i].id);
  }
  const filtered = await get('sort=title&q=' + encodeURIComponent('공통') + '&category=' + encodeURIComponent('한식'));
  assert.equal(filtered.total, 7); assert.ok(filtered.posts.every(p => p.category === '한식'));
  assert.deepEqual(filtered.posts.map(p => p.title), alphabetical.filter(p => p.category === '한식').map(p => p.title));
  assert.equal((await posts({ env, request: request('/api/recipe-posts?sort=invalid', { cookie: viewer }) })).status, 400);
});
