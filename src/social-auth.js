import { upstream } from './member-auth.js';
export async function providers(env) {
  const result = await upstream(env, '/auth/v1/settings');
  if (!result.ok) throw new Error('providers_unavailable');
  return { google: result.data.external?.google === true, kakao: result.data.external?.kakao === true && kakaoReady(env) };
}
export function kakaoReady(env) {
  return typeof env.KAKAO_REST_API_KEY === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(env.KAKAO_REST_API_KEY)
    && typeof env.KAKAO_CLIENT_SECRET === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(env.KAKAO_CLIENT_SECRET);
}
const cookieName = kind => kind === 'kakao' ? '__Host-member-kakao' : '__Host-member-oauth';
export const clearOAuth = (kind = 'google') => `${cookieName(kind)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function createFlow(kind = 'google', userId = null) {
  const name = cookieName(kind);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const value = encodeURIComponent(JSON.stringify({ verifier, nonce, ...(userId ? { userId } : {}), expires: Date.now() + 600000 }));
  return { nonce, challenge, verifier, cookie: `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` };
}
export function readFlow(request, kind = 'google') {
  const name = cookieName(kind);
  try {
    const value = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
    const flow = JSON.parse(decodeURIComponent(value.slice(name.length + 1)));
    if (!Number.isFinite(flow.expires) || !/^[A-Za-z0-9_-]{64}$/.test(flow.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(flow.nonce) || flow.expires < Date.now() || flow.expires > Date.now() + 600000) return null;
    return flow;
  } catch { return null; }
}
export async function memberProfile(env, session) {
  const result = await upstream(env, '/rest/v1/member_profiles?select=username,nickname,phone&id=eq.' + encodeURIComponent(session.user.id), { token: session.access });
  if (result.ok && Array.isArray(result.data)) return result.data[0] || null;
  if (result.status !== 400) throw new Error('profile_unavailable');
  // Keep login and account pages available while an existing deployment awaits the SQL migration.
  const legacy = await upstream(env, '/rest/v1/member_profiles?select=username,phone&id=eq.' + encodeURIComponent(session.user.id), { token: session.access });
  if (!legacy.ok || !Array.isArray(legacy.data)) throw new Error('profile_unavailable');
  return legacy.data[0] || null;
}

export async function kakaoNonce(verifier) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
