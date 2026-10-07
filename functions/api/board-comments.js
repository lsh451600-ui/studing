import { reply, sameOrigin } from '../../src/member-auth.js';
import { readJSON } from '../../src/recipe-server.js';
import { initialize, member, allowWrite, idOf } from '../../src/community.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!env.MEMBERS_DB) return reply(503, '게시판 저장소 연결이 필요합니다.', { reason: 'storage_not_configured' });
  try {
    const db = env.MEMBERS_DB; await initialize(db);
    const auth = await member(request, env); if (auth.response) return auth.response;
    let data;
    try { data = await readJSON(request, 16384); } catch { return reply(400, '입력 내용을 확인해 주세요.', {}, auth.session.cookies); }
    const postId = idOf(data.postId), body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!postId || !body || body.length > 2000) return reply(400, '댓글은 2,000자 이내로 입력해 주세요.', {}, auth.session.cookies);
    if (!await db.prepare('SELECT id FROM community_posts WHERE id = ?').bind(postId).first()) return reply(404, '게시물이 없습니다.', {}, auth.session.cookies);
    if (!await allowWrite(db, auth.session.user.id, 'comment')) return reply(429, '댓글 작성이 많습니다. 잠시 후 다시 시도해 주세요.', {}, auth.session.cookies);
    const result = await db.prepare('INSERT INTO community_comments (post_id, author_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(postId, auth.session.user.id, auth.author, body, new Date().toISOString()).run();
    return reply(201, '댓글을 등록했습니다.', { id: result.meta.last_row_id }, auth.session.cookies);
  } catch { return reply(503, '댓글을 저장하지 못했습니다. 작성 내용은 유지됩니다.'); }
}
