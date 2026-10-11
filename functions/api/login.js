import { settings, reply, sameOrigin, readJSON, upstream, sessionCookies, publicUser, limitAttempts, readCookies } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '로그인을 준비 중입니다.');
  let data;
  try { data = await readJSON(request); } catch { return reply(400, '입력 내용을 확인해 주세요.'); }
  if (typeof data?.identifier !== 'string' || typeof data.password !== 'string' || !data.password || data.password.length > 128) return reply(400, '아이디 또는 이메일과 비밀번호를 입력해 주세요.');
  const identifier = data.identifier.trim();
  if (!identifier || identifier.length > 254) return reply(400, '아이디 또는 이메일을 확인해 주세요.');
  try {
    if (!await limitAttempts(request, env, 'login')) return reply(429, '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');
    let email = identifier.toLowerCase();
    if (!identifier.includes('@')) {
      const lookup = await upstream(env, '/rest/v1/rpc/resolve_member_login', { method: 'POST', privileged: true, body: { requested_username: identifier } });
      if (!lookup.ok) return reply(503, '로그인에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (typeof lookup.data !== 'string' || !lookup.data) return reply(401, '아이디·이메일 또는 비밀번호가 맞지 않습니다.');
      email = lookup.data;
    }
    const result = await upstream(env, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: data.password } });
    if (!result.ok) {
      if (result.status === 429) return reply(429, '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
      if (result.status >= 500) return reply(503, '로그인에 연결하지 못했습니다.');
      if (result.data.error_code === 'email_not_confirmed') return reply(401, '이메일 인증을 완료한 뒤 로그인해 주세요.');
      return reply(401, '아이디·이메일 또는 비밀번호가 맞지 않습니다.');
    }
    const previous = readCookies(request).access;
    if (previous && previous !== result.data.access_token) {
      try { await upstream(env, '/auth/v1/logout?scope=local', { method: 'POST', token: previous }); } catch {}
    }
    return reply(200, '로그인되었습니다.', { authenticated: true, user: publicUser(result.data.user) }, sessionCookies(result.data));
  } catch { return reply(503, '로그인에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
