import { onRequest as comments } from '../functions/api/private-comments.js';
import test from 'node:test';
import { onRequest as recipeEnter } from '../functions/api/recipes.js';
import { onRequest as recipePosts } from '../functions/api/recipe-posts.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as enter } from '../functions/api/private.js';
import { onRequest as admin } from '../functions/api/private-admin.js';
import { onRequest as posts } from '../functions/api/private-posts.js';
import { onRequest as file } from '../functions/api/private-file.js';
import { onRequest as image } from '../functions/api/private-image.js';
import { ensurePosts, validatePost } from '../src/private-server.js';
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
const makeEnv = () => ({ RECIPE_PASSWORD: '0018', RECIPE_ADMIN_PASSWORD: 'private-author-password-example', MEMBERS_DB: new D1() });
function request(path, { method = 'GET', data, cookie = '', origin = 'https://studing.pages.dev' } = {}) {
  const headers = { Cookie: cookie };
  if (method !== 'GET') { headers.Origin = origin; headers['Content-Type'] = 'application/json'; }
  return new Request('https://studing.pages.dev' + path, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}

function identity(t, operator = true) {
  t.mock.method(globalThis, 'fetch', async input => new URL(input).pathname === '/auth/v1/user' ? Response.json({ id: 'member-id' }) : Response.json([{ username: operator ? 'lsh451600' : 'member', nickname: '운영팀' }]));
}
const operatorEnv = () => ({ ...makeEnv(), SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret' });
const signed = '__Host-member-access=verified';
test('industry materials and images are readable without passwords while anonymous uploads fail', async t => {
  identity(t); const env = operatorEnv(); delete env.RECIPE_PASSWORD; delete env.RECIPE_ADMIN_PASSWORD;
  assert.equal((await enter({ env, request: request('/api/private') })).status, 200);
  const data = { title: '산업 자료', body: '공개 본문', image: { type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2y3sAAAAASUVORK5CYII=' } };
  assert.equal((await posts({ env, request: request('/api/private-posts', { method: 'POST', data }) })).status, 403);
  const created = await posts({ env, request: request('/api/private-posts', { method: 'POST', data, cookie: signed }) });
  assert.equal(created.status, 201); const id = (await created.json()).id;
  const listing = await (await posts({ env, request: request('/api/private-posts') })).json();
  assert.equal(listing.posts[0].title, data.title); assert.equal(listing.posts[0].canEdit, false); assert.equal(listing.posts[0].image_base64, undefined);
  assert.equal((await image({ env, request: request('/api/private-image?id=' + id) })).status, 200);
});
test('ordinary members and old admin password cookies cannot upload; cross-origin writes fail', async t => {
  identity(t, false); const env = operatorEnv(), data = { title: 'title', body: 'body' };
  for (const cookie of [signed, 'private_admin=admin.9999999999.fake.fake']) assert.equal((await posts({ env, request: request('/api/private-posts', { method: 'POST', data, cookie }) })).status, 403);
  assert.equal((await posts({ env, request: request('/api/private-posts', { method: 'POST', data, cookie: signed, origin: 'https://other.test' }) })).status, 403);
  assert.throws(() => validatePost({ title: 'x', body: 'y', image: { type: 'image/png', base64: btoa('invalid image') } }));
});
test('public search, pagination, sorting, migration and attachment counts preserve materials', async t => {
  identity(t); const env = operatorEnv(); await ensurePosts(env.MEMBERS_DB);
  for (let i = 0; i < 23; i++) await env.MEMBERS_DB.prepare('INSERT INTO private_posts (title,body,downloads,created_at) VALUES (?,?,?,?)').bind('자료 ' + String(i).padStart(2, '0'), '내용 ' + i, i, new Date().toISOString()).run();
  const get = async query => (await posts({ env, request: request('/api/private-posts?' + query) })).json();
  assert.equal((await get('')).posts.length, 10); assert.equal((await get('page=3')).posts.length, 3);
  assert.equal((await get('q=' + encodeURIComponent('자료 00'))).posts[0].id, 1);
  assert.equal((await get('sort=title')).posts[0].id, 1); assert.equal((await get('sort=downloads')).posts[0].downloads, 22);
  const data = { title: 'PDF 자료', body: '첨부', attachment: { name: '자료.pdf', type: 'application/pdf', base64: btoa('%PDF-1.7 test') } };
  const created = await posts({ env, request: request('/api/private-posts', { method: 'POST', data, cookie: signed }) }); assert.equal(created.status, 201);
  const id = (await created.json()).id;
  const download = await file({ env, request: request('/api/private-file?id=' + id) }); assert.equal(download.status, 200); assert.equal(download.headers.get('X-Recipe-Downloads'), '1');
  assert.equal((await get('')).posts[0].downloads, 1); assert.equal((await get('')).posts[0].attachment_name, '자료.pdf');
});

test('industry comments are public to read, require login to write and retain ownership checks', async t => {
  identity(t); const env = operatorEnv();
  const created = await posts({ env, request: request('/api/private-posts', { method: 'POST', cookie: signed, data: { title: '자료', body: '내용' } }) });
  const id = (await created.json()).id;
  const create = cookie => comments({ env, request: request('/api/private-comments', { method: 'POST', cookie, data: { postId: id, body: '자료 댓글' } }) });
  assert.equal((await create('')).status, 401);
  const added = await create(signed); assert.equal(added.status, 201); const commentId = (await added.json()).id;
  const listing = await (await comments({ env, request: request('/api/private-comments?postId=' + id) })).json();
  assert.equal(listing.comments[0].body, '자료 댓글'); assert.equal(listing.comments[0].canEdit, false); assert.equal(listing.comments[0].author_id, undefined);
  assert.equal((await (await posts({ env, request: request('/api/private-posts') })).json()).posts[0].comment_count, 1);
  assert.equal((await comments({ env, request: request('/api/private-comments?id=' + commentId, { method: 'PATCH', cookie: signed, data: { body: '수정 댓글' } }) })).status, 200);
  assert.equal((await comments({ env, request: request('/api/private-comments?id=' + commentId, { method: 'DELETE', cookie: signed }) })).status, 200);
  assert.equal((await (await posts({ env, request: request('/api/private-posts') })).json()).posts[0].comment_count, 0);
});
