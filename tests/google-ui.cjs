const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try {
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream' }); res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch();
    for (const mode of ['signup', 'login']) for (const readiness of ['slow', 'failed', 'ready']) {
      const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
      let posts = 0, releaseLookup;
      const delayed = new Promise(resolve => { releaseLookup = resolve; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.host === 'accounts.google.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Google account chooser</h1>' });
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/oauth') {
          if (route.request().method() === 'GET') {
            if (readiness === 'slow') await delayed;
            return route.fulfill({ status: readiness === 'failed' ? 503 : 200, json: readiness === 'failed' ? { message: 'temporary lookup failure' } : { providers: { google: true, kakao: true } } }).catch(() => {});
          }
          assert.equal(route.request().postDataJSON().provider, 'google'); posts++;
          // A late readiness response must not re-enable buttons during authorization.
          releaseLookup();
          return route.fulfill({ json: { url: 'https://accounts.google.com/o/oauth2/v2/auth' } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, authenticated: false } });
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(origin);
      await page.locator('#' + mode + '-open').click();
      const button = page.locator('#' + mode + '-dialog [data-social="google"]');
      assert.ok(await button.isVisible());
      const box = await button.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= 780, 'Google starts in view');
      await button.click();
      await page.waitForURL('https://accounts.google.com/**');
      assert.equal(posts, 1);
      releaseLookup(); await context.close();
    }
    console.log('Google signup/login both reach authorization at 360px with ready, failed and delayed readiness lookups.');
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
