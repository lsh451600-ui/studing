const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    let path = new URL(req.url, 'http://localhost').pathname;
    path = path === '/' ? '/index.html' : extname(path) ? path : path + '.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
    catch { res.end(); }
  });
  let browser;
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch();
    for (const width of [320, 768, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, authenticated: false, providers: {} } });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      for (const path of ['/guides', '/guides/menu-margin', '/guides/break-even', '/guides/solo-dining', '/guides/menu-complexity', '/about', '/editorial', '/privacy', '/terms']) {
        await page.goto(origin + path);
        assert.equal(await page.locator('main h1').count(), 1, path);
        assert.ok(await page.locator('.journal-nav a[href="/guides"]').isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' overflow at ' + width);
        if (path.endsWith('menu-margin')) {
          await page.locator('[data-guide-tool] button').click();
          assert.match(await page.locator('output').textContent(), /5,800원/);
          await page.locator('[name=variable]').fill('10000');
          await page.locator('[data-guide-tool] button').click();
          assert.match(await page.locator('output').textContent(), /-1,000원/);
        }
        if (path.endsWith('break-even')) {
          await page.locator('[data-guide-tool] button').click();
          assert.match(await page.locator('output').textContent(), /1,200건/);
          await page.locator('[name=variable]').fill('12000');
          await page.locator('[data-guide-tool] button').click();
          assert.match(await page.locator('output').textContent(), /변동비보다 크게/);
        }
      }
      assert.deepEqual(errors, []);
      if (width === 320 && theme === 'light') await page.screenshot({ path: '/tmp/studing-journal-mobile.png', fullPage: true });
      await context.close();
    }
    console.log('54 public page/viewport/theme checks and calculator interactions passed.');
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
