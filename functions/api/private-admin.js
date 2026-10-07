import { reply, sameOrigin, readJSON, authorized, rateLimit, matchesPassword, sessionCookie, clearCookie, adminReady } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (!['POST', 'DELETE'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (!sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  if (request.method === 'DELETE') return reply(200, { message: '작성자 모드를 종료했습니다.' }, [clearCookie('admin')]);
  if (!await authorized(request, env)) return reply(401, { message: '비밀자료 열람 비밀번호를 먼저 입력해 주세요.' });
  if (!adminReady(env) || !env.MEMBERS_DB) return reply(503, { message: '게시물 작성을 준비 중입니다.' });
  try {
    if (!await rateLimit(request, env.MEMBERS_DB, 'admin', 5)) return reply(429, { message: '인증 시도가 많습니다. 15분 후 다시 시도해 주세요.' });
    let data;
    try { data = await readJSON(request); } catch { return reply(400, { message: '입력 내용을 확인해 주세요.' }); }
    if (typeof data?.password !== 'string' || data.password.length > 128 || !data.password.length) return reply(400, { message: '관리자 비밀번호를 입력해 주세요.' });
    if (!await matchesPassword(data.password, env.RECIPE_ADMIN_PASSWORD)) return reply(401, { message: '관리자 비밀번호가 맞지 않습니다.' });
    return reply(200, { message: '작성자 인증이 완료되었습니다.' }, [await sessionCookie(env, 'admin')]);
  } catch { return reply(503, { message: '작성자 인증에 연결하지 못했습니다.' }); }
}
