const COOKIE = '__Host-dining-visitor';
export function koreaDay(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function reply(status, data, cookie) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, { available: false });
  if (request.headers.get('Origin') !== new URL(request.url).origin) return reply(403, { available: false });
  if (!env.MEMBERS_DB) return reply(503, { available: false });
  const stored = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const id = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(stored || '') ? stored : crypto.randomUUID();
  const day = koreaDay();
  try {
    const db = env.MEMBERS_DB;
    // The primary key counts one browser once per Korean calendar day, across all pages.
    const results = await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS dining_visits (day TEXT NOT NULL, visitor_id TEXT NOT NULL, PRIMARY KEY (day, visitor_id))'),
      db.prepare('INSERT OR IGNORE INTO dining_visits (day, visitor_id) VALUES (?, ?)').bind(day, id),
      db.prepare('SELECT (SELECT COUNT(*) FROM dining_visits WHERE day = ?) AS today, (SELECT COUNT(*) FROM dining_visits) AS total').bind(day)
    ]);
    const counts = results[2].results[0];
    const cookie = `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
    return reply(200, { available: true, day, today: counts.today, total: counts.total }, cookie);
  } catch { return reply(503, { available: false }); }
}
