const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, pathname === '/' ? 'index.html' : ['trends', 'guides', 'about'].includes(pathname.slice(1)) ? pathname.slice(1) + '.html' : pathname.slice(1));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for(const width of [320,1280]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      let user='first',stored=null;
      await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(url.pathname==='/api/session')return route.fulfill({json:{available:true,authenticated:true,user:{id:user,username:user,level:'special'}}});if(url.pathname==='/api/startup-simulations'){if(req.method()==='POST'){stored=req.postDataJSON();return route.fulfill({json:{id:'saved',input:stored,result:{calculation:{allocation:[{label:'보증금',amount:1250,percent:25}],breakEvenSales:917,dailyOrders:30,reserveMonths:1.8,assumption:'가정 기반 계산'},ai:{status:'completed',report:{overview:'조건 기반 분석',strengths:'강점',weaknesses:'약점',opportunities:'기회',threats:'위협',budget:'자본',marketing:'전략 1, 2, 3',criticalRisk:'위험',mitigation:'대응',nextActions:'현장 확인'}}}}});}return route.fulfill({json:{history:[]}});}if(url.pathname.startsWith('/api/'))return route.fulfill({json:{available:true,providers:{}}});return route.continue();});
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/startup-ai.html');await page.waitForSelector('#ai-next');
      for(let step=0;step<3;step++)await page.locator('#ai-next').click();await page.locator('[name=district]').fill('마포구');await page.locator('#ai-next').click();await page.locator('#ai-next').click();await page.locator('[name=menu]').fill('국밥');await page.locator('#ai-next').click();await page.waitForSelector('#ai-result:not([hidden])');assert.equal(stored.district,'마포구');assert.match(await page.locator('#ai-result').innerText(),/917만원/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const other=await context.newPage();await other.goto(origin+'/about');user='second';await other.evaluate(()=>localStorage.setItem('member-session-change-v1','test-'+Date.now()));await page.waitForFunction(()=>document.querySelector('#member-status').textContent.includes('second'));assert.equal(await page.locator('#ai-result').isVisible(),false);assert.deepEqual(errors,[]);await context.close();console.log('Startup wizard and cross-tab account switch verified',width);
    }
  } finally { await browser.close(); await new Promise(done=>server.close(done)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
