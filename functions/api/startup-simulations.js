import { member } from '../../src/community.js';
import { reply,sameOrigin } from '../../src/member-auth.js';
import { readJSON } from '../../src/recipe-server.js';
import { validate,calculate,analyze } from '../../src/startup-simulation.js';
export async function onRequest({request,env}) {
  if(!['GET','POST'].includes(request.method)) return reply(405,'지원하지 않는 요청입니다.');
  if(request.method==='POST'&&!sameOrigin(request)) return reply(403,'홈페이지에서 다시 시도해 주세요.');
  if(request.method==='GET' && new URL(request.url).searchParams.get('status')==='1') return reply(200,'',{aiReady:Boolean(env.OPENAI_API_KEY)});
  try {
    const auth=await member(request,env); if(auth.response)return auth.response;
    const db=env.MEMBERS_DB; if(!db)return reply(503,'저장소에 연결하지 못했습니다.');
    await db.prepare('CREATE TABLE IF NOT EXISTS startup_simulations (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS startup_simulations_owner ON startup_simulations(user_id,created_at)').run();
    const owner=auth.session.user.id;
    if(request.method==='GET') {
      const id=new URL(request.url).searchParams.get('id');
      if(id){const row=await db.prepare('SELECT * FROM startup_simulations WHERE id=? AND user_id=?').bind(id,owner).first();return row?reply(200,'',{id:row.id,input:JSON.parse(row.input),result:JSON.parse(row.result)}):reply(404,'저장된 분석이 없습니다.');}
      const rows=(await db.prepare('SELECT id,input,created_at FROM startup_simulations WHERE user_id=? ORDER BY created_at DESC LIMIT 10').bind(owner).all()).results;
      return reply(200,'',{aiReady:Boolean(env.OPENAI_API_KEY),history:rows.map(row=>({id:row.id,input:JSON.parse(row.input),createdAt:row.created_at}))});
    }
    let input;try{input=validate(await readJSON(request,6000));}catch(error){return reply(400,error.message||'입력을 확인해 주세요.');}
    await db.prepare('CREATE TABLE IF NOT EXISTS startup_ai_limits (key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL)').run();
    const now=Date.now(),period=Math.floor(now/3600000);
    const limit=await db.prepare('INSERT INTO startup_ai_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(owner+':'+period,(period+1)*3600000).first();
    await db.prepare('DELETE FROM startup_ai_limits WHERE expires_at<?').bind(now).run();
    if(limit.attempts>5)return reply(429,'분석은 한 시간에 5회까지 가능합니다. 잠시 후 다시 시도해 주세요.');
    const calculation=calculate(input);let ai;try{ai=await analyze(env,input,calculation);}catch{ai={status:'unavailable',report:null};}
    const result={calculation,ai},id=crypto.randomUUID();
    await db.prepare('INSERT INTO startup_simulations (id,user_id,input,result,created_at) VALUES (?,?,?,?,?)').bind(id,owner,JSON.stringify(input),JSON.stringify(result),new Date().toISOString()).run();
    return reply(201,'',{id,input,result});
  }catch{return reply(503,'분석을 저장하지 못했습니다. 입력 내용은 유지됩니다.');}
}
