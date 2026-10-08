import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as account } from '../functions/api/account.js';
import { onRequest as forgot } from '../functions/api/forgot-password.js';
import { onRequest as reset } from '../functions/api/reset-password.js';
import { onRequest as confirm } from '../functions/api/auth-confirm.js';
import { onRequest as middleware } from '../functions/_middleware.js';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const user = { id: 'member-one', email: 'member@example.com', user_metadata: { username: 'tester' }, identities: [{ provider: 'email' }], created_at: '2026-01-01T00:00:00Z' };
const limit = { path: 'member_auth_limit', data: true };
const jwt = (method, age = 1000) => 'header.' + Buffer.from(JSON.stringify({ sub: user.id, amr: [{ method, timestamp: Math.floor((Date.now() - age) / 1000) }] })).toString('base64url') + '.signature';
const token = jwt('recovery');
function request(path, method = 'POST', body = {}, headers = {}) {
  return new Request('https://studing.pages.dev' + path, { method, headers: { Origin: 'https://studing.pages.dev', 'Content-Type': 'application/json', Cookie: '__Host-member-access=session-token', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
function mock(t, steps) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const step = steps[calls++]; assert.ok(step, 'Unexpected upstream call: ' + new URL(url).pathname);
    assert.ok(url.includes(step.path)); step.check?.(options, url);
    return new Response(JSON.stringify(step.data ?? {}), { status: step.status ?? 200 });
  });
  return () => assert.equal(calls, steps.length);
}
test('account data comes only from the verified user and own profile', async t => {
  const done = mock(t, [{ path: '/auth/v1/user', data: user }, { path: '/member_profiles', data: [{ username: 'tester', phone: '01012345678' }], check: (o, url) => { assert.ok(url.endsWith('id=eq.member-one')); assert.equal(o.headers.Authorization, 'Bearer session-token'); } }]);
  const response = await account({ env, request: request('/api/account?id=someone-else', 'GET') });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  const data = await response.json(); assert.equal(data.account.email, user.email); assert.equal(data.account.phone, '01012345678');
  assert.ok(!JSON.stringify(data).includes('session-token')); done();
});
test('anonymous account access and protected mypage require login', async t => {
  const req = request('/api/account', 'GET', {}, { Cookie: '' });
  const done = mock(t, []);
  assert.equal((await account({ env, request: req })).status, 401);
  const response = await middleware({ env, request: request('/mypage', 'GET', {}, { Cookie: '' }), next: () => { throw new Error('Private page exposed'); } });
  assert.equal(response.status, 302); assert.equal(new URL(response.headers.get('Location')).searchParams.get('next'), '/mypage'); done();
});
test('all account mutation endpoints reject foreign origins before touching upstream', async t => {
  const done = mock(t, []);
  for (const [handler, path, method] of [[account, '/api/account', 'DELETE'], [forgot, '/api/forgot-password', 'POST'], [reset, '/api/reset-password', 'POST']])
    assert.equal((await handler({ env, request: request(path, method, {}, { Origin: 'https://evil.example' }) })).status, 403);
  done();
});
test('withdrawal requires the exact explicit confirmation and a valid password', async t => {
  const done = mock(t, [{ path: '/user', data: user }, { path: '/user', data: user }, limit, { path: 'grant_type=password', status: 400 }]);
  assert.equal((await account({ env, request: request('/api/account', 'DELETE', { confirmation: 'yes', password: 'wrong' }) })).status, 400);
  const response = await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴', password: 'wrong' }) });
  assert.equal(response.status, 401); assert.equal(response.headers.get('Set-Cookie'), null); done();
});
test('withdrawal deletes only the session owner with the server key and clears all cookies', async t => {
  const done = mock(t, [{ path: '/user', data: user }, limit, { path: 'grant_type=password', data: { user }, check: o => assert.equal(JSON.parse(o.body).email, user.email) },
    { path: '/admin/users/member-one', check: o => { assert.equal(o.method, 'DELETE'); assert.equal(o.headers.apikey, env.SUPABASE_SECRET_KEY); assert.deepEqual(JSON.parse(o.body), { should_soft_delete: false }); } }]);
  const response = await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴', password: 'correct-password', id: 'victim' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).authenticated, false);
  assert.equal(response.headers.getSetCookie().length, 4); assert.ok(response.headers.getSetCookie().every(cookie => cookie.includes('Max-Age=0'))); done();
});
test('withdrawal never deletes when password verification belongs to another user', async t => {
  const done = mock(t, [{ path: '/user', data: user }, limit, { path: 'grant_type=password', data: { user: { id: 'other' } } }]);
  assert.equal((await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴', password: 'password' }) })).status, 401); done();
});
test('stale social login requires reauthentication before withdrawal', async t => {
  const done = mock(t, [{ path: '/user', data: { ...user, identities: [{ provider: 'kakao' }], last_sign_in_at: new Date(Date.now() - 11 * 60000).toISOString() } }, limit]);
  assert.equal((await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴' }, { Cookie: '__Host-member-access=' + jwt('oauth', 11 * 60000) }) })).status, 409); done();
});
test('recent social login can withdraw without a nonexistent local password', async t => {
  const done = mock(t, [{ path: '/user', data: { ...user, identities: [{ provider: 'google' }], last_sign_in_at: new Date(Date.now() - 1000).toISOString() } }, limit, { path: '/admin/users/member-one' }]);
  assert.equal((await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴' }, { Cookie: '__Host-member-access=' + jwt('oauth') }) })).status, 200); done();
});
test('failed deletion retains session and reports failure', async t => {
  const done = mock(t, [{ path: '/user', data: user }, limit, { path: 'grant_type=password', data: { user } }, { path: '/admin/users/', status: 500 }]);
  const response = await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴', password: 'password' }) });
  assert.equal(response.status, 503); assert.equal(response.headers.get('Set-Cookie'), null); done();
});
test('username recovery resolves email server-side and fixes the redirect to this site', async t => {
  const done = mock(t, [limit, { path: 'resolve_member_login', data: 'private@example.com', check: o => assert.equal(o.headers.apikey, env.SUPABASE_SECRET_KEY) },
    { path: '/recover?', check: (o, url) => { assert.equal(new URL(url).searchParams.get('redirect_to'), 'https://studing.pages.dev/reset-password'); assert.deepEqual(JSON.parse(o.body), { email: 'private@example.com' }); } }]);
  const response = await forgot({ env, request: request('/api/forgot-password', 'POST', { identifier: 'tester', redirect: 'https://evil.example' }) });
  assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('private@example.com')); done();
});
test('unknown username and known account return identical recovery responses', async t => {
  const done = mock(t, [limit, { path: 'resolve_member_login', data: null }, limit, { path: '/recover', data: {} }]);
  const unknown = await forgot({ env, request: request('/api/forgot-password', 'POST', { identifier: 'unknown' }) });
  const known = await forgot({ env, request: request('/api/forgot-password', 'POST', { identifier: 'member@example.com' }) });
  assert.equal(await unknown.text(), await known.text()); done();
});
test('recovery rate limits stop email delivery', async t => {
  const done = mock(t, [{ path: 'member_auth_limit', data: false }]);
  assert.equal((await forgot({ env, request: request('/api/forgot-password', 'POST', { identifier: 'tester' }) })).status, 429); done();
});
test('password reset requires an email-link token even when already logged in', async t => {
  const done = mock(t, []);
  assert.equal((await reset({ env, request: request('/api/reset-password', 'POST', { password: 'new-strong-password' }) })).status, 401);
  assert.equal((await reset({ env, request: request('/api/reset-password', 'POST', { password: 'short', accessToken: token }) })).status, 400); done();
});
test('expired recovery tokens cannot change a password', async t => {
  const done = mock(t, [limit, { path: '/verify', status: 403 }]);
  assert.equal((await reset({ env, request: request('/api/reset-password', 'POST', { password: 'new-strong-password', tokenHash: 'a'.repeat(40) }) })).status, 401); done();
});
test('recovery hash verifies as recovery, updates only the verified user and revokes sessions', async t => {
  const done = mock(t, [limit, { path: '/verify', data: { access_token: token }, check: o => assert.equal(JSON.parse(o.body).type, 'recovery') },
    { path: '/user', data: user }, { path: '/user', check: o => { assert.equal(o.method, 'PUT'); assert.equal(o.headers.Authorization, 'Bearer ' + token); assert.deepEqual(JSON.parse(o.body), { password: 'new-strong-password' }); } }, { path: '/logout?scope=global' }]);
  const response = await reset({ env, request: request('/api/reset-password', 'POST', { password: 'new-strong-password', tokenHash: 'a'.repeat(40), id: 'victim' }) });
  assert.equal(response.status, 200); const text = await response.text(); assert.ok(!text.includes(token)); assert.ok(!text.includes('new-strong-password'));
  assert.equal(response.headers.getSetCookie().length, 2); done();
});
test('default email fragment access token is validated remotely before password update', async t => {
  const done = mock(t, [limit, { path: '/user', data: user }, { path: '/user' }, { path: '/logout?scope=global' }]);
  assert.equal((await reset({ env, request: request('/api/reset-password', 'POST', { password: 'new-strong-password', accessToken: token }) })).status, 200); done();
});
test('recovery email scanners do not consume the one-use hash on GET', async t => {
  const done = mock(t, []);
  const response = await confirm({ env, request: request('/api/auth-confirm?type=recovery&token_hash=' + 'a'.repeat(40), 'GET') });
  assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), '/reset-password?token_hash=' + 'a'.repeat(40)); done();
});

test('a refreshed token cannot turn an old social login into recent proof', async t => {
  const done = mock(t, [{ path: '/user', data: { ...user, identities: [{ provider: 'google' }], last_sign_in_at: new Date().toISOString() } }, limit]);
  const access = 'header.' + Buffer.from(JSON.stringify({ sub: user.id, iat: Math.floor(Date.now() / 1000), amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) - 7200 }, { method: 'token_refresh', timestamp: Math.floor(Date.now() / 1000) }] })).toString('base64url') + '.signature';
  assert.equal((await account({ env, request: request('/api/account', 'DELETE', { confirmation: '회원탈퇴' }, { Cookie: '__Host-member-access=' + access }) })).status, 409); done();
});
test('an ordinary login token cannot be used as an emailed recovery link', async t => {
  const done = mock(t, [limit, { path: '/user', data: user }]);
  assert.equal((await reset({ env, request: request('/api/reset-password', 'POST', { password: 'new-strong-password', accessToken: jwt('password') }) })).status, 401); done();
});
