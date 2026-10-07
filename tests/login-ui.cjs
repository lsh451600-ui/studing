const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname === '/about' ? 'about.html' : pathname === '/recipes' ? 'recipes.html' : pathname.slice(1);
    const path = resolve(root, name);
    if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(path);
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const path of ['/', '/about', '/recipes']) {
      for (const width of [390, 1280]) {
        for (const theme of ['light', 'dark']) {
          const context = await browser.newContext({ viewport: { width, height: 900 } });
          let state = { available: true, authenticated: false, user: null };
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/api/session') return route.fulfill({ json: state });
            if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: { google: true, kakao: true } } });
            if (url.pathname === '/api/logout') { state = { available: true, authenticated: false }; return route.fulfill({ json: { authenticated: false } }); }
            if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
            return route.continue();
          });
          const page = await context.newPage();
          await page.goto(origin + path);
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'anonymous');
          await page.locator('#login-open').click();
          await page.waitForFunction(() => !document.querySelector('#login-submit').disabled);
          await page.waitForFunction(() => !document.querySelector('[data-social="kakao"]').disabled);
          const boxes = await page.evaluate(() => {
            const rect = id => { const r = document.querySelector(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
            return { dialog: rect('#login-dialog'), identifier: rect('#login-identifier'), password: rect('#login-password'), submit: rect('#login-submit'), kakao: rect('[data-social="kakao"]'), google: rect('[data-social="google"]'), float: getComputedStyle(document.querySelector('[data-social="kakao"]')).float, width: innerWidth };
          });
          assert.ok(boxes.identifier.bottom <= boxes.password.top, 'ID must be above password');
          assert.ok(boxes.password.bottom <= boxes.submit.top, 'password must be above submit');
          assert.ok(boxes.submit.bottom <= boxes.kakao.top, 'social buttons must be below password form');
          assert.ok(boxes.kakao.bottom <= boxes.google.top, 'Kakao must be above Google');
          assert.equal(boxes.float, 'none', 'article dialog float must not leak into login');
          for (const key of ['dialog', 'identifier', 'password', 'submit', 'kakao', 'google']) {
            assert.ok(boxes[key].left >= 0 && boxes[key].right <= boxes.width, key + ' must fit viewport');
          }
          await page.locator('#login-close').click();
          state = { available: true, authenticated: true, needsProfile: false, user: { id: 'member', username: '테스트회원' } };
          await page.reload();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'authenticated');
          assert.equal(await page.locator('#member-status').textContent(), '로그인 중 · 테스트회원님');
          assert.ok(await page.locator('#logout-button').isVisible());
          assert.ok(!(await page.locator('#login-open').isVisible()));
          assert.ok(!(await page.locator('#signup-open').isVisible()));
          const logout = await page.locator('#logout-button').boundingBox();
          assert.ok(logout.x >= 0 && logout.x + logout.width <= width, 'logout must fit viewport');
          await page.locator('#logout-button').click();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'anonymous');
          assert.ok(await page.locator('#login-open').isVisible());
          assert.ok(!(await page.locator('#logout-button').isVisible()));
          state = { available: true, authenticated: true, needsProfile: false, profileUnavailable: true, user: { id: 'member', username: '카카오 회원' } };
          await page.reload();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'authenticated');
          assert.ok(await page.locator('#logout-button').isVisible());
          assert.ok((await page.locator('#member-feedback').textContent()).includes('회원 정보를 불러오지 못했습니다'));
          console.log('PASS', path, width, theme, 'layout, session display, logout and profile outage');
          await context.close();
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
