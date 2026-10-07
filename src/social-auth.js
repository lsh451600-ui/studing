import { upstream } from './member-auth.js';
export async function providers(env) {
  const result = await upstream(env, '/auth/v1/settings');
  if (!result.ok) throw new Error('providers_unavailable');
  return { google: result.data.external?.google === true, kakao: result.data.external?.kakao === true };
}
const name = '__Host-member-oauth';
export const clearOAuth = () => `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function createFlow() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const value = encodeURIComponent(JSON.stringify({ verifier, nonce, expires: Date.now() + 600000 }));
  return { nonce, challenge, cookie: `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600` };
}
export function readFlow(request) {
  try {
    const value = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
    const flow = JSON.parse(decodeURIComponent(value.slice(name.length + 1)));
    if (!Number.isFinite(flow.expires) || !/^[A-Za-z0-9_-]{64}$/.test(flow.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(flow.nonce) || flow.expires < Date.now() || flow.expires > Date.now() + 600000) return null;
    return flow;
  } catch { return null; }
}
export async function memberProfile(env, session) {
  const result = await upstream(env, '/rest/v1/member_profiles?select=username,phone&id=eq.' + encodeURIComponent(session.user.id), { token: session.access });
  if (!result.ok || !Array.isArray(result.data)) throw new Error('profile_unavailable');
  return result.data[0] || null;
}
