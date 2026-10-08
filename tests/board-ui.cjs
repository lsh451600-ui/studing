const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, pathname === '/board' ? 'board.html' : pathname.slice(1));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream' }).end(data); } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let authenticated = false, missing = false, commentWrites = 0, postWrites = 0;
      const posts = [{ id: 1, title: '외식 이야기', body: '<script>window.injected = true</script>', author: '회원', created_at: '2026-10-07T01:00:00Z', comments: 0 }], comments = [];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated: false } });
        if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
        if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: {} } });
        if (url.pathname === '/api/visitors') return route.fulfill({ json: { available: true, today: 1, total: 2 } });
        if (url.pathname === '/api/board-posts') {
          if (missing) return route.fulfill({ status: 503, json: { message: '게시판 저장소 연결이 필요합니다.' } });
          if (req.method() === 'POST') { assert.ok(authenticated); const data = req.postDataJSON(); postWrites++; posts.unshift({ ...data, id: 2, author: '회원', created_at: '2026-10-07T02:00:00Z', comments: 0 }); return route.fulfill({ json: { id: 2 } }); }
          return route.fulfill({ json: url.searchParams.has('id') ? { post: posts.find(p => p.id === Number(url.searchParams.get('id'))), comments } : { posts, next: null } });
        }
        if (url.pathname === '/api/board-comments') {
          assert.ok(authenticated); const data = req.postDataJSON(); assert.equal(data.postId, 1); commentWrites++;
          comments.push({ id: commentWrites, body: data.body, author: '회원', created_at: '2026-10-07T02:00:00Z' });
          return route.fulfill({ json: { id: commentWrites } });
        }
        return route.continue();
      });
      const page = await context.newPage(); await page.goto(origin + '/board');
      await page.waitForSelector('.board-row'); await page.locator('.board-row').click();
      await page.waitForSelector('#board-detail:not([hidden])');
      assert.ok(await page.locator('#board-search-form').isHidden());
      assert.equal(await page.locator('#board-title').evaluate(element => getComputedStyle(element).color), 'rgb(35, 93, 222)');
      assert.equal(await page.locator('#board-body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
      assert.ok(await page.locator('#board-back').evaluate(element => Math.abs(element.getBoundingClientRect().right - element.parentElement.getBoundingClientRect().right) < 1));
      assert.equal(await page.locator('#board-body').textContent(), posts[0].body);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.ok(await page.locator('#board-comment-submit').isDisabled());
      authenticated = true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('member-authenticated', { detail: { id: 'member', username: 'abcdefghijklmnopqrst', kakaoLinked: true } })));
      await page.waitForFunction(() => !document.querySelector('#board-comment-submit').disabled);
      await page.locator('#board-comment-body').fill('좋은 이야기입니다.'); await page.locator('#board-comment-submit').click();
      await page.waitForFunction(() => document.querySelectorAll('.board-comment').length === 1); assert.equal(commentWrites, 1);
      await page.locator('#board-back').click();
      await page.waitForFunction(() => !document.querySelector('#board-index').hidden && !document.querySelector('#board-search-form').hidden);
      await page.locator('#board-write').click();
      await page.locator('#board-post-title').fill('새 이야기'); await page.locator('#board-post-body').fill('내용을 나눕니다.'); await page.locator('#board-post-submit').click();
      await page.waitForFunction(() => document.querySelector('#board-title').textContent === '새 이야기'); assert.equal(postWrites, 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      missing = true; await page.goto(origin + '/board');
      await page.waitForFunction(() => document.querySelector('#board-status').textContent.includes('저장소'));
      console.log('PASS community read, login gating, safe text, post, comment, missing storage', width); await context.close();
    }
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
