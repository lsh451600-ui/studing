import { settings, reply, currentSession, publicUser } from '../../src/member-auth.js';
import { memberProfile } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, '지원하지 않는 요청입니다.');
  if (!settings(env).ready) return reply(200, '', { available: false, authenticated: false });
  try {
    const session = await currentSession(request, env);
    const profile = session.user ? await memberProfile(env, session) : null;
    return reply(200, '', { available: true, authenticated: Boolean(session.user), needsProfile: Boolean(session.user && !profile), user: session.user ? { ...publicUser(session.user), username: profile?.username || '회원' } : null }, session.cookies);
  } catch { return reply(503, '로그인 상태를 확인하지 못했습니다.'); }
}
