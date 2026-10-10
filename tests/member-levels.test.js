import { onRequest as industry } from '../functions/api/private.js';
import { onRequest as industryPosts } from '../functions/api/private-posts.js';
import { onRequest as industryImage } from '../functions/api/private-image.js';
import { onRequest as industryFile } from '../functions/api/private-file.js';
import { onRequest as industryComments } from '../functions/api/private-comments.js';
import { sessionCookie as industryCookie } from '../src/private-server.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as levels } from '../functions/api/member-levels.js';
import { onRequest as recipes } from '../functions/api/recipes.js';
import { onRequest as recipePosts } from '../functions/api/recipe-posts.js';
import { onRequest as recipeImage } from '../functions/api/recipe-image.js';
import { onRequest as recipeFile } from '../functions/api/recipe-file.js';
import { onRequest as recipeComments } from '../functions/api/recipe-comments.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { authorLevels, ensureLevels } from '../src/member-levels.js';
import { sessionCookie } from '../src/recipe-server.js';
const adminId='11111111-1111-1111-1111-111111111111', targetId='22222222-2222-2222-2222-222222222222';
function setup(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const db={prepare(sql){const st=sqlite.prepare(sql);let v=[];return{bind(...a){v=a;return this},async run(){return st.run(...v)},async first(){return st.get(...v)||null},async all(){return{results:st.all(...v)}}}},async batch(qs){sqlite.exec('BEGIN');try{const out=[];for(const q of qs)out.push(await q.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  let admin=true;
  t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input);if(url.pathname==='/auth/v1/user')return Response.json({id:admin?adminId:targetId});if(['id,username','id,username,phone','id,username,nickname,phone'].includes(url.searchParams.get('select')))return Response.json([{id:targetId,username:'ordinary',nickname:'홍길동',phone:'01012345678'}]);return Response.json([{username:admin?'lsh451600':'ordinary',nickname:admin?'운영팀':'lsh451600'}])});
  const env={MEMBERS_DB:db,SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',RECIPE_PASSWORD:'reader-pass'};
  const req=(path,{method='GET',body,signed=true,origin='https://dining.win',cookie=''}={})=>new Request('https://dining.win'+path,{method,headers:{Origin:origin,Cookie:(signed?'__Host-member-access=verified; ':'')+cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return{env,req,db,setAdmin:value=>{admin=value}};
}
test('only verified operator can assign grades and changes are audited',async t=>{
  const {env,req,db,setAdmin}=setup(t);
  assert.equal((await levels({env,request:req('/api/member-levels',{signed:false})})).status,401);
  setAdmin(false);assert.equal((await levels({env,request:req('/api/member-levels')})).status,403);
  assert.equal((await levels({env,request:req('/api/member-levels',{method:'PATCH',body:{memberId:targetId,level:'special'}})})).status,403);
  setAdmin(true);const result=await levels({env,request:req('/api/member-levels',{method:'PATCH',body:{memberId:targetId,level:'special'}})});assert.equal(result.status,200);
  assert.equal((await db.prepare('SELECT level FROM member_levels WHERE member_id=?').bind(targetId).first()).level,'special');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM member_level_audit').first()).count,1);
  assert.equal((await levels({env,request:req('/api/member-levels',{method:'PATCH',origin:'https://other.test',body:{memberId:targetId,level:'regular'}})})).status,403);
  assert.equal((await levels({env,request:req('/api/member-levels',{method:'PATCH',body:{memberId:targetId,level:'admin'}})})).status,400);
});
test('general members cannot access any recipe endpoint; promotion and demotion take effect immediately',async t=>{
  const {env,req,db,setAdmin}=setup(t);await ensureLevels(db);setAdmin(false);
  const cookie=(await sessionCookie(env,'viewer')).split(';')[0];
  const endpoints=[['/api/recipes',recipes],['/api/recipe-posts',recipePosts],['/api/recipe-image?id=1',recipeImage],['/api/recipe-file?id=1',recipeFile],['/api/recipe-comments?postId=1',recipeComments]];
  for(const[path,handler]of endpoints)assert.equal((await handler({env,request:req(path,{cookie})})).status,403,path);
  const denied=await middleware({env,request:req('/recipes'),next:()=>new Response('RECIPE CONTENT')});assert.equal(denied.status,302);assert.equal(new URL(denied.headers.get('location')).pathname, '/');assert.ok(denied.headers.get('location').includes('membership_required=1'));
  await db.prepare('INSERT INTO member_levels(member_id,level,updated_by,updated_at) VALUES (?,?,?,?)').bind(targetId,'special',adminId,new Date().toISOString()).run();
  assert.equal((await recipes({env,request:req('/api/recipes')})).status,200);
  assert.equal((await recipePosts({env,request:req('/api/recipe-posts',{cookie})})).status,200);
  assert.equal(await(await middleware({env,request:req('/recipes'),next:()=>new Response('RECIPE CONTENT')})).text(),'RECIPE CONTENT');
  await db.prepare("UPDATE member_levels SET level='regular' WHERE member_id=?").bind(targetId).run();
  assert.equal((await recipePosts({env,request:req('/api/recipe-posts',{cookie})})).status,403);
  setAdmin(true);assert.equal((await recipes({env,request:req('/api/recipes')})).status,200);
});

test('industry materials require special membership and their password, including after demotion',async t=>{
  const {env,req,db,setAdmin}=setup(t); await ensureLevels(db); setAdmin(false);
  const cookie=(await industryCookie(env,'viewer')).split(';')[0];
  const endpoints=[['/api/private',industry],['/api/private-posts',industryPosts],['/api/private-image?id=1',industryImage],['/api/private-file?id=1',industryFile],['/api/private-comments?postId=1',industryComments]];
  for(const[path,handler]of endpoints)assert.equal((await handler({env,request:req(path,{cookie})})).status,403,path);
  assert.equal((await industry({env,request:req('/api/private',{method:'POST',body:{password:env.RECIPE_PASSWORD}})})).status,403);
  const denied=await middleware({env,request:req('/private'),next:()=>new Response('CONTENT')}); assert.equal(denied.status,302); assert.equal(new URL(denied.headers.get('location')).pathname, '/');assert.ok(denied.headers.get('location').includes('membership_required=1'));
  await db.prepare('INSERT INTO member_levels(member_id,level,updated_by,updated_at) VALUES (?,?,?,?)').bind(targetId,'special',adminId,new Date().toISOString()).run();
  assert.equal((await industryPosts({env,request:req('/api/private-posts')})).status,403);
  assert.equal((await industry({env,request:req('/api/private',{method:'POST',body:{password:'wrong'}})})).status,401);
  const unlocked=await industry({env,request:req('/api/private',{method:'POST',body:{password:env.RECIPE_PASSWORD}})}); assert.equal(unlocked.status,200); assert.ok(unlocked.headers.get('set-cookie').includes('private_viewer='));
  assert.equal((await industryPosts({env,request:req('/api/private-posts',{cookie})})).status,200);
  await db.prepare("UPDATE member_levels SET level='regular' WHERE member_id=?").bind(targetId).run();
  for(const[path,handler]of endpoints)assert.equal((await handler({env,request:req(path,{cookie})})).status,403,path);
});

test('author badges use current grades and omit private author identifiers',async t=>{
  const {db}=setup(t); await ensureLevels(db);
  const rows=[{author_id:targetId,author:'nickname'},{author_id:adminId,author:'ordinary'}];
  assert.equal((await authorLevels(db,rows))[0].authorLevel,'regular');
  await db.prepare('INSERT INTO member_levels(member_id,level,updated_by,updated_at) VALUES (?,?,?,?)').bind(targetId,'special',adminId,new Date().toISOString()).run();
  const graded=await authorLevels(db,rows); assert.equal(graded[0].authorLevel,'special'); assert.equal(graded[0].author,'nickname'); assert.equal(graded[0].author_id,undefined); assert.equal(graded[1].authorLevel,'regular');
  await db.prepare("UPDATE member_levels SET level='regular' WHERE member_id=?").bind(targetId).run();
  assert.equal((await authorLevels(db,rows))[0].authorLevel,'regular');
});

test('verified admin can unlock and read both boards without any shared password or viewer cookie',async t=>{
  const {env,req,setAdmin,db}=setup(t);
  const withoutPasswords={...env,RECIPE_PASSWORD:undefined,RECIPE_ADMIN_PASSWORD:undefined};
  for(const [path,handler,postsPath,postsHandler] of [['/api/recipes',recipes,'/api/recipe-posts',recipePosts],['/api/private',industry,'/api/private-posts',industryPosts]]){
    const availability=await handler({env:withoutPasswords,request:req(path)});assert.equal(availability.status,200);assert.equal((await availability.json()).isAdmin,true);
    const unlocked=await handler({env:withoutPasswords,request:req(path,{method:'POST',body:{}})});assert.equal(unlocked.status,200);assert.equal((await unlocked.json()).canWrite,true);
    assert.equal((await postsHandler({env:withoutPasswords,request:req(postsPath)})).status,200);
    assert.equal((await handler({env:withoutPasswords,request:req(path,{method:'POST',body:{},origin:'https://other.test'})})).status,403);
  }
  setAdmin(false);await ensureLevels(db);
  await db.prepare('INSERT INTO member_levels(member_id,level,updated_by,updated_at) VALUES (?,?,?,?)').bind(targetId,'special',adminId,new Date().toISOString()).run();
  for(const [path,handler] of [['/api/recipe-posts',recipePosts],['/api/private-posts',industryPosts]])assert.equal((await handler({env,request:req(path)})).status,403);
});
test('admin member directory includes names and phone numbers but ordinary members cannot fetch it',async t=>{
  const {env,req,setAdmin}=setup(t);
  const response=await levels({env,request:req('/api/member-levels')});assert.equal(response.status,200);
  assert.deepEqual((await response.json()).members[0],{id:targetId,username:'ordinary',nickname:'홍길동',phone:'01012345678',level:'regular',isAdmin:false});
  setAdmin(false);const denied=await levels({env,request:req('/api/member-levels')});assert.equal(denied.status,403);assert.ok(!(await denied.text()).includes('01012345678'));
});

test('admin directory uses the current saved nickname',async t=>{
  const {env,req,db}=setup(t);
  const {storeNickname}=await import('../src/member-nicknames.js');
  await storeNickname(db,targetId,'새 이름');
  const response=await levels({env,request:req('/api/member-levels')});
  assert.equal(response.status,200);assert.equal((await response.json()).members[0].nickname,'새 이름');
});
