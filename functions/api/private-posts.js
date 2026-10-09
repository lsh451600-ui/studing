import { boardIdentity, canManagePost } from '../../src/board-permissions.js';
import { idOf } from '../../src/community.js';
import { authorized, reply, sameOrigin, readJSON, ensureComments, ensurePosts, listPosts, validatePost } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  try {
    if (!await authorized(request, env)) return reply(403, { message: '특별회원 로그인과 자료 비밀번호를 확인해 주세요.' });
    const identity = await boardIdentity(request, env);
    const canWrite = Boolean(identity?.isAdmin);
    if (request.method === 'POST' && !canWrite) return reply(403, { message: '운영자 계정으로 로그인해 주세요.' });
    const db = env.MEMBERS_DB;
    if (!db) return reply(503, { message: '게시판을 준비 중입니다.' });
    if (request.method === 'PATCH' || request.method === 'DELETE') {
      const id = idOf(new URL(request.url).searchParams.get('id'));
      if (!id) return reply(400, { message: '게시물 번호를 확인해 주세요.' });
      await ensurePosts(db);
      const post = await db.prepare('SELECT id, author_id FROM private_posts WHERE id = ?').bind(id).first();
      if (!post) return reply(404, { message: '게시물이 없습니다.' });
      if (!canManagePost(identity, post.author_id)) return reply(403, { message: '작성자 또는 운영자만 수정·삭제할 수 있습니다.' });
      if (request.method === 'DELETE') {
        await ensureComments(db);
        await db.prepare('DELETE FROM private_comments WHERE post_id = ?').bind(id).run();
        await db.prepare('DELETE FROM private_posts WHERE id = ?').bind(id).run();
        return reply(200, { message: '게시물을 삭제했습니다.', id });
      }
      let data;
      try { data = await readJSON(request, 65536); } catch { return reply(400, { message: '입력 내용을 확인해 주세요.' }); }
      let updated;
      try { updated = validatePost(data); } catch (error) { return reply(400, { message: error.message }); }
      await db.prepare('UPDATE private_posts SET title = ?, body = ? WHERE id = ?').bind(updated.title, updated.body, id).run();
      return reply(200, { message: '게시물을 수정했습니다.', id });
    }
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const raw = params.get('before');
      const page = params.get('page') || '1', q = (params.get('q') || '').trim(), sort = params.get('sort') || 'latest';
      if (!/^[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(Number(page)) || q.length > 100 || !['latest', 'title', 'downloads'].includes(sort)) return reply(400, { message: '검색 조건을 확인해 주세요.' });
      if (raw !== null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) return reply(400, { message: '페이지 정보를 확인해 주세요.' });
      return reply(200, await listPosts(db, raw ? Number(raw) : null, { identity, page: Number(page), q, sort }));
    }
    let post;
    try { post = validatePost(await readJSON(request, 2300000)); }
    catch (error) { return reply(400, { message: ['invalid', 'too_large'].includes(error.message) ? '입력 내용과 이미지 크기를 확인해 주세요.' : error.message }); }
    await ensurePosts(db);
    const result = await db.prepare('INSERT INTO private_posts (author_id, title, body, image_base64, image_type, attachment_base64, attachment_name, attachment_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(identity?.id || null, post.title, post.body, post.imageBase64, post.imageType, post.attachmentBase64, post.attachmentName, post.attachmentType, new Date().toISOString()).run();
    return reply(201, { message: '게시물을 올렸습니다.', id: result.meta.last_row_id });
  } catch { return reply(503, { message: '게시물을 저장하지 못했습니다. 작성 내용은 유지됩니다.' }); }
}
