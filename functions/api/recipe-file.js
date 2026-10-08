import { authorized, reply } from '../../src/recipe-server.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (!await authorized(request, env)) return reply(403, { message: '레시피 비밀번호를 먼저 입력해 주세요.' });
  if (!env.MEMBERS_DB) return reply(503, { message: '첨부 파일을 불러오지 못했습니다.' });
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return reply(400, { message: '첨부 파일 정보를 확인해 주세요.' });
  try {
    const row = await env.MEMBERS_DB.prepare('SELECT attachment_base64, attachment_name FROM recipe_posts WHERE id = ?').bind(Number(id)).first();
    if (!row?.attachment_base64 || !row.attachment_name) return reply(404, { message: '첨부 파일이 없습니다.' });
    const encodedName = encodeURIComponent(row.attachment_name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    return new Response(Uint8Array.from(atob(row.attachment_base64), char => char.charCodeAt(0)), { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex'
    }});
  } catch { return reply(503, { message: '첨부 파일을 불러오지 못했습니다.' }); }
}
