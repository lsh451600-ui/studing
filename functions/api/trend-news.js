import { snapshot } from '../../src/news-snapshot.js';
const metadataOnly = article => Object.fromEntries(['title','source','url','original_url','published_at'].filter(key=>typeof article[key]==='string').map(key=>[key,article[key]]));
const QUERY = '외식 (트렌드 OR 소비 OR 가성비 OR 혼밥 OR 물가 OR 시장) -아카데미 -교육 -모집 when:7d';
function decode(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[code]) return named[code];
    const number = code.startsWith('#x') ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  }).trim();
}
export function collect(xml, now) {
  const articles = [], seen = new Set();
  const old = new Map(snapshot.articles.map(a => [a.url, a]));
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = tag => decode(match[1].match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1] || '');
    let title = field('title'); const url = field('link'), source = field('source'), published = Date.parse(field('pubDate'));
    let link; try { link = new URL(url); } catch { continue; }
    if (link.protocol !== 'https:' || link.hostname !== 'news.google.com' || !title || !source || !Number.isFinite(published) || published > now || published < now - 7 * 86400000) continue;
    if (!/외식|레스토랑|식당|프랜차이즈|음식점/.test(title) || !/트렌드|소비|물가|시장|열풍|확산|변화|증가|감소|성장|가성비|혼밥|식재료|산업/.test(title) || /아카데미|교육 모집|무료 교육|무료교육|맞춤형 교육|룰렛|카지노|슬롯|시어머니|며느리/.test(title)) continue;
    if (title.endsWith(' - ' + source)) title = title.slice(0, -source.length - 3);
    articles.push(metadataOnly({ ...old.get(url), title, url, source, published_at: new Date(published).toISOString() }));
  }
  return articles.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).filter(a => {
    const key = a.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 6);
}
async function loadRelay(now) {
  try {
    const response = await fetch('https://github.com/lsh451600-ui/studing/releases/download/live-news-feed/news.json', {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8000), cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) return null;
    const text = await response.text(); if (text.length > 2000000) return null;
    const data = JSON.parse(text), checked = Date.parse(data.updated_at);
    if (!Number.isFinite(checked) || checked > now || now - checked > 86400000 || !Array.isArray(data.articles)) return null;
    const articles = [...data.articles, ...snapshot.articles].filter(a => {
      try { const url = new URL(a.url); return url.protocol === 'https:' && url.hostname === 'news.google.com' && typeof a.title === 'string' && typeof a.source === 'string' && Date.parse(a.published_at) <= now && Date.parse(a.published_at) >= now - 7 * 86400000; } catch { return false; }
    }).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).map(metadataOnly).filter((a, index, all) => all.findIndex(other => other.url === a.url) === index).slice(0, 6);
    return articles.length ? { articles, checkedAt: data.updated_at } : null;
  } catch { return null; }
}
async function fetchFeed(url) {
  let lastError;
  for (const host of ['news.google.com', 'news.google.co.kr']) {
    const target = new URL(url); target.hostname = host;
    try {
      // Headers and cf options also work with older Workers compatibility dates.
      const response = await fetch(target.href, {
        method: 'GET', headers: { Accept: 'application/rss+xml, application/xml',
          'User-Agent': 'Mozilla/5.0 (compatible; DiningTrendJournal/1.0)',
          'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        signal: AbortSignal.timeout(7000), cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (response.ok) return response;
      lastError = Object.assign(new Error('feed'), { upstreamStatus: response.status });
    } catch (error) { lastError = error; }
  }
  throw lastError;
}
function diagnostic(error) {
  const message = error?.message || '';
  const code = error?.cause?.code || error?.code;
  return {
    errorType: ['TypeError', 'Error', 'TimeoutError', 'AbortError'].includes(error?.name) ? error.name : 'Other',
    networkCode: ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code) ? code : 'unknown',
    errorCategory: /cache.*(?:not implemented|unsupported)|unsupported cache mode/i.test(message) ? 'cache_unsupported'
      : /not implemented|not supported|is not a function/i.test(message) ? 'runtime_unsupported'
      : /dns|resolve|ENOTFOUND|EAI_AGAIN/i.test(message) ? 'dns'
      : /tls|ssl|certificate/i.test(message) ? 'tls'
      : /fetch failed|network|connection/i.test(message) ? 'connection' : 'unknown'
  };
}
export async function onRequest({ request }) {
  const version = 'news-network-v4';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
  if (request.method !== 'GET') return Response.json({ available: false }, { status: 405, headers });
  const now = Date.now(), requestedAt = new Date(now).toISOString();
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({ q: QUERY, hl: 'ko', gl: 'KR', ceid: 'KR:ko' }).toString();
  const relayLookup = loadRelay(now);
  const scheduled = await relayLookup;
  if (scheduled) return Response.json({ version, available: true, ...scheduled, requestedAt,
    stale: false, sourceMode: 'scheduled' }, { headers });
  let stage = 'fetch', upstreamStatus = null;
  try {
    const response = await fetchFeed(url.href);
    upstreamStatus = response.status;
    if (!response.ok) throw new Error('feed');
    stage = 'parse';
    const xml = await response.text(); if (xml.length > 2000000 || !/<rss\b/i.test(xml)) throw new Error('format');
    stage = 'filter';
    const articles = collect(xml, now); if (!articles.length) throw new Error('empty');
    return Response.json({ version, available: true, articles, requestedAt, checkedAt: new Date().toISOString(), stale: false }, { headers });
  } catch (error) {
    upstreamStatus = error?.upstreamStatus || upstreamStatus;
    const details = diagnostic(error);
    const relay = await relayLookup;
    const failureCode = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'NEWS-02' : upstreamStatus && upstreamStatus !== 200 ? 'NEWS-03' : stage === 'parse' ? 'NEWS-04' : stage === 'filter' ? 'NEWS-05' : 'NEWS-01';
    console.warn('news_fetch_failed', { stage, failureCode, upstreamStatus, ...details });
    if (relay) return Response.json({ version, available: true, ...relay, requestedAt, stale: true, sourceMode: 'relay', reason: 'news_unavailable', failureCode, upstreamStatus }, { headers });
    const articles = snapshot.articles.filter(a => Date.parse(a.published_at) <= now && Date.parse(a.published_at) >= now - 7 * 86400000).map(metadataOnly).slice(0, 6);
    return Response.json({ version, ...details, available: articles.length > 0, articles, requestedAt, checkedAt: snapshot.updated_at, stale: true, reason: 'news_unavailable', failureCode, upstreamStatus }, { headers });
  }
}
