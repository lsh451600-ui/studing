const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd(), snapshot = JSON.parse(await readFile('news.json', 'utf8'));
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' }[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch();
    for (const width of [320, 1280]) {
      let live = false;
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          return route.abort();
        }
        if (url.pathname === '/api/trend-news') {
          if (!live) return route.fulfill({ status: 503, json: {} });
          const articles = snapshot.articles.map(a => ({ ...a }));
          articles[0].image = '/assets/news/missing.jpg'; articles[0].image_fallback = articles[0].image_original;
          return route.fulfill({ json: { available: true, articles, requestedAt: snapshot.updated_at, checkedAt: snapshot.updated_at } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: false, authenticated: false, providers: {} } });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin);
      const verify = async () => {
        assert.equal(await page.locator('#trends .card').count(), 6);
        assert.equal(await page.locator('#trends img').count(), 0);
        assert.ok(await page.locator('#trends .card').first().getAttribute('href'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      };
      await verify();
      live = true;
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForFunction(() => !document.querySelector('#news-status').textContent.includes('최신 기사 조회에 실패'));
      await verify();
      assert.deepEqual(errors, []);
      await context.close(); console.log('PASS static and live source links without publisher photo reuse', width);
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
