import { reply } from '../../src/member-auth.js';
import { member } from '../../src/community.js';
import { initialize } from '../../src/trend-community.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405,'지원하지 않는 요청입니다.');
  if (!env.MEMBERS_DB) return reply(503,'게시판 저장소 연결이 필요합니다.');
  try {
    const db = env.MEMBERS_DB;
    await initialize(db);
    const id = new URL(request.url).searchParams.get('id');
    if (!/^[a-f0-9-]{36}$/.test(id || '')) return reply(400,'파일 번호를 확인해 주세요.');
    const file = await db.prepare('SELECT f.*,p.is_secret FROM trend_files f JOIN trend_posts p ON p.id=f.post_id WHERE f.id=?').bind(id).first();
    if (!file) return reply(404,'파일이 없습니다.');
    if (file.is_secret) {
      const auth = await member(request,env);
      if (auth.response || !auth.isAdmin) return reply(403,'비밀글은 운영자만 볼 수 있습니다.');
    }
    return new Response(Uint8Array.from(atob(file.data), char => char.charCodeAt(0)), { headers: {
      'Content-Type':'application/octet-stream',
      'Content-Disposition':"attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'X-Robots-Tag':'noindex, nofollow'
    }});
  } catch { return reply(503,'파일을 불러오지 못했습니다.'); }
}
