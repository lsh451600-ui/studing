const TTL = 30 * 60 * 1000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const QUERY = '외식 트렌드|외식 산업|푸드 트렌드';
const CACHE_KEY = 'dining-30d-v3';
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
export async function selectVideo(key, now = Date.now()) {
  const found = await youtube(key, 'search', { part: 'snippet', type: 'video', q: QUERY,
    order: 'viewCount', publishedAfter: new Date(now - 30 * 86400000).toISOString(), publishedBefore: new Date(now).toISOString(),
    regionCode: 'KR', relevanceLanguage: 'ko', safeSearch: 'moderate', videoEmbeddable: 'true', maxResults: '25' });
  const ids = [...new Set((found.items || []).map(item => item?.id?.videoId).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))];
  if (!ids.length) return null;
  const details = await youtube(key, 'videos', { part: 'snippet,statistics,status', id: ids.join(',') });
  const candidates = (details.items || []).filter(video => ids.includes(video?.id) && video.status?.embeddable === true
    && video.status?.privacyStatus === 'public' && /^(0|[1-9][0-9]*)$/.test(String(video.statistics?.viewCount)) && Number.isFinite(Number(video.statistics?.viewCount))
    && Number(video.statistics?.viewCount) >= 0 && typeof video.snippet?.title === 'string'
    && Date.parse(video.snippet.publishedAt) >= now - 30 * 86400000 && Date.parse(video.snippet.publishedAt) <= now
    && !['live', 'upcoming'].includes(video.snippet.liveBroadcastContent));
  candidates.sort((a, b) => Number(b.statistics.viewCount) - Number(a.statistics.viewCount));
  if (!candidates.length) return null;
  const top = candidates[0];
  return { id: top.id, title: top.snippet.title, channel: top.snippet.channelTitle || '',
    views: Number(top.statistics.viewCount), publishedAt: top.snippet.publishedAt };
}
// Cloudflare's edge cache lets video lookup work even without a D1 binding.
async function edgeResponse(request, env) {
  const cache = globalThis.caches?.default;
  if (!cache) return reply({ available: false, reason: 'storage_unavailable' }, 503);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.YOUTUBE_API_KEY)));
  const fingerprint = Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = new Request(new URL('/__video-cache/v3/' + fingerprint, request.url));
  let cached;
  try { cached = await cache.match(key); } catch { /* Cache outages must not block video lookup. */ }
  if (cached) return cached;
  if (inFlight.has(key.url)) return (await inFlight.get(key.url)).clone();
  const work = (async () => {
    let data;
    try {
      const video = await selectVideo(env.YOUTUBE_API_KEY);
      data = video ? { available: true, video, checkedAt: new Date().toISOString(), stale: false }
        : { available: false, reason: 'no_video' };
    } catch (error) { data = { available: false, reason: safeReason(error) }; }
    const response = reply(data);
    response.headers.set('Cache-Control', 'public, max-age=' + (data.available ? '1800' : '300'));
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
  if (new URL(request.url).searchParams.get('visit') === '1') {
    const now = Date.now(), requestedAt = new Date(now).toISOString();
    let data;
    try {
      const video = await selectVideo(env.YOUTUBE_API_KEY, now);
      data = video ? { available: true, video, requestedAt, checkedAt: new Date().toISOString(), stale: false } : { available: false, reason: 'no_video', requestedAt };
    } catch (error) { data = { available: false, reason: safeReason(error), requestedAt }; }
    const response = reply(data); response.headers.set('Cache-Control', 'no-store, private'); return response;
  }
  const fallback = async () => {
    try { return await edgeResponse(request, env); }
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
      if (payload && /^[A-Za-z0-9_-]{11}$/.test(payload.id) && now - saved.fetched_at <= MAX_AGE)
        return { available: true, video: payload, checkedAt: new Date(saved.fetched_at).toISOString(), stale: true };
    } catch {}
    return { available: false, reason: 'refresh_pending' };
  };
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS dining_video_cache (id TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0)').run();
    await db.prepare('INSERT OR IGNORE INTO dining_video_cache (id) VALUES (?)').bind(CACHE_KEY).run();
    saved = await db.prepare('SELECT * FROM dining_video_cache WHERE id = ?').bind(CACHE_KEY).first();
    if (previous().available && now - saved.fetched_at < TTL) return reply({ ...previous(), stale: false });
    if (saved?.retry_after > now) return reply(previous());
    const lease = await db.prepare('UPDATE dining_video_cache SET lease_until = ? WHERE id = ? AND lease_until < ? AND retry_after <= ? RETURNING id')
      .bind(now + 60000, CACHE_KEY, now, now).first();
    if (!lease) return reply(previous());
    try {
      const video = await selectVideo(env.YOUTUBE_API_KEY, now);
      if (!video) throw new Error('no_video');
      await db.prepare('UPDATE dining_video_cache SET payload = ?, fetched_at = ?, retry_after = 0, lease_until = 0 WHERE id = ?')
        .bind(JSON.stringify(video), now, CACHE_KEY).run();
      return reply({ available: true, video, checkedAt: new Date(now).toISOString(), stale: false });
    } catch (error) {
      const reason = safeReason(error), old = previous();
      if (old.available) {
        await db.prepare('UPDATE dining_video_cache SET retry_after = ?, lease_until = 0 WHERE id = ?').bind(now + 300000, CACHE_KEY).run();
        return reply({ ...old, reason });
      }
      await db.prepare('UPDATE dining_video_cache SET payload = ?, fetched_at = 0, retry_after = ?, lease_until = 0 WHERE id = ?')
        .bind(JSON.stringify({ failure: reason }), now + 300000, CACHE_KEY).run();
      return reply({ available: false, reason });
    }
  } catch { return fallback(); }
}
