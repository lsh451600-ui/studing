import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVideo, onRequest } from '../functions/api/trend-video.js';
const now = Date.now();
const secret = 'private-youtube-key';
const request = new Request('https://example.test/api/trend-video');
const video = (id, views, extra = {}) => ({ id, statistics: { viewCount: String(views) }, status: { embeddable: true, privacyStatus: 'public' }, snippet: { title: 'Dining trends', channelTitle: 'Journal', publishedAt: new Date(now - 86400000).toISOString(), liveBroadcastContent: 'none' }, ...extra });
function mockYoutube(t, items) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(new URL(url));
    return Response.json(url.pathname.endsWith('/search') ? { items: items.map(v => ({ id: { videoId: v.id } })) } : { items });
  });
  return calls;
}
function database(saved = {}) {
  const row = { payload: null, fetched_at: 0, retry_after: 0, lease_until: 0, ...saved };
  return { row, prepare(sql) {
    let args;
    return { bind(...values) { args = values; return this; }, async first() {
      if (sql.startsWith('SELECT')) return { ...row };
      if (sql.includes('RETURNING')) {
        if (row.lease_until >= args[2] || row.retry_after > args[3]) return null;
        row.lease_until = args[0]; return { id: args[1] };
      }
      throw new Error('Unexpected query');
    }, async run() {
      if (sql.includes('SET payload')) Object.assign(row, sql.includes('fetched_at = 0')
        ? { payload: args[0], fetched_at: 0, retry_after: args[1], lease_until: 0 }
        : { payload: args[0], fetched_at: args[1], retry_after: 0, lease_until: 0 });
      if (sql.includes('SET retry_after')) Object.assign(row, { retry_after: args[0], lease_until: 0 });
      return { success: true };
    } };
  } };
}
test('search bounds recent embeddable videos and ranks validated details by views', async t => {
  const items = [video('aaaaaaaaaaa', 10), video('bbbbbbbbbbb', 500), video('ccccccccccc', 9999, { status: { embeddable: false, privacyStatus: 'public' } }), video('ddddddddddd', 99999, { snippet: { title: 'Old', publishedAt: new Date(now - 31 * 86400000).toISOString() } }), video('eeeeeeeeeee', 999999, { snippet: { title: 'Live', publishedAt: new Date(now - 1000).toISOString(), liveBroadcastContent: 'live' } })];
  const calls = mockYoutube(t, items);
  assert.equal((await selectVideo(secret, now)).id, 'bbbbbbbbbbb');
  assert.equal(calls[0].searchParams.get('order'), 'viewCount');
  assert.equal(calls[0].searchParams.get('videoEmbeddable'), 'true');
  assert.equal(calls[0].searchParams.get('publishedAfter'), new Date(now - 30 * 86400000).toISOString());
  assert.equal(calls.length, 2);
});
test('missing key and unsupported methods never call upstream or expose secrets', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected fetch'); });
  assert.deepEqual(await (await onRequest({ request, env: {} })).json(), { available: false, reason: 'setup_required' });
  assert.equal((await onRequest({ request: new Request(request.url, { method: 'POST' }), env: { YOUTUBE_API_KEY: secret } })).status, 405);
  const response = await onRequest({ request, env: { YOUTUBE_API_KEY: secret } });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(secret));
});
test('shared cache refreshes once and serves fresh result without upstream calls', async t => {
  const calls = mockYoutube(t, [video('bbbbbbbbbbb', 500)]);
  const db = database();
  const env = { MEMBERS_DB: db, YOUTUBE_API_KEY: secret };
  const first = await (await onRequest({ request, env })).json();
  const second = await (await onRequest({ request, env })).json();
  assert.equal(first.video.id, 'bbbbbbbbbbb');
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(first).includes(secret));
});
test('active lease or retry cooldown serves stale result without extra search', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected fetch'); });
  for (const lock of [{ lease_until: Date.now() + 60000 }, { retry_after: Date.now() + 60000 }]) {
    const db = database({ payload: JSON.stringify({ id: 'bbbbbbbbbbb' }), fetched_at: Date.now() - 3600000, ...lock });
    const result = await (await onRequest({ request, env: { MEMBERS_DB: db, YOUTUBE_API_KEY: secret } })).json();
    assert.equal(result.stale, true);
    assert.equal(result.video.id, 'bbbbbbbbbbb');
  }
});
test('upstream errors are redacted, release lease and install retry cooldown', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error(secret); });
  const db = database();
  const result = await (await onRequest({ request, env: { MEMBERS_DB: db, YOUTUBE_API_KEY: secret } })).text();
  assert.equal(JSON.parse(result).available, false);
  assert.ok(!result.includes(secret));
  assert.equal(db.row.lease_until, 0);
  assert.ok(db.row.retry_after > Date.now());
});
test('empty search results produce a placeholder and cooldown', async t => {
  const calls = mockYoutube(t, []);
  const db = database();
  const result = await (await onRequest({ request, env: { MEMBERS_DB: db, YOUTUBE_API_KEY: secret } })).json();
  assert.equal(result.available, false);
  assert.equal(calls.length, 1);
  assert.ok(db.row.retry_after > Date.now());
});
test('expired stale cache is withheld during refresh failure', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('outage'); });
  const db = database({ payload: JSON.stringify({ id: 'bbbbbbbbbbb' }), fetched_at: Date.now() - 8 * 86400000 });
  const result = await (await onRequest({ request, env: { MEMBERS_DB: db, YOUTUBE_API_KEY: secret } })).json();
  assert.equal(result.available, false);
  assert.equal(result.video, undefined);
});
function edgeCache(t) {
  const entries = new Map(), keys = [], writes = [];
  const cache = {
    async match(key) { keys.push(key.url); const item = entries.get(key.url); return item && item.expires > Date.now() ? item.response.clone() : undefined; },
    async put(key, response) {
      const seconds = Number(response.headers.get('Cache-Control').match(/max-age=(\d+)/)[1]);
      writes.push(seconds); entries.set(key.url, { response: response.clone(), expires: Date.now() + seconds * 1000 });
    }
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: cache } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor); else delete globalThis.caches; });
  return { entries, keys, writes, cache };
}
test('missing D1 uses edge cache and isolates key fingerprints without leaking keys', async t => {
  const edge = edgeCache(t), calls = mockYoutube(t, [video('bbbbbbbbbbb', 500)]);
  const first = await onRequest({ request, env: { YOUTUBE_API_KEY: secret } });
  const second = await onRequest({ request, env: { YOUTUBE_API_KEY: secret } });
  assert.equal((await first.json()).available, true);
  assert.equal((await second.json()).video.id, 'bbbbbbbbbbb');
  assert.equal(calls.length, 2);
  const different = await onRequest({ request, env: { YOUTUBE_API_KEY: 'different-private-key' } });
  assert.equal((await different.json()).available, true);
  assert.equal(calls.length, 4);
  assert.equal(new Set(edge.keys).size, 2);
  assert.deepEqual(edge.writes, [1800, 1800]);
  assert.ok(edge.keys.every(key => !key.includes(secret) && !key.includes('different-private-key')));
});
test('edge failures cache a safe reason for five minutes and retry after expiry', async t => {
  const edge = edgeCache(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { message: secret, errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }); });
  for (let i = 0; i < 2; i++) {
    const response = await onRequest({ request, env: { YOUTUBE_API_KEY: secret } });
    assert.deepEqual(await response.json(), { available: false, reason: 'quota_exceeded' });
  }
  assert.equal(calls, 1); assert.deepEqual(edge.writes, [300]);
  for (const item of edge.entries.values()) item.expires = 0;
  assert.equal((await (await onRequest({ request, env: { YOUTUBE_API_KEY: secret } })).json()).reason, 'quota_exceeded');
  assert.equal(calls, 2);
});
test('broken D1 falls back to an edge-cached successful lookup', async t => {
  edgeCache(t); const calls = mockYoutube(t, [video('bbbbbbbbbbb', 500)]);
  const db = { prepare() { throw new Error('D1 unavailable'); } };
  const result = await (await onRequest({ request, env: { MEMBERS_DB: db, YOUTUBE_API_KEY: secret } })).json();
  assert.equal(result.video.id, 'bbbbbbbbbbb'); assert.equal(calls.length, 2);
});
test('classified provider failures persist safely across D1 cooldown requests', async t => {
  const cases = [
    ['keyInvalid', 'api_key_invalid', 'errors'], ['API_KEY_INVALID', 'api_key_invalid', 'details'],
    ['accessNotConfigured', 'api_not_enabled', 'errors'], ['SERVICE_DISABLED', 'api_not_enabled', 'details'],
    ['ipRefererBlocked', 'api_key_restricted', 'errors'], ['API_KEY_HTTP_REFERRER_BLOCKED', 'api_key_restricted', 'details'],
    ['quotaExceeded', 'quota_exceeded', 'errors']
  ];
  let calls = 0, current;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; return Response.json({ error: { message: secret, [current[2]]: [{ reason: current[0], metadata: { apiKey: secret } }] } }, { status: 403 });
  });
  for (const item of cases) {
    current = item; const db = database(), env = { MEMBERS_DB: db, YOUTUBE_API_KEY: secret }, before = calls;
    for (let i = 0; i < 2; i++) {
      const response = await onRequest({ request, env }); const text = await response.text();
      assert.deepEqual(JSON.parse(text), { available: false, reason: item[1] }); assert.ok(!text.includes(secret));
    }
    assert.equal(calls, before + 1);
    assert.deepEqual(JSON.parse(db.row.payload), { failure: item[1] });
    assert.ok(!db.row.payload.includes(secret)); assert.equal(db.row.fetched_at, 0);
  }
});
test('edge requests in flight share a lookup and return independently readable responses', async t => {
  edgeCache(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json(url.pathname.endsWith('/search') ? { items: [{ id: { videoId: 'bbbbbbbbbbb' } }] } : { items: [video('bbbbbbbbbbb', 500)] });
  });
  const results = await Promise.all(Array.from({ length: 5 }, async () => (await onRequest({ request, env: { YOUTUBE_API_KEY: secret } })).json()));
  assert.ok(results.every(result => result.video.id === 'bbbbbbbbbbb')); assert.equal(calls, 2);
});
test('edge cache outages do not discard a successfully fetched video', async t => {
  const edge = edgeCache(t); mockYoutube(t, [video('bbbbbbbbbbb', 500)]);
  edge.cache.match = async () => { throw new Error('cache read failure'); };
  edge.cache.put = async () => { throw new Error('cache write failure'); };
  const result = await (await onRequest({ request, env: { YOUTUBE_API_KEY: secret } })).json();
  assert.equal(result.available, true); assert.equal(result.video.id, 'bbbbbbbbbbb');
});
