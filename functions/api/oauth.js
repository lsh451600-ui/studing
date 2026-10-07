import { settings, reply, sameOrigin, readJSON, limitAttempts, currentSession } from '../../src/member-auth.js';
import { providers, createFlow, kakaoNonce } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST'].includes(request.method)) return reply(405, '지원하지 않는 요청입니다.');
  if (request.method === 'POST' && !sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '소셜 로그인을 준비 중입니다.');
  try {
    const enabled = await providers(env);
    if (request.method === 'GET') return reply(200, '', { providers: enabled });
    const data = await readJSON(request);
    if (!['google', 'kakao'].includes(data?.provider)) return reply(400, '로그인 방법을 확인해 주세요.');
    if (!enabled[data.provider]) return reply(503, '이 로그인 방법은 연결 준비 중입니다.');
    if (!await limitAttempts(request, env, 'oauth', 10)) return reply(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    let session = null;
    if (data.action === 'link') {
      if (data.provider !== 'kakao') return reply(400, '카카오 계정만 연결할 수 있습니다.');
      session = await currentSession(request, env);
      if (!session.user) return reply(401, '기존 아이디로 먼저 로그인해 주세요.', {}, session.cookies);
    } else if (data.action !== undefined) return reply(400, '요청을 확인해 주세요.');
    const flow = await createFlow(data.provider, session?.user.id);
    if (data.provider === 'kakao') {
      const callback = new URL('/api/kakao-callback', request.url);
      const url = new URL('https://kauth.kakao.com/oauth/authorize');
      url.search = new URLSearchParams({ client_id: env.KAKAO_REST_API_KEY, redirect_uri: callback.href,
        response_type: 'code', scope: 'openid', state: flow.nonce, nonce: await kakaoNonce(flow.verifier) }).toString();
      return reply(200, '', { url: url.href }, [...(session?.cookies || []), flow.cookie]);
    }
    const callback = new URL('/api/oauth-callback', request.url); callback.searchParams.set('flow', flow.nonce);
    const url = new URL(settings(env).url + '/auth/v1/authorize');
    url.search = new URLSearchParams({ provider: data.provider, redirect_to: callback.href,
      code_challenge: flow.challenge, code_challenge_method: 's256' }).toString();
    return reply(200, '', { url: url.href }, [...(session?.cookies || []), flow.cookie]);
  } catch { return reply(503, '소셜 로그인에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
