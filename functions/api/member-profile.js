import { settings, reply, sameOrigin, readJSON, currentSession, upstream, publicUser } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '회원 정보 연결을 준비 중입니다.');
  let session;
  try {
    session = await currentSession(request, env);
    if (!session.user) return reply(401, '로그인 후 다시 시도해 주세요.', {}, session.cookies);
    const data = await readJSON(request);
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    const phone = typeof data?.phone === 'string' ? data.phone.replace(/[\s()-]/g, '') : '';
    if (!/^[A-Za-z0-9_]{4,20}$/.test(username) || !/^\+?[0-9]{9,15}$/.test(phone)) return reply(400, '아이디와 전화번호의 입력 조건을 확인해 주세요.', {}, session.cookies);
    const result = await upstream(env, '/rest/v1/rpc/complete_member_profile', { method: 'POST', token: session.access,
      body: { requested_username: username, requested_phone: phone } });
    if (!result.ok) return reply(result.data.code === '23505' ? 409 : 400,
      result.data.code === '23505' ? '이미 사용 중인 아이디입니다.' : '정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session.cookies);
    return reply(200, '회원가입이 완료되었습니다.', { user: { ...publicUser(session.user), username: result.data }, needsProfile: false }, session.cookies);
  } catch { return reply(503, '회원 정보에 연결하지 못했습니다.', {}, session?.cookies || []); }
}
