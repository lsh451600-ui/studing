import { reply, sameOrigin } from '../../src/member-auth.js';
import { readJSON } from '../../src/recipe-server.js';
import { initialize, member, allowWrite, idOf, postPermissions } from '../../src/community.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return reply(405, '지원하지 않는 요청입니다.');
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403, '홈페이지에서 다시 시도해 주세요.');
  const db = env.MEMBERS_DB;
  if (!db) return reply(503, '게시판 저장소 연결이 필요합니다.', { reason: 'storage_not_configured' });
  try {
    await initialize(db);
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if (params.has('id')) {
        const id = idOf(params.get('id')); if (!id) return reply(400, '게시물 번호를 확인해 주세요.');
        const row = await db.prepare('SELECT id, author_id, author, title, body, created_at, views FROM community_posts WHERE id = ?').bind(id).first();
        if (!row) return reply(404, '게시물이 없습니다.');
        const comments = await db.prepare('SELECT id, author_id, author, body, created_at FROM community_comments WHERE post_id = ? ORDER BY id DESC LIMIT 100').bind(id).all();
        const { deletableCommentIds, ...permissions } = await postPermissions(request, env, row.author_id, comments.results);
        const { author_id, ...post } = row;
        return reply(200, '', { post, comments: comments.results.reverse().map(({ author_id, ...comment }) => ({ ...comment, canEdit: deletableCommentIds.includes(comment.id), canDelete: deletableCommentIds.includes(comment.id) })), permissions });
      }
      const before = params.has('before') ? idOf(params.get('before')) : null;
      if (params.has('before') && !before) return reply(400, '페이지 정보를 확인해 주세요.');
      const search = (params.get('q') || '').trim();
      if (search.length > 100) return reply(400, '검색어는 100자 이내로 입력해 주세요.');
      const fields = 'p.id, p.author, p.title, p.created_at, p.views, (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comments';
      const filters = [], values = [];
      if (search) { filters.push('(instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.body), lower(?)) > 0)'); values.push(search, search); }
      if (before) { filters.push('p.id < ?'); values.push(before); }
      const query = db.prepare('SELECT ' + fields + ' FROM community_posts p' + (filters.length ? ' WHERE ' + filters.join(' AND ') : '') + ' ORDER BY p.id DESC LIMIT 21').bind(...values);
      const rows = (await query.all()).results, posts = rows.slice(0, 20);
      return reply(200, '', { posts, next: rows.length > 20 ? posts.at(-1).id : null });
    }
    const auth = await member(request, env); if (auth.response) return auth.response;
    const params = new URL(request.url).searchParams;
    const id = idOf(params.get('id'));
    if (request.method !== 'POST' && !id) return reply(400, '게시물 번호를 확인해 주세요.', {}, auth.session.cookies);
    let data;
    if (request.method !== 'DELETE') {
      try { data = await readJSON(request, 65536); } catch { return reply(400, '입력 내용을 확인해 주세요.', {}, auth.session.cookies); }
    }
    if (request.method === 'PATCH' || request.method === 'DELETE') {
      const post = await db.prepare('SELECT id, author_id FROM community_posts WHERE id = ?').bind(id).first();
      if (!post) return reply(404, '게시물이 없습니다.', {}, auth.session.cookies);
      if (request.method === 'DELETE') {
        if (post.author_id !== auth.session.user.id && !auth.isAdmin) return reply(403, '작성자 또는 운영자만 삭제할 수 있습니다.', {}, auth.session.cookies);
        await db.batch([
          db.prepare('DELETE FROM community_comments WHERE post_id = ?').bind(id),
          db.prepare('DELETE FROM community_posts WHERE id = ?').bind(id)
        ]);
        return reply(200, '게시물을 삭제했습니다.', { id }, auth.session.cookies);
      }
      if (post.author_id !== auth.session.user.id && !auth.isAdmin) return reply(403, '작성자 또는 운영자만 수정할 수 있습니다.', {}, auth.session.cookies);
      const title = typeof data.title === 'string' ? data.title.trim() : '', body = typeof data.body === 'string' ? data.body.trim() : '';
      if (!title || title.length > 100 || !body || body.length > 10000) return reply(400, '제목은 100자, 내용은 10,000자 이내로 입력해 주세요.', {}, auth.session.cookies);
      await db.prepare('UPDATE community_posts SET title = ?, body = ? WHERE id = ?').bind(title, body, id).run();
      return reply(200, '게시물을 수정했습니다.', { id }, auth.session.cookies);
    }
    const title = typeof data.title === 'string' ? data.title.trim() : '', body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!title || title.length > 100 || !body || body.length > 10000) return reply(400, '제목은 100자, 내용은 10,000자 이내로 입력해 주세요.', {}, auth.session.cookies);
    if (!await allowWrite(db, auth.session.user.id, 'post')) return reply(429, '글 작성이 많습니다. 잠시 후 다시 시도해 주세요.', {}, auth.session.cookies);
    const result = await db.prepare('INSERT INTO community_posts (author_id, author, title, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(auth.session.user.id, auth.author, title, body, new Date().toISOString()).run();
    return reply(201, '등록했습니다.', { id: result.meta.last_row_id }, auth.session.cookies);
  } catch { return reply(503, '게시판에 연결하지 못했습니다. 작성 내용은 유지됩니다.'); }
}
