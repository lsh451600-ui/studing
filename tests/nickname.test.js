import test from 'node:test';
import assert from 'node:assert/strict';
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
