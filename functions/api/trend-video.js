const TTL = 30 * 60 * 1000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const QUERY = '외식 트렌드|외식 산업|푸드 트렌드';
const CACHE_KEY = 'dining-30d-v1';
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  } });
}
async function youtube(key, resource, parameters) {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
  url.search = new URLSearchParams({ ...parameters, key }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok) throw new Error('youtube_unavailable');
  return response.json();
}
export async function selectVideo(key, now = Date.now()) {
  const found = await youtube(key, 'search', { part: 'snippet', type: 'video', q: QUERY,
    order: 'viewCount', publishedAfter: new Date(now - 30 * 86400000).toISOString(),
    regionCode: 'KR', relevanceLanguage: 'ko', safeSearch: 'moderate', videoEmbeddable: 'true', maxResults: '25' });
  const ids = [...new Set((found.items || []).map(item => item.id?.videoId).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))];
  if (!ids.length) return null;
  const details = await youtube(key, 'videos', { part: 'snippet,statistics,status', id: ids.join(',') });
  const candidates = (details.items || []).filter(video => ids.includes(video.id) && video.status?.embeddable === true
    && video.status?.privacyStatus === 'public' && Number.isFinite(Number(video.statistics?.viewCount))
    && Number(video.statistics?.viewCount) >= 0 && typeof video.snippet?.title === 'string'
    && Date.parse(video.snippet.publishedAt) >= now - 30 * 86400000 && Date.parse(video.snippet.publishedAt) <= now
    && !video.snippet.liveBroadcastContent?.match(/^(live|upcoming)$/));
  candidates.sort((a, b) => Number(b.statistics.viewCount) - Number(a.statistics.viewCount));
  if (!candidates.length) return null;
  const top = candidates[0];
  return { id: top.id, title: top.snippet.title, channel: top.snippet.channelTitle || '',
    views: Number(top.statistics.viewCount), publishedAt: top.snippet.publishedAt };
}
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply({ available: false }, 405);
  if (!env.YOUTUBE_API_KEY) return reply({ available: false, reason: 'setup_required' });
  // Persist one shared result and refresh lease across all Cloudflare locations.
  const db = env.MEMBERS_DB;
  if (!db) return reply({ available: false, reason: 'temporarily_unavailable' }, 503);
  const now = Date.now();
  let saved;
  const previous = () => {
    if (!saved?.payload || now - saved.fetched_at > MAX_AGE) return { available: false, reason: 'temporarily_unavailable' };
    try { return { available: true, video: JSON.parse(saved.payload), checkedAt: new Date(saved.fetched_at).toISOString(), stale: true }; }
    catch { return { available: false, reason: 'temporarily_unavailable' }; }
  };
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS dining_video_cache (id TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0)').run();
    await db.prepare('INSERT OR IGNORE INTO dining_video_cache (id) VALUES (?)').bind(CACHE_KEY).run();
    saved = await db.prepare('SELECT * FROM dining_video_cache WHERE id = ?').bind(CACHE_KEY).first();
    if (saved?.payload && now - saved.fetched_at < TTL) return reply({ ...previous(), stale: false });
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
    } catch {
      await db.prepare('UPDATE dining_video_cache SET retry_after = ?, lease_until = 0 WHERE id = ?').bind(now + 300000, CACHE_KEY).run();
      return reply(previous());
    }
  } catch { return reply(previous()); }
}
