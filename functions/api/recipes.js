import { membership } from '../../src/member-levels.js';
import { boardIdentity } from '../../src/board-permissions.js';
import { reply, sameOrigin, readJSON, matchesPassword, sessionCookie, clearCookie, rateLimit, listPosts, adminReady } from '../../src/recipe-server.js';
export { matchesPassword } from '../../src/recipe-server.js';
export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    try {
      const auth = await membership(request, env);
      if (!auth.canAccessRecipes) return reply(auth.authenticated ? 403 : 401, { message: '레시피는 특별회원만 이용할 수 있습니다.' });
      return reply(200, { available: auth.isAdmin || Boolean(env.RECIPE_PASSWORD), isAdmin: auth.isAdmin });
    } catch { return reply(503, { message: '회원 등급을 확인하지 못했습니다.' }); }
  }
  if (!['POST', 'DELETE'].includes(request.method)) return reply(405, { message: '지원하지 않는 요청입니다.' });
  if (!sameOrigin(request)) return reply(403, { message: '홈페이지에서 다시 시도해 주세요.' });
  if (request.method === 'DELETE') return reply(200, { message: '잠금 처리했습니다.' }, [clearCookie('viewer'), clearCookie('admin')]);
  try {
    const auth = await membership(request, env);
    if (!auth.canAccessRecipes) return reply(auth.authenticated ? 403 : 401, { message: '레시피는 특별회원만 이용할 수 있습니다.' });
    if (auth.isAdmin) {
      const identity = { id: auth.id, isAdmin: true };
      const listing = env.MEMBERS_DB ? await listPosts(env.MEMBERS_DB, null, { identity }) : { posts: [], next: null };
      return reply(200, { title: '레시피', ...listing, storageAvailable: Boolean(env.MEMBERS_DB), adminConfigured: true, accountWriter: true, canWrite: true }, auth.session.cookies);
    }
  } catch { return reply(503, { message: '회원 등급을 확인하지 못했습니다.' }); }
  if (!env.RECIPE_PASSWORD) return reply(503, { message: '레시피 페이지를 준비 중입니다.' });
  let data;
  try { data = await readJSON(request); } catch { return reply(400, { message: '입력 내용을 확인해 주세요.' }); }
  if (typeof data?.password !== 'string' || !data.password.length || data.password.length > 128) return reply(400, { message: '비밀번호를 입력해 주세요.' });
  try {
    if (!await rateLimit(request, env.MEMBERS_DB, 'viewer')) return reply(429, { message: '입력 시도가 많습니다. 15분 후 다시 시도해 주세요.' });
    const passwordCanWrite = adminReady(env) && await matchesPassword(data.password, env.RECIPE_ADMIN_PASSWORD);
    if (!passwordCanWrite && !await matchesPassword(data.password, env.RECIPE_PASSWORD)) return reply(401, { message: '비밀번호가 맞지 않습니다. 다시 입력해 주세요.' });
    const identity = await boardIdentity(request, env);
    const canWrite = Boolean(identity?.isAdmin);
    const listing = env.MEMBERS_DB ? await listPosts(env.MEMBERS_DB, null, { identity }) : { posts: [], next: null };
    return reply(200, { title: '레시피', ...listing, storageAvailable: Boolean(env.MEMBERS_DB), adminConfigured: adminReady(env) || Boolean(identity?.isAdmin), accountWriter: Boolean(identity?.isAdmin), canWrite }, [await sessionCookie(env, 'viewer'), passwordCanWrite ? await sessionCookie(env, 'admin') : clearCookie('admin')]);
  } catch { return reply(503, { message: '게시판에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
}

