import { boardIdentity } from '../../src/board-permissions.js';
import { reply, listPosts } from '../../src/private-server.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return reply(405, { message: '자료는 비밀번호 없이 열람할 수 있습니다.' });
  try {
    const identity = await boardIdentity(request, env);
    const listing = env.MEMBERS_DB ? await listPosts(env.MEMBERS_DB, null, { identity }) : { posts: [], page: 1, total: 0, totalPages: 1 };
    return reply(200, { ...listing, title: '외식산업 자료', canWrite: Boolean(identity?.isAdmin), accountWriter: Boolean(identity?.isAdmin), adminConfigured: Boolean(identity?.isAdmin), storageAvailable: Boolean(env.MEMBERS_DB) });
  } catch { return reply(503, { message: '자료를 불러오지 못했습니다.' }); }
}
