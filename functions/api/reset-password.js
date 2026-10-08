import { settings, reply, sameOrigin, readJSON, upstream, clearCookies, limitAttempts } from '../../src/member-auth.js';
import { hasRecentAuthentication } from '../../src/account-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '비밀번호 재설정 연결을 준비 중입니다.');
  let body;
  try { body = await readJSON(request); } catch { return reply(400, '입력 내용을 확인해 주세요.'); }
  if (typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 128 || !body.password.trim())
    return reply(400, '새 비밀번호는 12~128자로 입력해 주세요.');
  const hash = typeof body.tokenHash === 'string' && /^[A-Za-z0-9_-]{20,256}$/.test(body.tokenHash) ? body.tokenHash : null;
  const bearer = typeof body.accessToken === 'string' && /^[A-Za-z0-9_.-]{20,3500}$/.test(body.accessToken) ? body.accessToken : null;
  if (!hash && !bearer) return reply(401, '재설정 링크가 없거나 만료되었습니다. 비밀번호 찾기를 다시 진행해 주세요.');
  try {
    if (!await limitAttempts(request, env, 'password-reset', 5)) return reply(429, '요청이 많습니다. 15분 후 다시 시도해 주세요.');
    let token = bearer;
    if (hash) {
      const verified = await upstream(env, '/auth/v1/verify', { method: 'POST', body: { token_hash: hash, type: 'recovery' } });
      if (!verified.ok || !verified.data.access_token) return reply(401, '재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 진행해 주세요.');
      token = verified.data.access_token;
    }
    const user = await upstream(env, '/auth/v1/user', { token });
    if (!user.ok || !user.data.id) return reply(user.status >= 500 ? 503 : 401, '재설정 링크를 확인하지 못했습니다. 비밀번호 찾기를 다시 진행해 주세요.');
    if (!hash && !hasRecentAuthentication(token, user.data.id, 'recovery', 60 * 60000))
      return reply(401, '비밀번호 재설정 메일의 링크로 다시 접속해 주세요.');
    const changed = await upstream(env, '/auth/v1/user', { method: 'PUT', token, body: { password: body.password } });
    if (!changed.ok) return reply(changed.status >= 500 ? 503 : 400, '비밀번호를 변경하지 못했습니다. 기존과 다른 12~128자의 비밀번호로 다시 시도해 주세요.');
    let revoked = false;
    try { revoked = (await upstream(env, '/auth/v1/logout?scope=global', { method: 'POST', token })).ok; } catch { /* The password has already changed; never report it as failed. */ }
    return reply(200, revoked ? '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.' : '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요. 다른 기기의 로그인 종료는 지연될 수 있습니다.',
      { changed: true }, clearCookies());
  } catch { return reply(503, '비밀번호 재설정에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
}
