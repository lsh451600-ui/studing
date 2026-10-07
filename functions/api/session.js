import { settings, reply, currentSession, publicUser } from '../../src/member-auth.js';
import { memberProfile } from '../../src/social-auth.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, '지원하지 않는 요청입니다.');
  if (!settings(env).ready) return reply(200, '', { available: false, authenticated: false });
  try {
    const session = await currentSession(request, env);
    let profile = null, profileUnavailable = false;
    if (session.user) {
      try { profile = await memberProfile(env, session); }
      catch { profileUnavailable = true; }
    }
    const provider = session.user?.app_metadata?.provider;
    const fallback = provider === 'kakao' ? '카카오 회원' : provider === 'google' ? '구글 회원' : publicUser(session.user || {}).username;
    return reply(200, '', { available: true, authenticated: Boolean(session.user),
      needsProfile: Boolean(session.user && !profile && !profileUnavailable), profileUnavailable,
      user: session.user ? { id: session.user.id, username: profile?.username || fallback } : null }, session.cookies);
  } catch { return reply(503, '로그인 상태를 확인하지 못했습니다.'); }
}
