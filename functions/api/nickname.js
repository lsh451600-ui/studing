import { savedNickname, storeNickname } from '../../src/member-nicknames.js';
import { settings, reply, sameOrigin, readJSON, currentSession, upstream } from '../../src/member-auth.js';

const validNickname = value => typeof value === 'string'
  && Array.from(value.trim()).length >= 1
  && Array.from(value.trim()).length <= 40
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!settings(env).ready) return reply(503, '회원 정보 연결을 준비 중입니다.');
  let session;
  try {
    session = await currentSession(request, env);
    if (!session.user) return reply(401, '로그인 후 이용해 주세요.', {}, session.cookies);
    let data;
    try { data = await readJSON(request); } catch { return reply(400, '닉네임을 확인해 주세요.', {}, session.cookies); }
    if (!validNickname(data?.nickname)) return reply(400, '닉네임은 공백이 아닌 1~40자로 입력해 주세요.', {}, session.cookies);
    const nickname = data.nickname.trim();
    const db = env.MEMBERS_DB;
    if (db) {
      // Check names that predate the D1 nickname store, without relying on an RPC migration.
      const pattern = nickname.replace(/[\\%_]/g, value => '\\' + value);
      const existing = await upstream(env, '/rest/v1/member_profiles?select=id&nickname=ilike.' + encodeURIComponent(pattern), { privileged: true });
      if (existing.ok && Array.isArray(existing.data)) {
        for (const profile of existing.data) {
          if (profile.id === session.user.id) continue;
          const override = await savedNickname(db, profile.id);
          if (!override || override.toLowerCase() === nickname.toLowerCase()) return reply(409, '이미 사용 중인 닉네임입니다.', {}, session.cookies);
        }
      } else if (!(['42703', 'PGRST204', 'PGRST205'].includes(existing.data?.code))) {
        return reply(503, '닉네임을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session.cookies);
      }
      try { await storeNickname(db, session.user.id, nickname); }
      catch (error) {
        if (/unique constraint/i.test(String(error?.message))) return reply(409, '이미 사용 중인 닉네임입니다.', {}, session.cookies);
        throw error;
      }
      if (await savedNickname(db, session.user.id) !== nickname) throw new Error('nickname_not_persisted');
    } else {
      const result = await upstream(env, '/rest/v1/rpc/update_member_nickname', {
        method: 'POST', token: session.access, body: { requested_nickname: nickname }
      });
      if (!result.ok) {
        if (result.status === 409 || result.data.code === '23505') return reply(409, '이미 사용 중인 닉네임입니다.', {}, session.cookies);
        if (result.status === 400 || result.data.code === '22023') return reply(400, '닉네임 형식을 확인해 주세요.', {}, session.cookies);
        return reply(503, '닉네임을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session.cookies);
      }
    }

    // Keep older community posts and comments consistent with the profile name.
    if (db) {
      try {
        await db.batch([
          db.prepare('UPDATE community_posts SET author = ? WHERE author_id = ?').bind(nickname, session.user.id),
          db.prepare('UPDATE community_comments SET author = ? WHERE author_id = ?').bind(nickname, session.user.id)
        ]);
      } catch { /* Nickname changes still succeed if the optional board store is unavailable. */ }
    }
    if (db) {
      try { await db.prepare('UPDATE recipe_comments SET author = ? WHERE author_id = ?').bind(nickname, session.user.id).run(); }
      catch { /* Recipes may not have comments yet. */ }
    }
    if (db) {
      try { await db.prepare('UPDATE private_comments SET author = ? WHERE author_id = ?').bind(nickname, session.user.id).run(); }
      catch { /* Industry comments may not exist yet. */ }
    }
    return reply(200, '닉네임을 저장했습니다.', { nickname }, session.cookies);
  } catch {
    return reply(503, '회원 정보에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', {}, session?.cookies || []);
  }
}
