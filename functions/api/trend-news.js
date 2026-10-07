import { snapshot } from '../../src/news-snapshot.js';
const QUERY = '외식 (트렌드 OR 소비 OR 가성비 OR 혼밥 OR 물가 OR 시장) -아카데미 -교육 -모집 when:30d';
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
    if (link.protocol !== 'https:' || link.hostname !== 'news.google.com' || !title || !source || !Number.isFinite(published) || published > now || published < now - 30 * 86400000) continue;
    if (!/외식|레스토랑|식당|프랜차이즈|음식점/.test(title) || !/트렌드|소비|물가|시장|열풍|확산|변화|증가|감소|성장|가성비|혼밥|식재료|산업/.test(title) || /아카데미|교육 모집|무료 교육|무료교육|맞춤형 교육|룰렛|카지노|슬롯|시어머니|며느리/.test(title)) continue;
    if (title.endsWith(' - ' + source)) title = title.slice(0, -source.length - 3);
    articles.push({ ...old.get(url), title, url, source, published_at: new Date(published).toISOString() });
  }
  return articles.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).filter(a => {
    const key = a.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 6);
}
export async function onRequest({ request }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
  if (request.method !== 'GET') return Response.json({ available: false }, { status: 405, headers });
  const now = Date.now(), requestedAt = new Date(now).toISOString();
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({ q: QUERY, hl: 'ko', gl: 'KR', ceid: 'KR:ko' }).toString();
  try {
    const response = await fetch(url.href, { cache: 'no-store', headers: { Accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('feed');
    const xml = await response.text(); if (xml.length > 2000000) throw new Error('size');
    const articles = collect(xml, now); if (!articles.length) throw new Error('empty');
    return Response.json({ available: true, articles, requestedAt, checkedAt: new Date().toISOString(), stale: false }, { headers });
  } catch {
    const articles = snapshot.articles.filter(a => Date.parse(a.published_at) <= now && Date.parse(a.published_at) >= now - 30 * 86400000).slice(0, 6);
    return Response.json({ available: articles.length > 0, articles, requestedAt, checkedAt: snapshot.updated_at, stale: true, reason: 'news_unavailable' }, { headers });
  }
}
