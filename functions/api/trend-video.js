const PERIOD = 2 * 60 * 60 * 1000;
// Refresh in shared two-hour slots; the scheduler also warms the cache.
export const refreshSlot = now => Math.floor(now / PERIOD) * PERIOD;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VIDEO_WINDOW = 30 * 86400000;
const QUERY = '"외식 트렌드"|"외식 전망"|"외식업 전망"|"외식산업 전망"|"푸드 트렌드"|"외식 시장 전망"';
export function isTrendVideo(snippet = {}) {
  const text = [snippet.title, snippet.description].filter(value => typeof value === 'string').join(' ');
  return /외식|푸드|food|dining/i.test(text) && /트렌드|전망|동향|trend|outlook|forecast/i.test(text)
    && !/고부갈등|며느리|시어머니|사연라디오|오디오북|면접|입시|수시|정시|합격/.test(snippet.title || '');
}
const CACHE_KEY = 'dining-trends-v10';
const inFlight = new Map();
const reasons = new Set(['api_key_invalid', 'api_not_enabled', 'api_key_restricted', 'quota_exceeded', 'youtube_forbidden', 'youtube_unavailable', 'youtube_connection_failed', 'youtube_timeout', 'youtube_response_invalid', 'youtube_redirect_blocked', 'youtube_internal_error', 'no_video']);
export function classifyYouTubeError(data = {}, status = 0) {
  const codes = [...(Array.isArray(data?.error?.errors) ? data.error.errors : []), ...(Array.isArray(data?.error?.details) ? data.error.details : [])].map(item => item?.reason);
  if (codes.some(code => ['keyInvalid', 'API_KEY_INVALID'].includes(code))) return 'api_key_invalid';
  if (codes.some(code => ['accessNotConfigured', 'SERVICE_DISABLED'].includes(code))) return 'api_not_enabled';
  if (codes.some(code => ['ipRefererBlocked', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_SERVICE_BLOCKED'].includes(code))) return 'api_key_restricted';
  if (codes.some(code => ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(code)) || status === 429) return 'quota_exceeded';
  return status === 403 ? 'youtube_forbidden' : 'youtube_unavailable';
}
function safeReason(error) {
  if (reasons.has(error?.message)) return error.message;
  return ['TimeoutError', 'AbortError'].includes(error?.name) ? 'youtube_timeout' : 'youtube_internal_error';
}
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  } });
}
async function youtube(key, resource, parameters) {
  const signal = AbortSignal.timeout(12000);
  const hosts = ['youtube.googleapis.com', 'www.googleapis.com'];
  let failure = 'youtube_connection_failed';
  for (const host of hosts) {
    const url = new URL('https://' + host + '/youtube/v3/' + resource);
    url.search = new URLSearchParams({ ...parameters, key }).toString();
    let response;
    try {
      response = await fetch(url.href, { method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'manual' });
    } catch (error) {
      if (signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name)) throw new Error('youtube_timeout');
      // Fixed fields only: fetch exception messages can contain the API key URL.
      const networkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];
      console.warn('youtube_transport_failed', { stage: resource, host,
        type: ['TypeError', 'Error'].includes(error?.name) ? error.name : 'Other',
        code: networkCodes.includes(error?.cause?.code) ? error.cause.code : 'unknown' });
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      failure = 'youtube_redirect_blocked';
      continue; // Try only the other fixed Google host, never an arbitrary Location URL.
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('youtube_response_invalid'); }
    if (!response.ok) throw new Error(classifyYouTubeError(data, response.status));
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.items !== undefined && !Array.isArray(data.items))) throw new Error('youtube_response_invalid');
    return data;
  }
  throw new Error(failure);
}
export async function selectVideo(key, now = Date.now(), sort = 'latest') {
  const found = await youtube(key, 'search', { part: 'snippet', type: 'video', q: QUERY,
    order: sort === 'popular' ? 'viewCount' : 'date', publishedAfter: new Date(now - VIDEO_WINDOW).toISOString(), publishedBefore: new Date(now).toISOString(),
    regionCode: 'KR', relevanceLanguage: 'ko', safeSearch: 'moderate', videoEmbeddable: 'true', maxResults: '50' });
  const ids = [...new Set((found.items || []).map(item => item?.id?.videoId).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))];
  if (!ids.length) return null;
  const details = await youtube(key, 'videos', { part: 'snippet,statistics,status', id: ids.join(',') });
  const candidates = (details.items || []).filter(video => ids.includes(video?.id) && video.status?.embeddable === true
    && video.status?.privacyStatus === 'public' && /^(0|[1-9][0-9]*)$/.test(String(video.statistics?.viewCount)) && Number.isFinite(Number(video.statistics?.viewCount))
    && Number(video.statistics?.viewCount) >= 0 && typeof video.snippet?.title === 'string'
    && Date.parse(video.snippet.publishedAt) >= now - VIDEO_WINDOW && Date.parse(video.snippet.publishedAt) <= now
    && isTrendVideo(video.snippet)
    && !['live', 'upcoming'].includes(video.snippet.liveBroadcastContent));
  candidates.sort((a, b) => sort === 'popular'
    ? Number(b.statistics.viewCount) - Number(a.statistics.viewCount) || Date.parse(b.snippet.publishedAt) - Date.parse(a.snippet.publishedAt)
    : Date.parse(b.snippet.publishedAt) - Date.parse(a.snippet.publishedAt) || Number(b.statistics.viewCount) - Number(a.statistics.viewCount));
  if (!candidates.length) return null;
  const top = candidates[0];
  return { id: top.id, title: top.snippet.title, channel: top.snippet.channelTitle || '',
    views: Number(top.statistics.viewCount), publishedAt: top.snippet.publishedAt };
}
// Cloudflare's edge cache lets video lookup work even without a D1 binding.
async function edgeResponse(request, env, sort) {
  const cache = globalThis.caches?.default;
  if (!cache) return reply({ available: false, reason: 'storage_unavailable' }, 503);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.YOUTUBE_API_KEY)));
  const fingerprint = Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = new Request(new URL('/__video-cache/v10/' + fingerprint + '/' + sort + '/' + refreshSlot(Date.now()), request.url));
  let cached;
  try { cached = await cache.match(key); } catch { /* Cache outages must not block video lookup. */ }
  if (cached) return cached;
  if (inFlight.has(key.url)) return (await inFlight.get(key.url)).clone();
  const work = (async () => {
    let data;
    try {
      const video = await selectVideo(env.YOUTUBE_API_KEY, Date.now(), sort);
      data = video ? { available: true, video, checkedAt: new Date().toISOString(), stale: false }
        : { available: false, reason: 'no_video' };
    } catch (error) { data = { available: false, reason: safeReason(error) }; }
    const response = reply(data);
    response.headers.set('Cache-Control', 'public, max-age=' + (data.available ? String(Math.max(1, Math.ceil((refreshSlot(Date.now()) + PERIOD - Date.now()) / 1000))) : '300'));
    try { await cache.put(key, response.clone()); } catch { /* A fetched result can still be displayed. */ }
    return response;
  })();
  inFlight.set(key.url, work);
  try { return (await work).clone(); } finally { inFlight.delete(key.url); }
}
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply({ available: false }, 405);
  if (!env.YOUTUBE_API_KEY?.trim()) return reply({ available: false, reason: 'setup_required' });
  env = { ...env, YOUTUBE_API_KEY: env.YOUTUBE_API_KEY.trim() };
  const sort = new URL(request.url).searchParams.get('sort') === 'popular' ? 'popular' : 'latest';
  const cacheKey = CACHE_KEY + '-' + sort;
  const fallback = async () => {
    try { return await edgeResponse(request, env, sort); }
    catch { return reply({ available: false, reason: 'storage_unavailable' }, 503); }
  };
  const db = env.MEMBERS_DB;
  if (!db) return fallback();
  const now = Date.now();
  let saved;
  const previous = () => {
    try {
      const payload = JSON.parse(saved?.payload || 'null');
      if (reasons.has(payload?.failure)) return { available: false, reason: payload.failure };
      if (payload && /^[A-Za-z0-9_-]{11}$/.test(payload.id) && now - saved.fetched_at <= MAX_AGE && Date.parse(payload.publishedAt) >= now - VIDEO_WINDOW && Date.parse(payload.publishedAt) <= now)
        return { available: true, video: payload, checkedAt: new Date(saved.fetched_at).toISOString(), stale: true };
    } catch {}
    return { available: false, reason: 'refresh_pending' };
  };
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS dining_video_cache (id TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0)').run();
    await db.prepare('INSERT OR IGNORE INTO dining_video_cache (id) VALUES (?)').bind(cacheKey).run();
    saved = await db.prepare('SELECT * FROM dining_video_cache WHERE id = ?').bind(cacheKey).first();
    if (previous().available && saved.fetched_at >= refreshSlot(now)) return reply({ ...previous(), stale: false });
    if (saved?.retry_after > now) return reply(previous());
    const lease = await db.prepare('UPDATE dining_video_cache SET lease_until = ? WHERE id = ? AND lease_until < ? AND retry_after <= ? RETURNING id')
      .bind(now + 60000, cacheKey, now, now).first();
    if (!lease) return reply(previous());
    try {
      const video = await selectVideo(env.YOUTUBE_API_KEY, now, sort);
      if (!video) throw new Error('no_video');
      await db.prepare('UPDATE dining_video_cache SET payload = ?, fetched_at = ?, retry_after = 0, lease_until = 0 WHERE id = ?')
        .bind(JSON.stringify(video), now, cacheKey).run();
      return reply({ available: true, video, checkedAt: new Date(now).toISOString(), stale: false });
    } catch (error) {
      const reason = safeReason(error), old = previous();
      if (old.available) {
        await db.prepare('UPDATE dining_video_cache SET retry_after = ?, lease_until = 0 WHERE id = ?').bind(now + 300000, cacheKey).run();
        return reply({ ...old, reason });
      }
      await db.prepare('UPDATE dining_video_cache SET payload = ?, fetched_at = 0, retry_after = ?, lease_until = 0 WHERE id = ?')
        .bind(JSON.stringify({ failure: reason }), now + 300000, cacheKey).run();
      return reply({ available: false, reason });
    }
  } catch { return fallback(); }
}
