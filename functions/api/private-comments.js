import { reply, sameOrigin } from '../../src/member-auth.js';
import { readJSON, authorized } from '../../src/recipe-server.js';
import { member, allowWrite, idOf } from '../../src/community.js';
import { ensureComments } from '../../src/private-server.js';
import { boardIdentity, canManagePost } from '../../src/board-permissions.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return reply(405, '지원하지 않는 요청입니다.');
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  if (!env.MEMBERS_DB) return reply(503, '댓글 저장소에 연결하지 못했습니다.');
  try {
    const db = env.MEMBERS_DB; await ensureComments(db);
    const params = new URL(request.url).searchParams;
    if (request.method === 'GET') {
      const postId = idOf(params.get('postId'));
      if (!postId) return reply(400, '자료 번호를 확인해 주세요.', {});
      if (!await db.prepare('SELECT id FROM private_posts WHERE id = ?').bind(postId).first()) return reply(404, '자료가 없습니다.', {});
      const { results } = await db.prepare('SELECT id, author_id, author, body, created_at FROM private_comments WHERE post_id = ? ORDER BY id').bind(postId).all();
      const identity = await boardIdentity(request, env);
      const comments = results.map(({ author_id, ...comment }) => ({ ...comment, canEdit: canManagePost(identity, author_id), canDelete: canManagePost(identity, author_id) }));
      return reply(200, '', { comments });
    }
    const auth = await member(request, env); if (auth.response) return auth.response;
    if (request.method === 'PATCH' || request.method === 'DELETE') {
      const id = idOf(params.get('id'));
      if (!id) return reply(400, '댓글 번호를 확인해 주세요.', {}, auth.session.cookies);
      const comment = await db.prepare('SELECT id, author_id FROM private_comments WHERE id = ?').bind(id).first();
      if (!comment) return reply(404, '댓글이 없습니다.', {}, auth.session.cookies);
      if (comment.author_id !== auth.session.user.id && !auth.isAdmin) return reply(403, '작성자 또는 운영자만 댓글을 수정·삭제할 수 있습니다.', {}, auth.session.cookies);
      if (request.method === 'DELETE') {
        await db.prepare('DELETE FROM private_comments WHERE id = ?').bind(id).run();
        return reply(200, '댓글을 삭제했습니다.', { id }, auth.session.cookies);
      }
      let data;
      try { data = await readJSON(request, 16384); } catch { return reply(400, '입력 내용을 확인해 주세요.', {}, auth.session.cookies); }
      const body = typeof data?.body === 'string' ? data.body.trim() : '';
      if (!body || body.length > 2000) return reply(400, '댓글은 2,000자 이내로 입력해 주세요.', {}, auth.session.cookies);
      await db.prepare('UPDATE private_comments SET body = ? WHERE id = ?').bind(body, id).run();
      return reply(200, '댓글을 수정했습니다.', { id }, auth.session.cookies);
    }
    let data;
    try { data = await readJSON(request, 16384); } catch { return reply(400, '입력 내용을 확인해 주세요.', {}, auth.session.cookies); }
    const postId = idOf(data?.postId), body = typeof data?.body === 'string' ? data.body.trim() : '';
    if (!postId || !body || body.length > 2000) return reply(400, '댓글은 2,000자 이내로 입력해 주세요.', {}, auth.session.cookies);
    if (!await db.prepare('SELECT id FROM private_posts WHERE id = ?').bind(postId).first()) return reply(404, '자료가 없습니다.', {}, auth.session.cookies);
    if (!await allowWrite(db, auth.session.user.id, 'industry-comment')) return reply(429, '댓글 작성이 많습니다. 잠시 후 다시 시도해 주세요.', {}, auth.session.cookies);
    const result = await db.prepare('INSERT INTO private_comments (post_id, author_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(postId, auth.session.user.id, auth.author, body, new Date().toISOString()).run();
    return reply(201, '댓글을 등록했습니다.', { id: result.meta.last_row_id }, auth.session.cookies);
  } catch { return reply(503, '댓글 처리에 실패했습니다. 작성 내용은 유지됩니다.'); }
}
