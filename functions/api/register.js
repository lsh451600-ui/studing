const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS signup_limits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
];

function reply(status, message, extra = {}) {
  return Response.json({ message, ...extra }, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  }});
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // Workers Web Crypto supports up to 100,000 PBKDF2 iterations.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2-sha256$100000$${hex(salt)}$${hex(bits)}`;
}

export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { username, password, phone, email } = body;
  if (![username, password, phone, email].every(value => typeof value === 'string')) return null;
  const clean = { username: username.trim(), password, phone: phone.replace(/[\s()-]/g, ''), email: email.trim().toLowerCase() };
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(clean.username)) return null;
  if (password.length < 12 || password.length > 128 || !password.trim()) return null;
  if (!/^\+?[0-9]{9,15}$/.test(clean.phone)) return null;
  if (clean.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return null;
  return clean;
}

async function readBody(request) {
  if (!request.body) throw new Error('invalid_body');
  const reader = request.body.getReader();
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error('body_too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    return reply(200, '', { available: Boolean(env.MEMBERS_DB) });
  }
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!env.MEMBERS_DB) return reply(503, '회원가입을 준비 중입니다. 잠시 후 다시 방문해 주세요.');
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return reply(415, '올바른 형식으로 입력해 주세요.');
  }
  let member;
  try { member = validate(await readBody(request)); }
  catch { return reply(400, '입력 내용을 확인해 주세요.'); }
  if (!member) return reply(400, '아이디, 비밀번호, 전화번호, 이메일의 입력 조건을 확인해 주세요.');
  try {
    const db = env.MEMBERS_DB;
    await db.batch(SCHEMA.map(sql => db.prepare(sql)));
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / 900);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${window}:${ip}`));
    const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const limit = await db.prepare(`INSERT INTO signup_limits (key, attempts, expires_at)
      VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts`)
      .bind(key, (window + 1) * 900).first();
    await db.prepare('DELETE FROM signup_limits WHERE expires_at < ?').bind(now).run();
    if (limit.attempts > 5) return reply(429, '가입 시도가 많습니다. 15분 후 다시 시도해 주세요.');
    const passwordHash = await hashPassword(member.password);
    await db.prepare(`INSERT INTO members (id, username, password_hash, phone, email, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), member.username, passwordHash,
        member.phone, member.email, new Date().toISOString()).run();
    return reply(201, '회원가입이 완료되었습니다. 환영합니다!');
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error.message))) {
      return reply(409, '이미 사용 중인 아이디 또는 이메일입니다. 다른 정보로 입력해 주세요.');
    }
    // Never log the request body, password, phone, email, or database exception.
    return reply(503, '가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
