import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { normalizeIngredients, extractIngredients, rankRecipes } from '../assets/js/ingredient-matching.js';
import { ensurePosts, sessionCookie, validatePost } from '../src/recipe-server.js';
import { ensureLevels } from '../src/member-levels.js';
import { onRequest } from '../functions/api/recipe-recommendations.js';
import { onRequest as posts } from '../functions/api/recipe-posts.js';
function setup(t) {
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){const stmt=sqlite.prepare(sql);let values=[];return{bind(...v){values=v;return this},async run(){const r=stmt.run(...values);return {meta:{last_row_id:Number(r.lastInsertRowid)}}},async first(){return stmt.get(...values)||null},async all(){return{results:stmt.all(...values)}}}}};
 t.mock.method(globalThis,'fetch',async url=>new URL(url).pathname==='/auth/v1/user'?Response.json({id:'reader'}):Response.json([{username:'lsh451600'}]));
 const env={MEMBERS_DB:db,SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',RECIPE_PASSWORD:'reader-pass'};
 const request=(query,cookie='',method='GET',body)=>new Request('https://dining.win/api/'+query,{method,headers:{Origin:'https://dining.win','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 return {db,env,request};
}
test('aliases deduplicate and compound words do not turn peppers into chili or sweet potatoes into potatoes',()=>{
 assert.deepEqual(normalizeIngredients('계란, 달걀, 쪽파, 대파'),['달걀','대파']);
 const got=extractIngredients('재료: 고구마 1개, 고춧가루 1큰술, 계란 2개\n만드는 방법\n감자로 대체해도 됩니다.');
 assert.ok(got.includes('고구마'));assert.ok(got.includes('고춧가루'));assert.ok(got.includes('달걀'));assert.ok(!got.includes('감자'));assert.ok(!got.includes('고추'));
 assert.deepEqual(extractIngredients('재료: 무 1개, 김 2장'),['무','김']);
});
test('rank by exact coverage then matching count; return at most three and never fabricate zero-match results',()=>{
 const ranked=rankRecipes([{id:1,ingredients:['달걀','대파'],body:''},{id:2,ingredients:['달걀','대파','소금'],body:''},{id:3,ingredients:['계란'],body:''},{id:4,ingredients:['감자'],body:''},{id:5,ingredients:['대파','달걀','두부'],body:''}],['계란','쪽파']);
 assert.deepEqual(ranked.map(p=>p.id),[5,2,1]);assert.equal(ranked[0].missing,undefined);assert.equal(ranked[0].score,100);
 assert.deepEqual(rankRecipes([{id:1,ingredients:['감자']}],['달걀']),[]);
 const estimated=rankRecipes([{id:9,body:'재료: 달걀 1개, 대파 1대'}],['달걀']);
 assert.equal(rankRecipes(estimated,['달걀'])[0].estimated,true);
});
test('all detected ingredients take priority even when recipes include other ingredients',()=>{
 const [recipe]=rankRecipes([{id:1,body:'재료: 계란 2개, 굴소스 1큰술, 소금 약간, 피시소스 1/2작은술\n만드는 방법\n달걀을 볶습니다.'}],['달걀']);
 assert.deepEqual(recipe.ingredients,['달걀','굴소스','소금','피시소스']);
 assert.equal(recipe.missing,undefined);
 assert.equal(recipe.score,100);
 assert.deepEqual(extractIngredients('재료\n- 계란 2개\n- 렌틸콩 100g\n- 두부 반모\n조리 순서\n섞습니다.'),['달걀','렌틸콩','두부']);
});
test('photo coverage deduplicates aliases and ranks complete recipes above partial ones',()=>{
 const ranked=rankRecipes([
  {id:1,ingredients:['계란','달걀','대파','쪽파','굴소스','소금']},
  {id:9,ingredients:['달걀']},
  {id:8,ingredients:['대파']}
 ],['달걀','계란','대파']);
 assert.equal(ranked[0].id,1);assert.equal(ranked[0].score,100);
 assert.equal(ranked[0].photoIngredientCount,2);assert.equal(ranked[0].complete,true);
 assert.equal(ranked[1].score,50);assert.equal(ranked[1].complete,false);
 assert.equal(ranked[0].missing,undefined);
 const ingredients=Array.from({length:201},(_,i)=>'재료'+i);
 assert.equal(rankRecipes([{id:1,ingredients:ingredients.slice(1)}],ingredients)[0].score,99);
 assert.deepEqual(rankRecipes([{id:1,ingredients:['달걀']}],[]),[]);
});
test('recommendation API protects content, searches past first 100 recipes, and includes legacy recipes',async t=>{
 const {db,env,request}=setup(t);await ensurePosts(db);await ensureLevels(db);
 const cookie='__Host-member-access=verified; '+(await sessionCookie(env,'viewer')).split(';')[0];
 assert.equal((await onRequest({env,request:request('recipe-recommendations?ingredients=달걀')})).status,403);
 for(let id=1;id<=105;id++)await db.prepare('INSERT INTO recipe_posts(id,title,body,ingredients,created_at) VALUES(?,?,?,?,?)').bind(id,'글 '+id,'재료: 감자 1개',JSON.stringify(['감자']),'2026-10-09').run();
 await db.prepare('UPDATE recipe_posts SET body=?, ingredients=? WHERE id=105').bind('재료: 계란 2개, 두부 반모','[]').run();
 const response=await onRequest({env,request:request('recipe-recommendations?ingredients=계란,두부',cookie)});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.recommendations.length,1);assert.equal(data.recommendations[0].id,105);assert.equal(data.recommendations[0].score,100);assert.equal(data.recommendations[0].estimated,true);assert.equal(data.recommendations[0].author_id,undefined);assert.equal(data.recommendations[0].missing,undefined);
 await db.prepare('UPDATE recipe_posts SET category=? WHERE id=105').bind('한식').run();
 assert.equal((await (await onRequest({env,request:request('recipe-recommendations?ingredients=달걀&category=한식',cookie)})).json()).recommendations[0].id,105);
 assert.deepEqual((await (await onRequest({env,request:request('recipe-recommendations?ingredients=달걀&category=양식',cookie)})).json()).recommendations,[]);
 assert.equal((await onRequest({env,request:request('recipe-recommendations?ingredients=달걀&category=invalid',cookie)})).status,400);
 const linked=await posts({env,request:request('recipe-posts?id=105',cookie)});assert.equal(linked.status,200);assert.deepEqual((await linked.json()).posts.map(p=>p.id),[105]);
 assert.deepEqual((await (await posts({env,request:request('recipe-posts?id=999',cookie)})).json()).posts,[]);
 assert.equal((await posts({env,request:request('recipe-posts?id=invalid',cookie)})).status,400);
 assert.equal((await onRequest({env,request:request('recipe-recommendations?ingredients=',cookie)})).status,400);
 assert.equal((await onRequest({env,request:request('recipe-recommendations?ingredients=달걀',cookie,'POST',{})})).status,405);
 t.mock.method(globalThis,'fetch',async url=>new URL(url).pathname==='/auth/v1/user'?Response.json({id:'reader'}):Response.json([{username:'ordinary'}]));
 assert.equal((await onRequest({env,request:request('recipe-recommendations?ingredients=달걀',cookie)})).status,403);
});
test('explicit recipe ingredients persist on create and survive an older editor PATCH',async t=>{
 const {db,env,request}=setup(t);const cookie='__Host-member-access=verified; '+(await sessionCookie(env,'viewer')).split(';')[0];
 const create=await posts({env,request:request('recipe-posts',cookie,'POST',{title:'두부전',body:'만드는 법',ingredients:'계란, 두부'})});assert.equal(create.status,201);const {id}=await create.json();
 assert.equal((await posts({env,request:request('recipe-posts?id='+id,cookie,'PATCH',{title:'수정',body:'내용'})})).status,200);
 assert.deepEqual(JSON.parse((await db.prepare('SELECT ingredients FROM recipe_posts WHERE id=?').bind(id).first()).ingredients),['달걀','두부']);
 assert.throws(()=>validatePost({title:'a',body:'b',ingredients:[null]}));
});
