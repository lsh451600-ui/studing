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
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});let recommendations=0,fail=false,visionFails=false,emptyMatches=false,emptyDetection=false,lastCategory=null;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
   if(url.pathname.endsWith('ingredient-vision-worker.js'))return route.fulfill({contentType:'text/javascript',body:`self.onmessage=({data})=>{if(!(data.blob instanceof Blob))throw new Error('Expected local image');self.postMessage(${visionFails?"{type:'error',message:'다른 사진으로 다시 시도해 주세요.'}":emptyDetection?"{type:'result',ingredients:[]}":"{type:'result',ingredients:['달걀','두부','대파']}"});};`});
   if(url.pathname==='/api/session')return route.fulfill({json:{available:true,authenticated:false}});
   if(['/api/register','/api/oauth'].includes(url.pathname))return route.fulfill({json:{available:true,providers:{}}});
   if(url.pathname==='/api/recipes')return route.fulfill({json:{posts:[],page:1,totalPages:1,storageAvailable:true}});
   if(url.pathname==='/api/recipe-posts')return route.fulfill({json:{posts:url.searchParams.has('id')?[{id:Number(url.searchParams.get('id')),title:'두부달걀전',body:'실제 레시피 본문',category:'한식',created_at:'2026-10-09',comment_count:0}]:[],page:1,totalPages:1}});
   if(url.pathname==='/api/recipe-recommendations'){
    assert.equal(req.method(),'GET');assert.equal(req.postData(),null);recommendations++;lastCategory=url.searchParams.get('category');
    if(fail)return route.fulfill({status:403,json:{message:'특별회원 인증과 열람 비밀번호가 필요합니다.'}});
    const ingredients=url.searchParams.get('ingredients');assert.ok(ingredients.includes('달걀'));
    return route.fulfill({json:{recommendations:emptyMatches?[]:[{id:1,title:'두부달걀전',body:'두부와 달걀을 섞어 굽습니다.',score:100,matched:['달걀','두부'],missing:[],estimated:false},{id:2,title:'달걀볶음밥',body:'밥을 볶습니다.',score:67,matched:['달걀','대파'],missing:['밥'],estimated:true},{id:3,title:'두부찌개',body:'두부를 끓입니다.',score:50,matched:['두부'],missing:['김치'],estimated:false}]}});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});return route.continue();
  });
  const page=await context.newPage();await page.goto(origin+'/recipes');assert.ok(await page.locator('#ingredient-search').isHidden());
  await page.locator('#recipe-password').fill('test');await page.locator('#recipe-submit').click();await page.locator('#ingredient-search').waitFor();
  await page.locator('#ingredient-photo').setInputFiles({name:'not-image.txt',mimeType:'text/plain',buffer:Buffer.from('x')});assert.ok(await page.locator('#ingredient-analyze').isDisabled());
  assert.equal(await page.locator('#ingredient-search textarea, #ingredient-match-form').count(),0);
  assert.equal(await page.locator('.recipe-search-panel #recipe-search-form').count(),1);
  assert.equal(await page.locator('.recipe-search-panel #ingredient-search').count(),1);
  assert.ok(await page.evaluate(()=>document.querySelector('#recipe-search-form').getBoundingClientRect().bottom <= document.querySelector('#ingredient-search').getBoundingClientRect().top));
  await page.locator('#ingredient-photo').setInputFiles(resolve(root,'assets/logo-small.webp'));
  await page.locator('.ingredient-result').first().waitFor();
  assert.equal(recommendations,1,'photo selection must automatically search exactly once');
  assert.match(await page.locator('#ingredient-detected').textContent(),/달걀, 두부, 대파/);
  assert.equal(await page.locator('.ingredient-result').count(),3);
  assert.match(await page.locator('.ingredient-result h4').first().textContent(),/두부달걀전.*100%/);
  assert.equal(await page.locator('#ingredient-search-title').textContent(),'식재료 사진으로 검색');
  assert.equal(await page.locator('.ingredient-note').count(),0);
  await page.locator('#recipe-filter-category').selectOption('한식');
  await page.waitForFunction(()=>!document.querySelector('#ingredient-analyze').disabled);assert.equal(lastCategory,'한식');
  assert.equal(await page.locator('#ingredient-match-status').textContent(),'');
  assert.ok(await page.locator('.ingredient-result a').first().isVisible());
  assert.equal(await page.locator('.ingredient-result a').first().getAttribute('href'),'/recipes?recipe=1');
  await page.locator('.ingredient-result a').first().click();
  await page.locator('#recipe-post-1[open]').waitFor();assert.match(await page.locator('#recipe-post-1 .recipe-post-body').textContent(),/실제 레시피 본문/);assert.ok(page.url().includes('recipe=1'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===320&&theme==='light')await page.screenshot({path:'/tmp/dining-ingredient-search-mobile.png',fullPage:true});
  emptyMatches=true;await page.locator('#ingredient-analyze').click();await page.waitForFunction(()=>document.querySelector('#ingredient-match-status').textContent.includes('일치하는 레시피가 없습니다'));
  emptyMatches=false;fail=true;await page.locator('#ingredient-analyze').click();await page.waitForFunction(()=>document.querySelector('#ingredient-match-status').textContent.includes('특별회원 인증'));
  fail=false;visionFails=true;const beforeFailure=recommendations;await page.locator('#ingredient-analyze').click();await page.waitForFunction(()=>document.querySelector('#ingredient-photo-status').textContent.includes('다시 시도'));assert.equal(recommendations,beforeFailure);
  visionFails=false;emptyDetection=true;await page.locator('#ingredient-analyze').click();await page.waitForFunction(()=>document.querySelector('#ingredient-photo-status').textContent.includes('재료를 찾지 못했습니다'));assert.equal(recommendations,beforeFailure);
  emptyDetection=false,lastCategory=null;await page.locator('#ingredient-analyze').click();await page.locator('.ingredient-result').first().waitFor();
  await page.evaluate(()=>dispatchEvent(new Event('recipe-access-locked')));assert.equal(await page.locator('.ingredient-result').count(),0);assert.ok(await page.locator('#ingredient-detected').isHidden());assert.ok(await page.locator('#ingredient-preview').isHidden());
  // Clearing while image preparation is pending must cancel the automatic search.
  const beforeClear=recommendations;
  await page.locator('#ingredient-photo').setInputFiles(resolve(root,'assets/logo-small.webp'));
  await page.evaluate(()=>dispatchEvent(new Event('recipe-access-locked')));
  await page.waitForTimeout(150);assert.equal(recommendations,beforeClear);assert.equal(await page.locator('.ingredient-result').count(),0);
  await page.goto(origin+'/recipes?recipe=1');
  await page.locator('#recipe-password').fill('test');await page.locator('#recipe-submit').click();
  await page.locator('#recipe-post-1[open]').waitFor();
  console.log('PASS ingredient photo flow, automatic search, top 3, errors, empty detection and session clearing',width,theme);await context.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
