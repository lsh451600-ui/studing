import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/recipes.js';
const request=(password,cookie='')=>new Request('https://example.test/api/recipes',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({password})});
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret',RECIPE_PASSWORD:'reader-pass',RECIPE_ADMIN_PASSWORD:'owner-password-long'};
test('knowing either recipe password cannot bypass membership login',async()=>{
  for(const password of [env.RECIPE_PASSWORD,env.RECIPE_ADMIN_PASSWORD])assert.equal((await onRequest({env,request:request(password)})).status,401);
});
test('ordinary members cannot unlock recipes with either password',async t=>{
  t.mock.method(globalThis,'fetch',async input=>new URL(input).pathname==='/auth/v1/user'?Response.json({id:'member'}):Response.json([{username:'ordinary'}]));
  for(const password of [env.RECIPE_PASSWORD,env.RECIPE_ADMIN_PASSWORD])assert.equal((await onRequest({env,request:request(password,'__Host-member-access=verified')})).status,403);
});
test('verified operator opens recipes without a separate password',async t=>{
  t.mock.method(globalThis,'fetch',async input=>new URL(input).pathname==='/auth/v1/user'?Response.json({id:'operator'}):Response.json([{username:'lsh451600',nickname:'운영팀'}]));
  const signed='__Host-member-access=verified';assert.equal((await onRequest({env,request:request(env.RECIPE_PASSWORD,signed)})).status,200);
  assert.equal((await onRequest({env,request:request('wrong-password',signed)})).status,200);
  assert.equal((await onRequest({env:{...env,RECIPE_PASSWORD:undefined,RECIPE_ADMIN_PASSWORD:undefined},request:request(undefined,signed)})).status,200);
});
