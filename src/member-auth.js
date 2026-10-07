export function settings(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, publicKey, secretKey, ready: /^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(url) && Boolean(publicKey && secretKey) };
}
export function reply(status, message, data = {}, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify({ message, ...data }), { status, headers });
}
export function sameOrigin(request) { return request.headers.get('Origin') === new URL(request.url).origin; }
export async function readJSON(request) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json') || !request.body) throw new Error('invalid');
  const reader = request.body.getReader(), parts = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error('too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function validate(body) {
  if (!body || !['username', 'password', 'phone', 'email'].every(key => typeof body[key] === 'string')) return null;
  const result = { username: body.username.trim(), password: body.password,
    phone: body.phone.replace(/[\s()-]/g, ''), email: body.email.trim().toLowerCase() };
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(result.username) || result.password.length < 12 || result.password.length > 128 || !result.password.trim()) return null;
  if (!/^\+?[0-9]{9,15}$/.test(result.phone) || result.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) return null;
  return result;
}
export async function upstream(env, path, { method = 'GET', body, token, privileged = false } = {}) {
  const config = settings(env), key = privileged ? config.secretKey : config.publicKey;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  else if (privileged && key?.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(config.url + path, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  let data = {};
  if (response.status !== 204) { try { data = await response.json(); } catch { /* Do not expose proxy response HTML. */ } }
  return { status: response.status, ok: response.ok, data };
}
const COOKIE_NAMES = ['__Host-member-access', '__Host-member-refresh'];
export function clearCookies() { return COOKIE_NAMES.map(name => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`); }
export function sessionCookies(session) {
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') throw new Error('invalid_session');
  const seconds = Math.max(1, Math.min(Number(session.expires_in) || 3600, 86400));
  return [session.access_token, session.refresh_token].map((value, index) =>
    `${COOKIE_NAMES[index]}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${index ? 2592000 : seconds}`);
}
export function readCookies(request) {
  const result = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const split = part.indexOf('='); if (split < 0) continue;
    const key = part.slice(0, split).trim();
    if (COOKIE_NAMES.includes(key)) { try { result[key] = decodeURIComponent(part.slice(split + 1)); } catch { /* Invalid cookie ignored. */ } }
  }
  return { access: result[COOKIE_NAMES[0]], refresh: result[COOKIE_NAMES[1]] };
}
export async function currentSession(request, env) {
  const stored = readCookies(request); let access = stored.access, cookies = [];
  if (!access && !stored.refresh) return { user: null, cookies: [] };
  let user = access ? await upstream(env, '/auth/v1/user', { token: access }) : null;
  if (user && !user.ok && ![401, 403].includes(user.status)) throw new Error('auth_unavailable');
  if (!user?.ok && stored.refresh) {
    const refreshed = await upstream(env, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: stored.refresh } });
    if (!refreshed.ok) {
      if (![400, 401, 403].includes(refreshed.status)) throw new Error('refresh_unavailable');
      return { user: null, cookies: clearCookies() };
    }
    cookies = sessionCookies(refreshed.data); access = refreshed.data.access_token;
    user = await upstream(env, '/auth/v1/user', { token: access });
  }
  if (!user?.ok) return { user: null, cookies: clearCookies() };
  return { user: user.data, access, cookies };
}
export function publicUser(user) {
  return { id: user.id, username: user.user_metadata?.username || '회원',
    kakaoLinked: user.identities?.some(identity => identity.provider === 'kakao') === true || user.app_metadata?.providers?.includes('kakao') === true };
}
export async function limitAttempts(request, env, scope, maximum = 10) {
  const period = Math.floor(Date.now() / 900000);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${settings(env).secretKey}:${scope}:${period}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`));
  const key = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const result = await upstream(env, '/rest/v1/rpc/member_auth_limit', { method: 'POST', privileged: true,
    body: { request_key: key, request_maximum: maximum } });
  if (!result.ok || typeof result.data !== 'boolean') throw new Error('rate_limit_unavailable');
  return result.data;
}
