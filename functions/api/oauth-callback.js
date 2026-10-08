import { settings, upstream, sessionCookies } from '../../src/member-auth.js';
import { readFlow, clearOAuth } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', clearOAuth());
  let success = false, outcome = 'social_failed';
  try {
    const url = new URL(request.url), flow = readFlow(request), code = url.searchParams.get('code');
    if (url.searchParams.has('error')) {
      const kind = url.searchParams.get('error');
      const detail = url.searchParams.get('error_description') || '';
      outcome = /database|saving new user/i.test(detail) ? 'google_member_setup' : kind === 'access_denied' ? 'google_cancelled' : 'google_provider_failed';
    }
    // Supabase can fall back to the allowlisted site root without the flow query.
    // The HttpOnly verifier and the upstream PKCE exchange still bind the code.
    const matches = flow && (!url.searchParams.has('flow') || url.searchParams.get('flow') === flow.nonce);
    if (settings(env).ready && matches && code && code.length <= 256 && !url.searchParams.has('error')) {
      const result = await upstream(env, '/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: flow.verifier } });
      outcome = /database|saving new user/i.test(String(result.data.msg || result.data.message || '')) ? 'google_member_setup' : 'google_exchange_failed';
      if (result.ok && result.data.access_token) {
        const verified = await upstream(env, '/auth/v1/user', { token: result.data.access_token });
        if (verified.ok && verified.data.id) {
          for (const cookie of sessionCookies(result.data)) headers.append('Set-Cookie', cookie);
          success = true;
        }
      }
    }
  } catch { /* Do not expose provider errors or authorization codes. */ }
  headers.set('Location', '/?auth=' + (success ? 'social' : outcome));
  return new Response(null, { status: 303, headers });
}
