const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (extname(path) ? path : path + '.html'));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' }[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch();
    for (const path of ['recipes', 'private']) for (const width of [320, 768, 1280]) {
      let admin = true, unlocks = 0;
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated: true, user: { username: admin ? 'lsh451600' : 'special', isAdmin: admin } } });
        if (url.pathname === '/api/' + path) {
          if (req.method() === 'GET') return route.fulfill({ json: { available: true, isAdmin: admin } });
          assert.ok(admin, 'ordinary members must not automatically unlock');
          assert.deepEqual(req.postDataJSON(), {}, 'admin must not submit a shared password');
          unlocks++;
          return route.fulfill({ json: { posts: [], page: 1, totalPages: 1, storageAvailable: true, accountWriter: true, canWrite: true } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, providers: {}, posts: [] } });
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(origin + '/' + path);
      await page.locator('#recipe-board').waitFor();
      const gate = page.locator(path === 'recipes' ? '#recipe-gate' : '#industry-gate');
      assert.ok(await gate.isHidden());
      assert.ok(await page.locator(path === 'recipes' ? '#recipe-admin-open' : '#industry-write').isVisible());
      const initial = unlocks; admin = false;
      await page.evaluate(() => dispatchEvent(new CustomEvent('member-session-change', { detail: false })));
      await gate.waitFor();
      assert.ok(await page.locator('#recipe-board').isHidden());
      await page.waitForTimeout(150);
      assert.equal(unlocks, initial, 'session change must not retain admin access');
      admin = true;
      await page.evaluate(() => dispatchEvent(new CustomEvent('member-session-change', { detail: true })));
      await page.locator('#recipe-board').waitFor();
      assert.ok(await gate.isHidden());
      console.log('PASS admin password-free access and session changes', path, width);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
