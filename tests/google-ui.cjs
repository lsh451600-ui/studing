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
    for (const provider of ['google', 'kakao']) for (const mode of ['signup', 'login']) for (const readiness of ['slow', 'failed', 'ready']) {
      const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
      let posts = 0, releaseLookup;
      const delayed = new Promise(resolve => { releaseLookup = resolve; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (['accounts.google.com', 'accounts.kakao.com'].includes(url.host)) return route.fulfill({ contentType: 'text/html', body: '<h1>Google account chooser</h1>' });
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/oauth') {
          if (route.request().method() === 'GET') {
            if (readiness === 'slow') await delayed;
            return route.fulfill({ status: readiness === 'failed' ? 503 : 200, json: readiness === 'failed' ? { message: 'temporary lookup failure' } : { providers: { google: true, kakao: true } } }).catch(() => {});
          }
          assert.equal(route.request().postDataJSON().provider, provider); posts++;
          // A late readiness response must not re-enable buttons during authorization.
          releaseLookup();
          return route.fulfill({ json: { url: provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://accounts.kakao.com/login' } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, authenticated: false } });
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(origin);
      await page.locator('#' + mode + '-open').click();
      const button = page.locator('#' + mode + '-dialog [data-social="' + provider + '"]');
      assert.ok(await button.isVisible());
      const formBox = await page.locator('#' + mode + '-form').boundingBox();
      const box = await button.boundingBox(); assert.ok(box.y >= formBox.y + formBox.height, 'social buttons below existing form');
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await page.waitForURL(provider === 'google' ? 'https://accounts.google.com/**' : 'https://accounts.kakao.com/**');
      assert.equal(posts, 1);
      releaseLookup(); await context.close();
    }
    const context = await browser.newContext();
    let returnedCode;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/oauth-callback') {
        returnedCode = url.searchParams.get('code');
        return route.fulfill({ contentType: 'text/html', body: '<h1>Server exchanges PKCE code</h1>' });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { available: true, authenticated: false } });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin + '/?code=site-root-test');
    await page.waitForURL('**/api/oauth-callback?code=site-root-test');
    assert.equal(returnedCode, 'site-root-test');
    await context.close();
    console.log('Google/Kakao signup/login below password forms and safe site-root callback recovery passed.');
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
