import { settings, upstream, sessionCookies } from '../../src/member-auth.js';
import { readFlow, clearOAuth, kakaoReady } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', clearOAuth('kakao'));
  let outcome = 'social_failed';
  try {
    const url = new URL(request.url), flow = readFlow(request, 'kakao'), code = url.searchParams.get('code');
    if (settings(env).ready && kakaoReady(env) && flow && url.searchParams.get('state') === flow.nonce
      && code && code.length <= 1024 && !url.searchParams.has('error')) {
      const response = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KAKAO_REST_API_KEY,
          client_secret: env.KAKAO_CLIENT_SECRET, redirect_uri: url.origin + '/api/kakao-callback', code }),
        signal: AbortSignal.timeout(15000), redirect: 'error' });
      const token = await response.json();
      if (response.ok && typeof token.id_token === 'string' && token.id_token && typeof token.access_token === 'string' && token.access_token) {
        // Supabase validates Kakao's signature, issuer, audience and SHA-256 nonce.
        const result = await upstream(env, '/auth/v1/token?grant_type=id_token', { method: 'POST',
          body: { provider: 'kakao', id_token: token.id_token, access_token: token.access_token, nonce: flow.verifier } });
        if (result.ok && result.data.access_token) {
          const verified = await upstream(env, '/auth/v1/user', { token: result.data.access_token });
          if (verified.ok && verified.data.id) {
            for (const cookie of sessionCookies(result.data)) headers.append('Set-Cookie', cookie);
            outcome = 'social';
          }
        }
      } else if (response.ok && !token.id_token) outcome = 'kakao_oidc_required';
    }
  } catch { /* Never expose or log OAuth codes, tokens or app secrets. */ }
  headers.set('Location', '/?auth=' + outcome);
  return new Response(null, { status: 303, headers });
}
