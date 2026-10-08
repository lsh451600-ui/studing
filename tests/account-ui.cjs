const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const name = url.pathname === '/' ? 'index.html' : extname(url.pathname) ? url.pathname.slice(1) : url.pathname.slice(1) + '.html';
    const path = resolve(root, name);
    if (!path.startsWith(root + '/')) return response.writeHead(403).end();
    try {
      const data = await readFile(path);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' }).end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 768, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      const user = { id: 'member-one', username: 'test_member', kakaoLinked: true };
      let authenticated = true, resetCalls = 0, forgotCalls = 0, deleteCalls = 0;
      const errors = [];
      await context.addInitScript(theme => localStorage.setItem('dining-theme', theme), theme);
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated, user: authenticated ? user : null } });
        if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
        if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: { google: true, kakao: true } } });
        if (url.pathname === '/api/trend-video') return route.fulfill({ json: { available: false, reason: 'no_video' } });
        if (url.pathname === '/api/trend-news') return route.fulfill({ status: 503, json: {} });
        if (url.pathname === '/api/account') {
          if (req.method() === 'GET') return route.fulfill({ json: { account: { username: user.username, email: 'test@example.com', phone: '01012345678', createdAt: '2026-10-08T01:00:00Z', providers: ['email', 'kakao'], passwordRequired: true } } });
          deleteCalls++; const data = req.postDataJSON();
          if (data.confirmation !== '회원탈퇴') return route.fulfill({ status: 400, json: { message: '확인란에 회원탈퇴를 입력해 주세요.' } });
          assert.equal(data.password, 'current-password'); authenticated = false;
          return route.fulfill({ json: { authenticated: false, message: '회원탈퇴가 완료되었습니다.' } });
        }
        if (url.pathname === '/api/forgot-password') {
          forgotCalls++; assert.equal(req.postDataJSON().identifier, 'test_member');
          return route.fulfill({ json: { message: '가입 정보가 확인되면 비밀번호 재설정 메일을 보내드립니다.' } });
        }
        if (url.pathname === '/api/reset-password') {
          resetCalls++; const data = req.postDataJSON(); assert.equal(data.password, 'a-new-strong-password'); assert.equal(data.accessToken, 'recovery-token-for-browser-test');
          return route.fulfill({ json: { changed: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.' } });
        }
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      async function fits() { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits at ' + width); }
      await page.goto(origin + '/mypage');
      await page.locator('#account-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#account-email').textContent(), 'test@example.com');
      assert.equal(await page.locator('#account-phone').textContent(), '01012345678');
      await page.locator('.member-profile-link').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.member-profile-link').getAttribute('href'), '/mypage');
      await fits();
      await page.locator('#menu-open').click(); assert.ok(await page.locator('#mypage-link').isVisible()); await page.keyboard.press('Escape');
      await page.locator('#withdrawal-open').click();
      await page.locator('#withdrawal-confirmation').fill('wrong'); await page.locator('#withdrawal-password').fill('current-password');
      await page.locator('#withdrawal-submit').click(); await page.waitForFunction(() => document.getElementById('withdrawal-status').textContent.includes('확인란'));
      assert.equal(deleteCalls, 1);
      await page.locator('#withdrawal-confirmation').fill('회원탈퇴'); await page.locator('#withdrawal-password').fill('current-password');
      await page.locator('#withdrawal-submit').click(); await page.waitForFunction(() => document.getElementById('account-status').textContent.includes('완료'));
      assert.ok(await page.locator('#account-content').isHidden()); assert.equal(await page.locator('.member-profile-link').count(), 0);
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('member-session-v1')).data.authenticated), false);
      await page.goto(origin + '/forgot-password');
      assert.ok(await page.locator('#recovery-identifier').evaluate(input => input.getBoundingClientRect().height >= 44));
      await page.locator('#recovery-identifier').fill('test_member'); await page.locator('#recovery-submit').click();
      await page.waitForFunction(() => document.getElementById('recovery-status').textContent.includes('메일을 보내'));
      assert.equal(forgotCalls, 1); await fits();
      await page.locator('#login-open').click(); assert.equal(await page.locator('.forgot-password-link').getAttribute('href'), '/forgot-password'); await page.keyboard.press('Escape');
      await page.goto(origin + '/reset-password#type=recovery&access_token=recovery-token-for-browser-test&refresh_token=private-refresh');
      assert.equal(page.url(), origin + '/reset-password');
      await page.locator('#reset-password').fill('a-new-strong-password'); await page.locator('#reset-password-confirmation').fill('different-long-password');
      await page.locator('#recovery-submit').click(); assert.equal(resetCalls, 0); assert.ok((await page.locator('#recovery-status').textContent()).includes('일치하지'));
      await page.locator('#reset-password-confirmation').fill('a-new-strong-password'); await page.locator('#reset-password-show').check();
      assert.equal(await page.locator('#reset-password').getAttribute('type'), 'text');
      await page.locator('#recovery-submit').click(); await page.waitForFunction(() => document.getElementById('recovery-status').textContent.includes('변경되었습니다'));
      assert.equal(resetCalls, 1); assert.ok(await page.locator('#recovery-submit').isDisabled());
      assert.equal(await page.locator('#recovery-next').getAttribute('href'), '/?login_required=1');
      assert.ok(!(await page.evaluate(() => JSON.stringify(sessionStorage))).includes('recovery-token')); await fits();
      if (width === 360 && theme === 'dark') await page.screenshot({ path: '/tmp/account-reset-mobile.png', fullPage: true });
      await page.goto(origin + '/reset-password'); assert.ok(await page.locator('#recovery-submit').isDisabled());
      await page.goto(origin + '/#type=recovery&access_token=recovery-token-for-browser-test');
      await page.waitForURL(origin + '/reset-password'); assert.equal(page.url(), origin + '/reset-password');
      await page.locator('#reset-password').fill('a-new-strong-password'); await page.locator('#reset-password-confirmation').fill('a-new-strong-password');
      await page.locator('#recovery-submit').click(); await page.waitForFunction(() => document.getElementById('recovery-status').textContent.includes('변경되었습니다'));
      assert.equal(resetCalls, 2); assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Account, withdrawal and recovery browser flows passed at 360/768/1280px in light/dark themes.');
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
