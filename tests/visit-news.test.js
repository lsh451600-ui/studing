import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from '../src/news-snapshot.js';
import { collect, onRequest } from '../functions/api/trend-news.js';
const now = Date.parse('2026-10-07T15:01:00Z');
const item = (title, time, id) => `<item><title>${title} - 테스트신문</title><link>${String(id).startsWith('https://') ? id : 'https://news.google.com/rss/articles/' + id}</link><source>테스트신문</source><pubDate>${new Date(time).toUTCString()}</pubDate></item>`;
test('access cutoff excludes future and old articles, sorts, deduplicates and limits to six', () => {
  const xml = '<rss><channel>' + [
    item('외식 시장 미래 기사', now + 1000, 'future'), item('외식 시장 오래된 기사', now - 8 * 86400000, 'old'),
    item('외식 무료교육 시장', now - 1000, 'spam'), item('외식 시장 변화 0', now - 500, 'duplicate'),
    ...Array.from({ length: 8 }, (_, i) => item('외식 시장 변화 ' + i, now - (8 - i) * 1000, i))
  ].join('') + '</channel></rss>';
  const articles = collect(xml, now);
  assert.equal(articles.length, 6); assert.equal(articles[0].title, '외식 시장 변화 0');
  assert.equal(new Set(articles.map(a => a.title)).size, 6);
  assert.ok(articles.every((a, i) => !i || Date.parse(articles[i - 1].published_at) >= Date.parse(a.published_at)));
  assert.ok(!articles.some(a => /미래|오래된|무료교육/.test(a.title)));
});
test('every visit queries the feed without cache and reports actual request and collection times', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (new URL(input).host !== 'news.google.com') return new Response('', { status: 404 });
    calls++; assert.equal(new URL(input).host, 'news.google.com'); assert.equal(options.cache, undefined); assert.equal(options.cf.cacheTtl, 0);
    return new Response('<rss><channel>' + item('외식 시장 변화', Date.now() - 1000, snapshot.articles[0].url) + '</channel></rss>');
  });
  for (let i = 0; i < 2; i++) {
    const response = await onRequest({ request: new Request('https://example.test/api/trend-news') });
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
    const data = await response.json(); assert.equal(data.stale, false); assert.ok(data.articles.length >= 1);
    assert.ok(Date.parse(data.checkedAt) >= Date.parse(data.requestedAt));
  }
  assert.equal(calls, 2);
});
test('outages are labeled stale and never relabel old collection times as current', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
  assert.equal(data.stale, true); assert.equal(data.reason, 'news_unavailable');
  assert.notEqual(data.checkedAt, data.requestedAt);
});

 test('old Cloudflare runtimes never receive the unsupported cache property', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (new URL(input).host !== 'news.google.com') return new Response('', { status: 404 });
    calls++;
    if (options.cache) throw new Error("The 'cache' field on 'RequestInitializerDict' is not implemented.");
    assert.equal(options.cf.cacheTtl, 0); assert.equal(options.headers['Cache-Control'], 'no-cache');
    return new Response('<rss><channel>' + item('외식 시장 변화', Date.now() - 1000, snapshot.articles[0].url) + '</channel></rss>');
  });
  const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
  assert.equal(data.stale, false); assert.equal(calls, 1);
});
test('Google HTTP blocks and non-RSS responses have distinct diagnostics without raw messages', async t => {
  let response;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => response.clone());
  for (const [value, expected] of [[new Response('private text', { status: 403 }), 'NEWS-03'], [new Response('<html>private text</html>'), 'NEWS-04']]) {
    response = value;
    const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
    assert.equal(data.stale, true); assert.equal(data.failureCode, expected);
    assert.ok(!JSON.stringify(data).includes('private text'));
  }
});

test('network failure on the primary Google host retries the Korean Google host', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const host = new URL(input).host; if (host === 'github.com') return new Response('', { status: 404 }); calls.push(host);
    if (host === 'news.google.com') throw new TypeError('fetch failed');
    return new Response('<rss><channel>' + item('외식 시장 변화', Date.now() - 1000, snapshot.articles[0].url) + '</channel></rss>');
  });
  const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
  assert.equal(data.stale, false); assert.deepEqual(calls, ['news.google.com', 'news.google.co.kr']);
});

test('scheduled collection is served first without querying Google again', async t => {
  const collected = new Date(Date.now() - 120000).toISOString();
  t.mock.method(console, 'warn', () => {});
  let googleCalls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    if (new URL(input).host === 'github.com') return Response.json({ updated_at: collected, articles: [{ title: '외식 시장 변화', source: '테스트신문', url: 'https://news.google.com/rss/articles/today', published_at: collected, image: 'https://publisher.test/photo.jpg' }] });
    googleCalls++; return new Response('', { status: 503 });
  });
  const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
  assert.equal(data.sourceMode, 'scheduled'); assert.equal(data.stale, false); assert.equal(googleCalls, 0);
  assert.equal(data.checkedAt, collected); assert.ok(Date.parse(data.requestedAt) > Date.parse(collected));
});

test('scheduled news returns source links without copying publisher photos', async t => {
  const collected = new Date(Date.now() - 1000).toISOString();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ updated_at: collected, articles: [
    { ...snapshot.articles[2], image: undefined, published_at: collected },
    { title: '외식 시장 사진 없는 새 기사', source: '테스트', url: 'https://news.google.com/rss/articles/no-photo', published_at: collected }
  ] }));
  const data = await (await onRequest({ request: new Request('https://example.test/api/trend-news') })).json();
  assert.equal(data.sourceMode, 'scheduled'); assert.ok(data.articles.length >= 1);
  assert.equal(data.articles.find(a => a.url === snapshot.articles[2].url).image, undefined);
  assert.ok(data.articles.some(a => a.url.endsWith('/no-photo')));
  assert.equal(data.articles[0].image, undefined);
  assert.equal(data.articles[0].image_fallback, undefined);
});
