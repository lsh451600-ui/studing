import { authorLevels } from '../../src/member-levels.js';
import { reply, sameOrigin } from '../../src/member-auth.js';
import { readJSON } from '../../src/recipe-server.js';
import { member, allowWrite, idOf, postPermissions } from '../../src/community.js';
import { initialize, formattedBody } from '../../src/trend-community.js';
export async function onRequest({ request, env }) {
  if (!['GET','POST','PATCH','DELETE'].includes(request.method)) return reply(405,'지원하지 않는 요청입니다.');
  if (request.method !== 'GET' && !sameOrigin(request)) return reply(403,'홈페이지에서 다시 시도해 주세요.');
  const db = env.MEMBERS_DB;
  if (!db) return reply(503,'게시판 저장소 연결이 필요합니다.');
  try {
    await initialize(db);
    const params = new URL(request.url).searchParams, id = idOf(params.get('id'));
    if (request.method === 'GET') {
      if (params.has('id')) {
        if (!id) return reply(400,'게시물 번호를 확인해 주세요.');
        const row = await db.prepare('SELECT * FROM trend_posts WHERE id = ?').bind(id).first();
        if (!row) return reply(404,'게시물이 없습니다.');
        const auth = await member(request,env), operator = !auth.response && auth.isAdmin;
        if (row.is_secret && !operator) return reply(403,'비밀글은 운영자만 볼 수 있습니다.');
        const comments = (await db.prepare('SELECT * FROM trend_comments WHERE post_id = ? ORDER BY id DESC LIMIT 100').bind(id).all()).results;
        const permissions = await postPermissions(request,env,row.author_id,comments);
        const [post] = await authorLevels(db,[row]);
        return reply(200,'',{post:{...post,richBody:row.rich_body ? JSON.parse(row.rich_body) : null},comments:(await authorLevels(db,comments)).reverse().map(comment=>({...comment,canEdit:permissions.deletableCommentIds.includes(comment.id),canDelete:permissions.deletableCommentIds.includes(comment.id)})),permissions:{canEdit:operator,canDelete:operator}});
      }
      const before = params.has('before') ? idOf(params.get('before')) : null;
      if (params.has('before') && !before) return reply(400,'페이지 정보를 확인해 주세요.');
      const rows = (await db.prepare('SELECT p.id,p.author_id,p.author,p.title,p.is_secret,p.created_at,p.views,(SELECT COUNT(*) FROM trend_comments c WHERE c.post_id=p.id) AS comments FROM trend_posts p'+(before?' WHERE p.id < ?':'')+' ORDER BY p.id DESC LIMIT 21').bind(...(before?[before]:[])).all()).results;
      return reply(200,'',{posts:await authorLevels(db,rows.slice(0,20)),next:rows.length>20?rows[19].id:null});
    }
    const auth = await member(request,env);
    if (auth.response) return auth.response;
    if (!auth.isAdmin) return reply(403,'트렌드 글은 운영자만 작성·수정·삭제할 수 있습니다.');
    if (request.method !== 'POST') {
      if (!id) return reply(400,'게시물 번호를 확인해 주세요.');
      if (!await db.prepare('SELECT id FROM trend_posts WHERE id = ?').bind(id).first()) return reply(404,'게시물이 없습니다.');
    }
    if (request.method === 'DELETE') {
      await db.batch([db.prepare('DELETE FROM trend_comments WHERE post_id = ?').bind(id),db.prepare('DELETE FROM trend_posts WHERE id = ?').bind(id)]);
      return reply(200,'게시물을 삭제했습니다.',{id});
    }
    let data, formatted;
    try { data = await readJSON(request,150000); formatted = formattedBody(data); }
    catch { return reply(400,'입력 내용과 글 서식을 확인해 주세요.'); }
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title || title.length>100 || !formatted.body.trim() || formatted.body.length>10000) return reply(400,'제목은 100자, 내용은 10,000자 이내로 입력해 주세요.');
    if (data.is_secret !== undefined && typeof data.is_secret !== 'boolean') return reply(400,'비밀글 설정을 확인해 주세요.');
    if (request.method === 'PATCH') {
      await db.prepare('UPDATE trend_posts SET title=?,body=?,rich_body=?,is_secret=? WHERE id=?').bind(title,formatted.body,formatted.rich,Number(data.is_secret===true),id).run();
      return reply(200,'게시물을 수정했습니다.',{id});
    }
    if (!await allowWrite(db,auth.session.user.id,'post')) return reply(429,'글 작성이 많습니다. 잠시 후 다시 시도해 주세요.');
    const result = await db.prepare('INSERT INTO trend_posts (author_id,author,title,body,rich_body,is_secret,created_at) VALUES (?,?,?,?,?,?,?)').bind(auth.session.user.id,auth.author,title,formatted.body,formatted.rich,Number(data.is_secret===true),new Date().toISOString()).run();
    return reply(201,'등록했습니다.',{id:result.meta.last_row_id});
  } catch { return reply(503,'트렌드 게시판에 연결하지 못했습니다. 작성 내용은 유지됩니다.'); }
}
