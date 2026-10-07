import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as enter } from '../functions/api/recipes.js';
import { onRequest as admin } from '../functions/api/recipe-admin.js';
import { onRequest as posts } from '../functions/api/recipe-posts.js';
import { onRequest as image } from '../functions/api/recipe-image.js';
import { authorized, validatePost, matchesPassword, sessionCookie } from '../src/recipe-server.js';
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
const cookieOf = response => response.headers.getSetCookie().filter(c => !c.includes('Max-Age=0')).map(c => c.split(';')[0]).join('; ');
async function loginViewer(env) {
  const response = await enter({ env, request: request('/api/recipes', { method: 'POST', data: { password: env.RECIPE_PASSWORD } }) });
  assert.equal(response.status, 200); return cookieOf(response);
}
async function loginAdmin(env, viewer) {
  const response = await admin({ env, request: request('/api/recipe-admin', { method: 'POST', cookie: viewer, data: { password: env.RECIPE_ADMIN_PASSWORD } }) });
  assert.equal(response.status, 200); return viewer + '; ' + cookieOf(response);
}
test('exact passwords and missing configuration fail closed', async () => {
  assert.equal(await matchesPassword('0018', '18'), false);
  assert.equal((await enter({ env: {}, request: request('/api/recipes', { method: 'POST', data: { password: '0018' } }) })).status, 503);
  const response = await enter({ env: {}, request: request('/api/recipes') });
  assert.deepEqual(await response.json(), { available: false });
});
test('anonymous, reader-only and forged requests cannot create posts', async () => {
  const env = makeEnv(), data = { title: '제목', body: '내용' };
  const call = cookie => posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie, data }) });
  assert.equal((await call('')).status, 403);
  assert.equal((await call(await loginViewer(env))).status, 403);
  assert.equal((await call('recipe_admin=admin.9999999999.fake.fake')).status, 403);
  assert.equal((await call('role=admin')).status, 403);
});
test('separate owner authentication is required and cookies cannot be promoted', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  const wrong = await admin({ env, request: request('/api/recipe-admin', { method: 'POST', cookie: viewer, data: { password: env.RECIPE_PASSWORD } }) });
  assert.equal(wrong.status, 401);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: viewer }), env, 'admin'), false);
  const promoted = viewer.replaceAll('viewer', 'admin');
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: promoted }), env, 'admin'), false);
  const same = { ...env, RECIPE_ADMIN_PASSWORD: env.RECIPE_PASSWORD };
  assert.equal((await admin({ env: same, request: request('/api/recipe-admin', { method: 'POST', cookie: await loginViewer(same), data: { password: same.RECIPE_ADMIN_PASSWORD } }) })).status, 503);
});
test('owner writes persist in SQLite, readers can read posts and protected images', async () => {
  const env = makeEnv(), viewer = await loginViewer(env), owner = await loginAdmin(env, viewer);
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2y3sAAAAASUVORK5CYII=';
  const data = { title: '한식 레시피', body: '<script>literal text</script>\n재료와 순서', image: { type: 'image/png', base64 } };
  const created = await posts({ env, request: request('/api/recipe-posts', { method: 'POST', cookie: owner, data }) });
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
test('session tampering, secret rotation and logout are enforced', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: viewer + '0' }), env), false);
  assert.equal(await authorized(request('/api/recipe-posts', { cookie: viewer }), { ...env, RECIPE_PASSWORD: 'changed' }), false);
  const response = await enter({ env, request: request('/api/recipes', { method: 'DELETE', cookie: viewer }) });
  assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 2);
  for (const cookie of response.headers.getSetCookie()) assert.ok(cookie.includes('Max-Age=0'));
  const ownerCookie = await sessionCookie(env, 'admin');
  assert.ok(ownerCookie.includes('HttpOnly; Secure; SameSite=Strict'));
});
test('pagination preserves older posts and missing storage cannot report successful upload', async () => {
  const env = makeEnv(), viewer = await loginViewer(env);
  for (let i = 0; i < 22; i++) await env.MEMBERS_DB.prepare('INSERT INTO recipe_posts (title, body, created_at) VALUES (?, ?, ?)').bind('Post '+i, 'body', new Date().toISOString()).run();
  const page = await posts({ env, request: request('/api/recipe-posts', { cookie: viewer }) }); const first = await page.json();
  assert.equal(first.posts.length, 20); assert.equal(first.next, 3);
  const second = await posts({ env, request: request('/api/recipe-posts?before=3', { cookie: viewer }) });
  assert.equal((await second.json()).posts.length, 2);
  const owner = await loginAdmin(env, viewer);
  assert.equal((await posts({ env: { ...env, MEMBERS_DB: undefined }, request: request('/api/recipe-posts', { method: 'POST', cookie: owner, data: { title: 'x', body: 'y' } }) })).status, 503);
});
