import { settings, reply, sameOrigin, readJSON, validate, upstream, sessionCookies, publicUser, limitAttempts } from '../../src/member-auth.js';
export { validate } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (request.method === 'GET') return reply(200, '', { available: settings(env).ready });
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '회원가입을 준비 중입니다.');
  let member;
  try { member = validate(await readJSON(request)); } catch { return reply(400, '입력 내용을 확인해 주세요.'); }
  if (!member) return reply(400, '아이디, 비밀번호, 전화번호, 이메일의 입력 조건을 확인해 주세요.');
  try {
    if (!await limitAttempts(request, env, 'signup', 5)) return reply(429, '가입 시도가 많습니다. 15분 후 다시 시도해 주세요.');
    const result = await upstream(env, '/auth/v1/signup', { method: 'POST', body: {
      email: member.email, password: member.password, data: { username: member.username, phone: member.phone },
    }});
    if (!result.ok) return reply(result.status === 429 ? 429 : 400,
      result.status === 429 ? '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '가입을 완료하지 못했습니다. 아이디·이메일 중복 여부와 입력 내용을 확인해 주세요.');
    const session = result.data.access_token ? result.data : null;
    if (session) return reply(201, '회원가입과 로그인이 완료되었습니다.', { authenticated: true, user: publicUser(session.user) }, sessionCookies(session));
    return reply(201, '이메일로 확인 안내를 보냈습니다. 메일 인증 후 로그인해 주세요.', { authenticated: false, confirmationRequired: true });
  } catch { return reply(503, '회원가입에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
