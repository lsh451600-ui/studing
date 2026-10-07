import { settings, upstream, sessionCookies } from '../../src/member-auth.js';
import { readFlow, clearOAuth, kakaoReady } from '../../src/social-auth.js';
// Return only a fixed category, never a provider's raw error, code or token.
export function classifyKakaoSessionError(data = {}) {
  const code = String(data.error_code || data.code || data.error || '').toLowerCase();
  const message = String(data.msg || data.message || data.error_description || '').toLowerCase();
  if (code.includes('email') || message.includes('email address is required') || message.includes('email from external provider')) return 'kakao_email_required';
  if (code === 'provider_disabled' || code === 'oauth_provider_not_supported' || message.includes('not enabled')) return 'kakao_provider_disabled';
  if (message.includes('audience')) return 'kakao_app_mismatch';
  if (code.includes('nonce') || message.includes('nonce')) return 'kakao_nonce_failed';
  if (code.includes('database') || message.includes('database') || message.includes('saving new user') || code === 'unexpected_failure' || code === 'server_error') return 'kakao_member_setup';
  return 'kakao_supabase_failed';
}
export function classifyKakaoTokenError(data = {}) {
  return ({ KOE010: 'kakao_secret_invalid', KOE101: 'kakao_key_invalid', KOE114: 'kakao_key_changed',
    KOE303: 'kakao_redirect_mismatch', KOE320: 'kakao_code_expired', KOE237: 'kakao_rate_limited',
    KOE009: 'kakao_platform_invalid', KOE127: 'kakao_ip_restricted' })[data.error_code] || 'kakao_token_failed';
}
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', clearOAuth('kakao'));
  let outcome = 'kakao_flow_expired', detail = ''; 
  try {
    const url = new URL(request.url), flow = readFlow(request, 'kakao'), code = url.searchParams.get('code');
    if (!settings(env).ready || !kakaoReady(env)) outcome = 'kakao_config_required';
    else if (url.searchParams.has('error')) outcome = url.searchParams.get('error') === 'access_denied' ? 'kakao_cancelled' : 'kakao_provider_failed';
    else if (flow && url.searchParams.get('state') === flow.nonce && code && code.length <= 1024) {
      outcome = 'kakao_token_failed';
      const response = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KAKAO_REST_API_KEY,
          client_secret: env.KAKAO_CLIENT_SECRET, redirect_uri: url.origin + '/api/kakao-callback', code }).toString(),
        signal: AbortSignal.timeout(15000), redirect: 'manual' });
      let token;
      try { token = await response.json(); }
      catch { token = {}; detail = 'HTTP' + response.status; }
      if (!response.ok) {
        outcome = classifyKakaoTokenError(token);
        detail = /^KOE[0-9]{3}$/.test(token.error_code || '') ? token.error_code : 'HTTP' + response.status;
      }
      if (response.ok && typeof token.id_token === 'string' && token.id_token && typeof token.access_token === 'string' && token.access_token) {
        outcome = 'kakao_supabase_failed';
        const result = await upstream(env, '/auth/v1/token?grant_type=id_token', { method: 'POST',
          body: { provider: 'kakao', id_token: token.id_token, access_token: token.access_token, nonce: flow.verifier } });
        if (result.ok && result.data.access_token) {
          outcome = 'kakao_session_failed';
          const verified = await upstream(env, '/auth/v1/user', { token: result.data.access_token });
          if (verified.ok && verified.data.id) {
            for (const cookie of sessionCookies(result.data)) headers.append('Set-Cookie', cookie);
            outcome = 'social';
          }
        } else outcome = classifyKakaoSessionError(result.data);
      } else if (response.ok && !token.id_token) outcome = 'kakao_oidc_required';

    }
  } catch (error) {
    if (outcome === 'kakao_token_failed') {
      outcome = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'kakao_connection_timeout' : 'kakao_connection_failed';
    }
    // Do not log error.message: provider exceptions can contain credentials.
  }
  headers.set('Location', '/?auth=' + outcome + (outcome === 'kakao_token_failed' && detail ? '&detail=' + detail : ''));
  return new Response(null, { status: 303, headers });
}
