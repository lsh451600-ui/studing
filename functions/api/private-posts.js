import { reply, sameOrigin, readJSON, authorized, ensurePosts, listPosts, validatePost } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (request.method === 'POST' && !sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  if (!await authorized(request, env, request.method === 'POST' ? 'admin' : 'viewer')) return reply(403, { message: request.method === 'POST' ? '작성자 인증이 필요합니다.' : '비밀자료 비밀번호를 다시 입력해 주세요.' });
  if (!env.MEMBERS_DB) return reply(503, { message: '게시판을 준비 중입니다.' });
  try {
    const db = env.MEMBERS_DB;
    if (request.method === 'GET') {
      const raw = new URL(request.url).searchParams.get('before');
      if (raw !== null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) return reply(400, { message: '페이지 정보를 확인해 주세요.' });
      return reply(200, await listPosts(db, raw ? Number(raw) : null));
    }
    let post;
    try { post = validatePost(await readJSON(request, 1600000)); }
    catch (error) { return reply(400, { message: ['invalid', 'too_large'].includes(error.message) ? '입력 내용과 이미지 크기를 확인해 주세요.' : error.message }); }
    await ensurePosts(db);
    const result = await db.prepare('INSERT INTO private_posts (title, body, image_base64, image_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(post.title, post.body, post.imageBase64, post.imageType, new Date().toISOString()).run();
    return reply(201, { message: '게시물을 올렸습니다.', id: result.meta.last_row_id });
  } catch { return reply(503, { message: '게시물을 저장하지 못했습니다. 작성 내용은 유지됩니다.' }); }
}
