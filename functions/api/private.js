import { membership } from '../../src/member-levels.js';
import { reply, sameOrigin, listPosts, clearCookie } from '../../src/private-server.js';
export { matchesPassword } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  if (request.method === 'DELETE') return reply(200, { message: '회원 권한으로 접근합니다.' }, [clearCookie('viewer'), clearCookie('admin')]);
  try {
    const auth = await membership(request, env);
    if (!auth.canAccessRecipes) return reply(auth.authenticated ? 403 : 401, { message: '외식 산업 자료는 특별회원만 이용할 수 있습니다. 자유게시판에서 등업을 신청해 주세요.' });
    const identity = { id: auth.id, isAdmin: auth.isAdmin };
    const listing = env.MEMBERS_DB ? await listPosts(env.MEMBERS_DB, null, { identity }) : { posts: [], next: null };
    return reply(200, { available: true, isAdmin: auth.isAdmin, title: '외식 산업 자료', ...listing, storageAvailable: Boolean(env.MEMBERS_DB), adminConfigured: auth.isAdmin, accountWriter: auth.isAdmin, canWrite: auth.isAdmin }, auth.session.cookies);
  } catch { return reply(503, { message: '회원 권한 또는 자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
}
