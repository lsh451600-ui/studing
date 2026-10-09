import { reply, sameOrigin } from '../../src/member-auth.js';
import { initialize, idOf, postPermissions } from '../../src/community.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, '지원하지 않는 요청입니다.');
  if (!sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  const id = idOf(new URL(request.url).searchParams.get('id'));
  if (!id) return reply(400, '게시물 번호를 확인해 주세요.');
  if (!env.MEMBERS_DB) return reply(503, '게시판에 연결하지 못했습니다.');
  try {
    const db = env.MEMBERS_DB; await initialize(db);
    const target = await db.prepare('SELECT author_id, is_secret FROM community_posts WHERE id = ?').bind(id).first();
    if (!target) return reply(404, '게시물이 없습니다.');
    if (target.is_secret && !(await postPermissions(request, env, target.author_id)).canEdit) return reply(403, '비밀글은 작성자와 운영자만 볼 수 있습니다.');
    const name = '__Host-board-view-' + id;
    const counted = (request.headers.get('Cookie') || '').split(';').some(part => part.trim() === name + '=1');
    const post = counted
      ? await db.prepare('SELECT views FROM community_posts WHERE id = ?').bind(id).first()
      : await db.prepare('UPDATE community_posts SET views = views + 1 WHERE id = ? RETURNING views').bind(id).first();
    if (!post) return reply(404, '게시물이 없습니다.');
    return reply(200, '', { views: post.views }, counted ? [] : [name + '=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800']);
  } catch { return reply(503, '조회수를 반영하지 못했습니다.'); }
}
