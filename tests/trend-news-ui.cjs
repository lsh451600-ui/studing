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
          if (url.href === snapshot.articles[0].image_original) return route.fulfill({ contentType: 'image/jpeg', body: await readFile(resolve(root, '.' + snapshot.articles[0].image)) });
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
        assert.equal(await page.locator('#trends .news-photo img').count(), 6);
        for (let n = 0; n < 6; n++) {
          const image = page.locator('#trends .news-photo img').nth(n); await image.scrollIntoViewIfNeeded();
          await page.waitForFunction(index => { const el = document.querySelectorAll('#trends .news-photo img')[index]; return el?.complete && el.naturalWidth > 0; }, n, { timeout: 15000 });
          assert.ok(await image.evaluate(el => el.naturalWidth > 0));
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      };
      await verify();
      live = true;
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await page.waitForFunction(() => document.querySelector('#trends .news-photo img').src.endsWith('/assets/news/missing.jpg') || document.querySelector('#trends .news-photo img').src.startsWith('https:'));
      await verify();
      assert.equal(await page.locator('#trends .news-photo img').first().getAttribute('src'), snapshot.articles[0].image_original);
      assert.deepEqual(errors, []);
      await context.close(); console.log('PASS six cached same-article photos and original-photo fallback', width);
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
