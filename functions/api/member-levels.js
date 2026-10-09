import { membership, ensureLevels } from '../../src/member-levels.js';
import { reply, sameOrigin, readJSON, upstream } from '../../src/member-auth.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'PATCH'].includes(request.method)) return reply(405, '지원하지 않는 요청입니다.');
  if (request.method === 'PATCH' && !sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  try {
    const auth = await membership(request, env);
    if (!auth.authenticated) return reply(401, '로그인 후 이용해 주세요.');
    if (!auth.isAdmin) return reply(403, '운영자만 회원 등급을 관리할 수 있습니다.');
    const db = env.MEMBERS_DB; if (!db) return reply(503, '회원 등급 저장소에 연결하지 못했습니다.');
    await ensureLevels(db);
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams, q = (params.get('q') || '').trim(), raw = params.get('page') || '1';
      if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || q.length > 100 || /[(),.*%"\\]/.test(q)) return reply(400, '검색 조건을 확인해 주세요.');
      const query = new URLSearchParams({ select: 'id,username,phone', order: 'username.asc,id.asc', limit: '21', offset: String((Number(raw) - 1) * 20) });
      if (q) query.set('username', 'ilike.*' + q + '*');
      const result = await upstream(env, '/rest/v1/member_profiles?' + query, { privileged: true });
      if (!result.ok || !Array.isArray(result.data)) return reply(503, '회원 목록을 불러오지 못했습니다.');
      const members = [];
      for (const profile of result.data.slice(0, 20)) {
        const record = await db.prepare('SELECT level FROM member_levels WHERE member_id = ?').bind(profile.id).first();
        members.push({ id: profile.id, username: profile.username, phone: profile.phone || '', level: record?.level || 'regular', isAdmin: profile.username?.toLowerCase() === 'lsh451600' });
      }
      return reply(200, '', { members, page: Number(raw), hasMore: result.data.length > 20 }, auth.session.cookies);
    }
    let body; try { body = await readJSON(request); } catch { return reply(400, '입력 내용을 확인해 주세요.'); }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.memberId || '') || !['regular', 'special'].includes(body?.level)) return reply(400, '회원과 등급을 확인해 주세요.');
    const target = await upstream(env, '/rest/v1/member_profiles?select=id,username&id=eq.' + encodeURIComponent(body.memberId), { privileged: true });
    if (!target.ok || !Array.isArray(target.data)) return reply(503, '회원 정보를 확인하지 못했습니다.');
    if (!target.data[0]) return reply(404, '회원이 없습니다.');
    if (target.data[0].username?.toLowerCase() === 'lsh451600') return reply(400, '운영자 권한은 회원 등급과 별도로 관리됩니다.');
    const previous = (await db.prepare('SELECT level FROM member_levels WHERE member_id = ?').bind(body.memberId).first())?.level || 'regular', now = new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO member_levels (member_id,level,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET level=excluded.level,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(body.memberId, body.level, auth.id, now),
      db.prepare('INSERT INTO member_level_audit (member_id,previous_level,level,updated_by,updated_at) VALUES (?,?,?,?,?)').bind(body.memberId, previous, body.level, auth.id, now)
    ]);
    return reply(200, '회원 등급을 변경했습니다.', { memberId: body.memberId, level: body.level }, auth.session.cookies);
  } catch { return reply(503, '회원 등급을 처리하지 못했습니다. 다시 시도해 주세요.'); }
}
