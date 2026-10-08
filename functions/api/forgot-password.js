import { settings, reply, sameOrigin, readJSON, upstream, limitAttempts } from '../../src/member-auth.js';
const sent = () => reply(200, '가입 정보가 확인되면 비밀번호 재설정 메일을 보내드립니다. 받은편지함과 스팸함을 확인해 주세요.');
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '비밀번호 찾기 연결을 준비 중입니다.');
  let identifier;
  try { const body = await readJSON(request); identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : ''; }
  catch { return reply(400, '입력 내용을 확인해 주세요.'); }
  if (!identifier || identifier.length > 254 || !(identifier.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) : /^[A-Za-z0-9_]{4,20}$/.test(identifier)))
    return reply(400, '가입한 아이디 또는 이메일을 입력해 주세요.');
  try {
    if (!await limitAttempts(request, env, 'password-recovery', 3)) return reply(429, '메일 요청이 많습니다. 15분 후 다시 시도해 주세요.');
    let email = identifier.toLowerCase();
    if (!identifier.includes('@')) {
      const lookup = await upstream(env, '/rest/v1/rpc/resolve_member_login', { method: 'POST', privileged: true, body: { requested_username: identifier } });
      if (!lookup.ok) return reply(503, '비밀번호 찾기에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (typeof lookup.data !== 'string' || !lookup.data) return sent();
      email = lookup.data;
    }
    const redirect = new URL('/reset-password', request.url).href;
    const result = await upstream(env, '/auth/v1/recover?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', body: { email } });
    if (!result.ok && result.status >= 500) return reply(503, '메일 발송에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (!result.ok && result.status === 429) return reply(429, '메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    // An unknown account must receive exactly the same public response.
    return sent();
  } catch { return reply(503, '비밀번호 찾기에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
