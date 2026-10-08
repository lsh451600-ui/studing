import { settings, upstream, sessionCookies } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  let confirmed = false;
  const url = new URL(request.url);
  const token = url.searchParams.get('token_hash');
  if (url.searchParams.get('type') === 'recovery') {
    headers.set('Location', '/reset-password' + (token && /^[a-zA-Z0-9_-]{20,256}$/.test(token) ? '?token_hash=' + encodeURIComponent(token) : ''));
    return new Response(null, { status: 303, headers });
  }
  try {
    if (settings(env).ready && token && /^[a-zA-Z0-9_-]{20,256}$/.test(token)) {
      const result = await upstream(env, '/auth/v1/verify', { method: 'POST', body: { token_hash: token, type: 'signup' } });
      if (result.ok && result.data.access_token) {
        for (const cookie of sessionCookies(result.data)) headers.append('Set-Cookie', cookie);
        confirmed = true;
      }
    }
  } catch { /* Never return or log verification tokens. */ }
  headers.set('Location', '/?auth=' + (confirmed ? 'confirmed' : 'confirmation_failed'));
  return new Response(null, { status: 303, headers });
}
