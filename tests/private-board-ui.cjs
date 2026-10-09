const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, pathname === '/private' ? 'private.html' : pathname.slice(1));
    if (!path.startsWith(root + '/')) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let admin = false, submissions = 0;
      const posts = Array.from({length:23}, (_,i) => ({ id: i+1, title: '자료 ' + String(i).padStart(2,'0'), body: '외식산업 내용 ' + i, downloads:i, created_at:'2026-10-07T01:00:00Z' }));
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()); if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({json:{available:true,authenticated:admin,user:admin?{id:'admin',username:'운영팀',isAdmin:true}:null}});
        if (url.pathname === '/api/private') return route.fulfill({json:{posts:posts.slice().reverse().slice(0,10),page:1,totalPages:3,canWrite:admin}});
        if (url.pathname === '/api/private-comments') return route.fulfill({json:{comments:[]}});
        if (url.pathname === '/api/private-posts') {
          if(req.method()==='POST'){assert.ok(admin); const body=req.postDataJSON();posts.push({...body,id:99,downloads:0,created_at:'2026-10-09T00:00:00Z'});submissions++;return route.fulfill({json:{id:99}});}
          const query=url.searchParams.get('q')||'',sort=url.searchParams.get('sort');
          let rows=posts.filter(p=>(p.title+' '+p.body).includes(query));
          rows.sort(sort==='title'?(a,b)=>a.title.localeCompare(b.title):sort==='downloads'?(a,b)=>b.downloads-a.downloads:(a,b)=>b.id-a.id);
          const totalPages=Math.max(1,Math.ceil(rows.length/10)),page=Math.min(Number(url.searchParams.get('page')||1),totalPages);
          return route.fulfill({json:{posts:rows.slice((page-1)*10,page*10),page,totalPages,total:rows.length}});
        }
        if(url.pathname.startsWith('/api/'))return route.fulfill({json:{available:true,authenticated:false,providers:{}}});return route.continue();
      });
      const page=await context.newPage();await page.goto(origin+'/private'); await page.waitForTimeout(300); assert.equal(await page.locator('.recipe-row').count(),0); await page.locator('#industry-password').fill('0018'); await page.locator('#industry-access-submit').click(); await page.locator('.recipe-row').first().waitFor();
      assert.equal(await page.title(),'외모Check-외식산업 자료');
      assert.equal(await page.locator('input[type=password]#recipe-password').count(),0);
      assert.equal(await page.locator('main select').count(),0);
      assert.equal(await page.locator('.recipe-row').count(),10);
      assert.ok(await page.locator('#industry-write').isHidden());
      assert.equal(await page.locator('.recipe-row-arrow').count(),0);
      await page.locator('.recipe-row').first().click();assert.ok(await page.locator('.recipe-post-body').first().isVisible());
      assert.equal(await page.locator('.recipe-detail').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
      await page.locator('#recipe-pagination').getByRole('button',{name:'3',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.recipe-row').length===3);
      await page.locator('#industry-query').fill('자료 00');await page.locator('#industry-search button').click();await page.waitForFunction(()=>document.querySelectorAll('.recipe-row').length===1);
      assert.equal(await page.locator('.recipe-row-title').textContent(),'자료 00');
      await page.locator('#industry-heading').click();await page.waitForFunction(()=>document.querySelectorAll('.recipe-row').length===10);
      await page.locator('[data-industry-sort=title]').click();await page.waitForFunction(()=>document.querySelector('.recipe-row-title').textContent==='자료 00');
      await page.locator('[data-industry-sort=downloads]').click();await page.waitForFunction(()=>document.querySelector('.recipe-downloads').textContent==='22');
      admin=true;await page.evaluate(()=>dispatchEvent(new CustomEvent('member-session-change',{detail:true})));assert.ok(await page.locator('#recipe-board').isHidden()); await page.locator('#industry-password').fill('0018'); await page.locator('#industry-access-submit').click(); await page.locator('#industry-write').waitFor();
      await page.locator('#industry-write').click();await page.locator('#industry-title').fill('운영 자료');await page.locator('#industry-body').fill('자료 내용');await page.locator('#industry-submit').click();
      await page.waitForFunction(()=>document.querySelector('#recipe-editor').hidden);assert.equal(submissions,1);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await context.close();console.log('PASS password-protected industry library, search, pagination, sorting and operator publishing',width);
    }
  } finally { if(browser)await browser.close(); await new Promise(done=>server.close(done)); }
})().catch(error=>{console.error(error);process.exitCode=1});
