import { settings, upstream, sessionCookies } from '../../src/member-auth.js';
import { readFlow, clearOAuth } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', clearOAuth());
  let success = false;
  try {
    const url = new URL(request.url), flow = readFlow(request), code = url.searchParams.get('code');
    if (settings(env).ready && flow && url.searchParams.get('flow') === flow.nonce && code && code.length <= 256 && !url.searchParams.has('error')) {
      const result = await upstream(env, '/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: flow.verifier } });
      if (result.ok && result.data.access_token) {
        const verified = await upstream(env, '/auth/v1/user', { token: result.data.access_token });
        if (verified.ok && verified.data.id) {
          for (const cookie of sessionCookies(result.data)) headers.append('Set-Cookie', cookie);
          success = true;
        }
      }
    }
  } catch { /* Do not expose provider errors or authorization codes. */ }
  headers.set('Location', '/?auth=' + (success ? 'social' : 'social_failed'));
  return new Response(null, { status: 303, headers });
}
