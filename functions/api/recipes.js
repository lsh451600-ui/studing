function reply(status, data) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }});
}

export async function matchesPassword(candidate, expected) {
  const encode = value => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([candidate, expected].map(value => crypto.subtle.digest('SHA-256', encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    return reply(200, { available: typeof env.RECIPE_PASSWORD === 'string' && env.RECIPE_PASSWORD.length > 0 });
  }
  if (request.method !== 'POST') return reply(405, { message: '비밀번호를 입력해 주세요.' });
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  }
  if (typeof env.RECIPE_PASSWORD !== 'string' || !env.RECIPE_PASSWORD.length) {
    return reply(503, { message: '레시피 페이지를 준비 중입니다. 잠시 후 다시 방문해 주세요.' });
  }
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) {
    return reply(415, { message: '올바른 형식으로 입력해 주세요.' });
  }
  try {
    if (!request.body) return reply(400, { message: '비밀번호를 입력해 주세요.' });
    const reader = request.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) { await reader.cancel(); return reply(400, { message: '입력 내용을 확인해 주세요.' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return reply(400, { message: '입력 내용을 확인해 주세요.' }); }
    if (!data || typeof data.password !== 'string' || !data.password.length || data.password.length > 128) {
      return reply(400, { message: '비밀번호를 입력해 주세요.' });
    }
    // Use the existing D1 binding for persistent request limiting when connected.
    if (env.MEMBERS_DB) {
      const db = env.MEMBERS_DB;
      await db.prepare('CREATE TABLE IF NOT EXISTS recipe_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
      const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 900);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${window}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`));
      const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      const limit = await db.prepare('INSERT INTO recipe_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts')
        .bind(key, (window + 1) * 900).first();
      await db.prepare('DELETE FROM recipe_limits WHERE expires_at < ?').bind(now).run();
      if (limit.attempts > 10) return reply(429, { message: '입력 시도가 많습니다. 15분 후 다시 시도해 주세요.' });
    }
    if (!await matchesPassword(data.password, env.RECIPE_PASSWORD)) {
      return reply(401, { message: '비밀번호가 맞지 않습니다. 다시 입력해 주세요.' });
    }
    // Protected recipe data is returned only after verification; never put it in public HTML.
    return reply(200, { title: '레시피', description: '등록된 레시피가 아직 없습니다.', recipes: [] });
  } catch {
    return reply(503, { message: '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
