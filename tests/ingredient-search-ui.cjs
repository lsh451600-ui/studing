const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve,extname } = require('node:path');
const { chromium } = require('playwright');
(async()=>{
 const root=process.cwd();const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;const file=resolve(root,pathname==='/recipes'?'recipes.html':pathname.slice(1));
  if(!file.startsWith(root+'/'))return res.writeHead(403).end();
  try{res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'}[extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch();
 try{for(const width of [320,768,1280])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});let recommendations=0,fail=false,visionFails=false;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
   if(url.pathname.endsWith('ingredient-vision-worker.js'))return route.fulfill({contentType:'text/javascript',body:`self.onmessage=({data})=>{if(!(data.blob instanceof Blob))throw new Error('Expected local image');self.postMessage(${visionFails?"{type:'error',message:'재료를 직접 입력해 주세요.'}":"{type:'result',ingredients:['달걀','두부','대파']}"});};`});
   if(url.pathname==='/api/session')return route.fulfill({json:{available:true,authenticated:false}});
   if(['/api/register','/api/oauth'].includes(url.pathname))return route.fulfill({json:{available:true,providers:{}}});
   if(url.pathname==='/api/recipes')return route.fulfill({json:{posts:[],page:1,totalPages:1,storageAvailable:true}});
   if(url.pathname==='/api/recipe-recommendations'){
    assert.equal(req.method(),'GET');assert.equal(req.postData(),null);recommendations++;
    if(fail)return route.fulfill({status:403,json:{message:'특별회원 인증과 열람 비밀번호가 필요합니다.'}});
    const ingredients=url.searchParams.get('ingredients');assert.ok(ingredients.includes('달걀'));
    return route.fulfill({json:{recommendations:ingredients.includes('없는재료')?[]:[{id:1,title:'두부달걀전',body:'두부와 달걀을 섞어 굽습니다.',score:100,matched:['달걀','두부'],missing:[],estimated:false},{id:2,title:'달걀볶음밥',body:'밥을 볶습니다.',score:67,matched:['달걀','대파'],missing:['밥'],estimated:true},{id:3,title:'두부찌개',body:'두부를 끓입니다.',score:50,matched:['두부'],missing:['김치'],estimated:false}]}});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});return route.continue();
  });
  const page=await context.newPage();await page.goto(origin+'/recipes');assert.ok(await page.locator('#ingredient-search').isHidden());
  await page.locator('#recipe-password').fill('test');await page.locator('#recipe-submit').click();await page.locator('#ingredient-search').waitFor();
  await page.locator('#ingredient-photo').setInputFiles({name:'not-image.txt',mimeType:'text/plain',buffer:Buffer.from('x')});assert.ok(await page.locator('#ingredient-analyze').isDisabled());
  await page.locator('#ingredient-photo').setInputFiles(resolve(root,'assets/logo-small.webp'));await page.locator('#ingredient-analyze').click();
  await page.waitForFunction(()=>document.querySelector('#ingredient-names').value==='달걀, 두부, 대파');
  assert.equal(recommendations,0,'recognition must wait for ingredient confirmation');
  await page.locator('#ingredient-match').click();await page.locator('.ingredient-result').first().waitFor();assert.equal(await page.locator('.ingredient-result').count(),3);
  assert.match(await page.locator('.ingredient-result summary').first().textContent(),/두부달걀전.*100%/);
  await page.locator('.ingredient-result summary').first().click();assert.ok(await page.locator('.ingredient-result .recipe-post-body').first().isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===320&&theme==='light')await page.screenshot({path:'/tmp/dining-ingredient-search-mobile.png',fullPage:true});
  await page.locator('#ingredient-names').fill('달걀, 없는재료');await page.locator('#ingredient-match').click();await page.waitForFunction(()=>document.querySelector('#ingredient-match-status').textContent.includes('일치하는 레시피가 없습니다'));
  fail=true;await page.locator('#ingredient-match').click();await page.waitForFunction(()=>document.querySelector('#ingredient-match-status').textContent.includes('특별회원 인증'));
  fail=false;visionFails=true;await page.locator('#ingredient-analyze').click();await page.waitForFunction(()=>document.querySelector('#ingredient-photo-status').textContent.includes('직접 입력'));
  await page.locator('#ingredient-names').fill('달걀, 두부');await page.locator('#ingredient-match').click();await page.locator('.ingredient-result').first().waitFor();
  await page.evaluate(()=>dispatchEvent(new Event('recipe-access-locked')));assert.equal(await page.locator('.ingredient-result').count(),0);assert.equal(await page.locator('#ingredient-names').inputValue(),'');assert.ok(await page.locator('#ingredient-preview').isHidden());
  console.log('PASS ingredient photo flow, confirmation, top 3, errors, manual fallback and session clearing',width,theme);await context.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
