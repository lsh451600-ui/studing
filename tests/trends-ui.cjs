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
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let post = null, admin = false;
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated: true, user: { id: 'member', username: 'member', isAdmin: admin } } });
        if (url.pathname === '/api/trend-posts') {
          if (req.method() === 'POST') { post = { ...req.postDataJSON(), id: 12, author: 'member', created_at: new Date().toISOString(), comments: 0 }; return route.fulfill({ json: { id: post.id } }); }
          return route.fulfill({ json: url.searchParams.has('id') ? { post, comments: [], permissions: { canEdit: true, canDelete: true } } : { posts: post ? [post] : [], next: null } });
        }
        if (url.pathname === '/api/trend-video') {
          const popular = url.searchParams.get('sort') === 'popular';
          return route.fulfill({ json: { available: true, checkedAt: new Date().toISOString(), video: { id: popular ? 'bbbbbbbbbbb' : 'aaaaaaaaaaa', title: popular ? '인기 외식 전망' : '최신 외식 트렌드', channel: '전망 채널', views: popular ? 10000 : 20, publishedAt: new Date().toISOString() } } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, providers: {} } });
        return route.continue();
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/');
      await page.waitForFunction(() => document.querySelector('#video-title').textContent === '최신 외식 트렌드');
      assert.equal(await page.locator('[data-video-sort]').count(), 0);
      assert.equal(await page.locator('.guide-feature,.home-introduction').count(), 0);
      const footerWidth = await page.locator('footer .site-logo').evaluate(el=>el.getBoundingClientRect().width);
      await page.locator('#theme-toggle').click();
      assert.equal(await page.locator('footer .site-logo').evaluate(el=>el.getBoundingClientRect().width),footerWidth);
      assert.equal(await page.locator('footer .site-logo').evaluate(el=>getComputedStyle(el,'::after').backgroundColor),'rgb(255, 255, 255)');
      await page.locator('#theme-toggle').click();
      await page.goto(origin + '/guides');
      assert.equal(await page.locator('#guide-heading').textContent(), '외식 트렌드를 내 매장의 질문으로');
      assert.equal(await page.locator('.guide-grid').count(), 1);
      await page.goto(origin + '/trends');
      await page.waitForFunction(() => document.querySelector('#member-status').textContent !== '로그인 확인 중…');
      assert.ok(await page.locator('#board-write').isHidden());
      assert.equal(await page.locator('#board-post-category').count(),0);
      admin = true;
      await page.evaluate(() => dispatchEvent(new CustomEvent('member-session-change',{detail:true})));
      await page.locator('#board-write').click();
      await page.locator('#board-post-title').fill('외식 시장 전망');
      await page.locator('.trend-rich-editor').first().fill('새로운 외식 트렌드를 공유합니다.');
      await page.locator('.trend-rich-editor').first().evaluate(el => { const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range); });
      await page.waitForFunction(() => getSelection().toString() === '새로운 외식 트렌드를 공유합니다.');
      await page.locator('.trend-editor-toolbar').first().getByLabel('글씨 크기').selectOption('24');
      await page.locator('.trend-editor-toolbar').first().getByRole('button',{name:'굵게'}).click();
      await page.locator('.trend-editor-toolbar input[type=color]').first().evaluate(el=>{el.value='#bd5636';el.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.locator('#board-post-submit').click();
      await page.waitForFunction(() => document.querySelector('#board-title').textContent === '외식 시장 전망');
      assert.equal(new URL(page.url()).pathname, '/trends');
      assert.ok(post.richBody.some(run=>run.size===24 && run.bold && run.color==='#bd5636'));
      assert.equal(await page.locator('#board-body script').count(),0);
      await page.locator('#board-heading-link').click();
      await page.waitForSelector('.board-row');
      assert.equal(await page.locator('.board-row').getAttribute('href'), '/trends?post=12');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      console.log('PASS trend sorting, moved guide, scoped trend board at', width);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
