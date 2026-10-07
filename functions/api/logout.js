import { settings, reply, sameOrigin, currentSession, clearCookies, upstream } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  try {
    if (settings(env).ready) {
      const session = await currentSession(request, env);
      if (session.access) {
        const result = await upstream(env, '/auth/v1/logout?scope=local', { method: 'POST', token: session.access });
        if (!result.ok && ![401, 403].includes(result.status)) return reply(503, '로그아웃에 연결하지 못했습니다. 다시 시도해 주세요.');
      }
    }
    return reply(200, '로그아웃되었습니다.', { authenticated: false }, clearCookies());
  } catch { return reply(503, '로그아웃에 연결하지 못했습니다. 다시 시도해 주세요.'); }
}
