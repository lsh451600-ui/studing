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
      if (sql.includes('SET payload')) Object.assign(row, { payload: args[0], fetched_at: args[1], retry_after: 0, lease_until: 0 });
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
