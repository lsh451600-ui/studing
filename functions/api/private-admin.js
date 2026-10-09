import { boardIdentity } from '../../src/board-permissions.js';
import { reply, sameOrigin } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (!['POST', 'DELETE'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (!sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  const identity = await boardIdentity(request, env);
  if (!identity?.isAdmin) return reply(403, { message: '운영자 계정으로 로그인해 주세요.' });
  return reply(200, { authenticated: true });
}
