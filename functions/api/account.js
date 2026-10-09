import { levelOf } from '../../src/member-levels.js';
import { isOperator } from '../../src/board-permissions.js';
import { settings, reply, sameOrigin, readJSON, currentSession, upstream, clearCookies, limitAttempts } from '../../src/member-auth.js';
import { hasRecentAuthentication } from '../../src/account-auth.js';
import { memberProfile, clearOAuth } from '../../src/social-auth.js';

export async function onRequest({ request, env }) {
  if (!['GET', 'DELETE'].includes(request.method)) return reply(405, '지원하지 않는 요청입니다.');
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '회원 정보 연결을 준비 중입니다.');
  let session;
  try {
    session = await currentSession(request, env);
    if (!session.user) return reply(401, '로그인 후 이용해 주세요.', {}, session.cookies);
    const user = session.user;
    const providers = [...new Set([...(user.identities || []).map(identity => identity.provider), ...(user.app_metadata?.providers || [])])];
    if (!providers.length) providers.push(user.app_metadata?.provider || 'email');
    if (request.method === 'GET') {
      const profile = await memberProfile(env, session);
      return reply(200, '', { account: { username: profile?.username || user.user_metadata?.username || '회원',
        nickname: profile?.nickname || '', level: await levelOf(env.MEMBERS_DB, user.id), isAdmin: isOperator(profile),
        email: user.email || '', phone: profile?.phone || '', createdAt: user.created_at || null,
        providers, passwordRequired: providers.includes('email') } }, session.cookies);
    }
    let body;
    try { body = await readJSON(request); } catch { return reply(400, '입력 내용을 확인해 주세요.', {}, session.cookies); }
    if (body?.confirmation !== '회원탈퇴') return reply(400, '확인란에 회원탈퇴를 입력해 주세요.', {}, session.cookies);
    if (!await limitAttempts(request, env, 'withdrawal', 5)) return reply(429, '본인 확인 시도가 많습니다. 15분 후 다시 시도해 주세요.', {}, session.cookies);
    if (providers.includes('email')) {
      if (typeof body.password !== 'string' || !body.password || body.password.length > 128 || !user.email)
        return reply(400, '현재 비밀번호를 입력해 주세요.', {}, session.cookies);
      const verified = await upstream(env, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: user.email, password: body.password } });
      if (!verified.ok || verified.data.user?.id !== user.id) return reply(verified.status >= 500 ? 503 : 401, '비밀번호를 확인하지 못했습니다. 다시 시도해 주세요.', {}, session.cookies);
    } else {
      if (!hasRecentAuthentication(session.access, user.id, 'oauth', 10 * 60000))
        return reply(409, '본인 확인을 위해 로그아웃 후 소셜 계정으로 다시 로그인하고 10분 안에 탈퇴해 주세요.', {}, session.cookies);
    }
    // Derive the target exclusively from the verified session, never from request JSON.
    const removed = await upstream(env, '/auth/v1/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE', privileged: true, body: { should_soft_delete: false } });
    if (!removed.ok) return reply(503, '회원탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session.cookies);
    return reply(200, '회원탈퇴가 완료되었습니다.', { authenticated: false }, [...clearCookies(), clearOAuth(), clearOAuth('kakao')]);
  } catch { return reply(503, '회원 정보에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session?.cookies || []); }
}
