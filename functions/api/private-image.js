import { authorized, reply } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (!await authorized(request, env)) return reply(403, { message: '비밀자료 비밀번호를 먼저 입력해 주세요.' });
  if (!env.MEMBERS_DB) return reply(503, { message: '이미지에 연결하지 못했습니다.' });
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return reply(400, { message: '이미지 정보를 확인해 주세요.' });
  try {
    const row = await env.MEMBERS_DB.prepare('SELECT image_base64, image_type FROM private_posts WHERE id = ?').bind(Number(id)).first();
    if (!row?.image_base64) return reply(404, { message: '이미지가 없습니다.' });
    return new Response(Uint8Array.from(atob(row.image_base64), c => c.charCodeAt(0)), { headers: {
      'Content-Type': row.image_type, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
    }});
  } catch { return reply(503, { message: '이미지를 불러오지 못했습니다.' }); }
}
