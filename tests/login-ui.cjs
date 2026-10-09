const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname === '/' ? 'index.html' : pathname === '/about' ? 'about.html' : pathname === '/recipes' ? 'recipes.html' : pathname === '/board' ? 'board.html' : pathname === '/private' ? 'private.html' : pathname === '/inquiry' ? 'inquiry.html' : pathname === '/startup' ? 'startup.html' : pathname.slice(1);
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
    for (const path of ['/', '/about', '/recipes', '/board', '/private', '/inquiry', '/startup']) {
      for (const width of [320, 360, 390, 430, 768, 1280]) {
        for (const theme of ['light', 'dark']) {
          const context = await browser.newContext({ viewport: { width, height: 900 } });
          let state = { available: true, authenticated: false, user: null };
          let loginSucceeds = false;
          let trend = { available: true, video: { id: 'abcdefghijk', title: '외식 트렌드 테스트', channel: '테스트', views: 1234 }, checkedAt: new Date().toISOString(), stale: false };
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/api/visitors') return route.fulfill({ json: { available: true, today: 12, total: 345 } });
            if (url.pathname === '/api/trend-video') { assert.equal(url.searchParams.get('visit'), null); return route.fulfill({ json: trend }); }
            if (url.pathname === '/api/trend-news') return route.fulfill({ json: { available: true, requestedAt: '2026-10-07T15:01:00Z', checkedAt: '2026-10-07T15:01:01Z', stale: false, articles: Array.from({ length: 6 }, (_, i) => ({ title: '외식 시장 변화 ' + i, source: '테스트신문', url: 'https://news.google.com/rss/articles/test' + i, published_at: '2026-10-07T14:00:00Z', image: '/assets/news/febc6011757bd18cfeef1a04.jpg' })) } });
            if (url.pathname === '/api/session') return route.fulfill({ json: state });
            if (url.pathname === '/api/oauth') {
              if (route.request().method() === 'POST') { assert.equal(route.request().postDataJSON().provider, 'kakao'); return route.fulfill({ status: 503, json: { message: '테스트 인증 연결 오류' } }); }
              return route.fulfill({ json: { providers: { google: true, kakao: true } } });
            }
            if (url.pathname === '/api/login') {
              if (!loginSucceeds) return route.fulfill({ status: 401, json: { message: '아이디 또는 비밀번호를 확인해 주세요.' } });
              state = { available: true, authenticated: true, needsProfile: false, user: { id: 'member', username: '테스트회원', kakaoLinked: true } };
              return route.fulfill({ json: state });
            }
            if (url.pathname === '/api/logout') { state = { available: true, authenticated: false }; return route.fulfill({ json: { authenticated: false } }); }
            if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
            return route.continue();
          });
          const page = await context.newPage();
          await page.goto(origin + path);
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'anonymous');
          assert.equal(await page.locator('#visitor-counter').count(), 0);
          assert.equal(await page.getByRole('link', { name: /첫\s?페이지로 돌아가기/ }).count(), 0);
          assert.equal(await page.locator('header .brand').getAttribute('href'), '/');
          assert.equal((await page.locator('#menu-open').textContent()).trim(), '');
          assert.equal((await page.locator('#menu-close').textContent()).trim(), '×');
          const expandedHeight = await page.locator('header').evaluate(el => el.getBoundingClientRect().height);
          await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }));
          if (path === '/') {
            await page.waitForFunction(() => document.querySelector('header').classList.contains('is-compact'));
            await page.waitForFunction(height => document.querySelector('header').getBoundingClientRect().height < height - 2, expandedHeight);
          }
          assert.ok(await page.locator('header').evaluate(el => getComputedStyle(el).position === 'sticky' && Math.abs(el.getBoundingClientRect().top) <= 1), 'account header stays at the viewport top');
          assert.ok(await page.locator('#login-open').isVisible());
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await page.waitForFunction(() => !document.querySelector('header').classList.contains('is-compact'));
          await page.locator('#menu-open').click();
          assert.equal(await page.locator('#menu-open').getAttribute('aria-expanded'), 'true');
          assert.equal(await page.locator('#menu-account-status').textContent(), '로그인하지 않았습니다.');
          assert.equal(await page.locator('#menu-title').count(), 0);
          assert.equal(await page.locator('.menu-heading #menu-account-status').count(), 1);
          assert.ok(await page.locator('#menu-account-status').evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 11));
          const accountBox = await page.locator('#menu-account-status').boundingBox();
          const closeBox = await page.locator('#menu-close').boundingBox();
          assert.ok(Math.abs(accountBox.y + accountBox.height / 2 - closeBox.y - closeBox.height / 2) <= 2, 'account information shares the close-button row');
          if (path === '/') {
            assert.equal(await page.locator('.cta[href="#trends"]').count(), 0);
            assert.equal(await page.locator('#partnership').count(), 0);
            assert.ok(!(await page.locator('.ribbon').textContent()).includes('IN FOCUS'));
            assert.ok(await page.locator('.ribbon').evaluate(el => getComputedStyle(el).borderTopStyle === 'solid' && parseFloat(getComputedStyle(el).borderTopWidth) >= 1));
          }
          assert.deepEqual(await page.locator('#site-menu .menu-number').allTextContents(), ['01', '02', '03', '04', '05', '06']);
          assert.equal(await page.locator('#startup-toggle span').nth(1).textContent(), '창업의 모든것');
          assert.equal(await page.locator('#site-menu a[href="/about"] span').nth(1).textContent(), '사이트소개');
          assert.equal(await page.locator('.journal-nav').count(), 0);
          const menuBox = await page.locator('#site-menu').boundingBox();
          assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, 'menu must fit viewport');
          assert.deepEqual(await page.locator('#site-menu nav a').evaluateAll(links => links.map(a => a.getAttribute('href'))), ['/about', '/#trends', '/recipes', '/startup', '/guides', '/private', '/board']);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('#site-menu').open && document.querySelector('#menu-open').getAttribute('aria-expanded') === 'false' && document.activeElement === document.querySelector('#menu-open'));
          assert.equal(await page.locator('#menu-open').getAttribute('aria-expanded'), 'false');
          await page.locator('#menu-open').click();
          await page.locator('#menu-close').click();
          await page.waitForFunction(() => !document.querySelector('#site-menu').open && document.querySelector('#menu-open').getAttribute('aria-expanded') === 'false' && document.activeElement === document.querySelector('#menu-open'));
          assert.equal(await page.locator('#menu-open').evaluate(el => document.activeElement === el), true);
          if (path === '/') {
            await page.waitForSelector('#video-start');
            const copyBox = await page.locator('.hero-copy').boundingBox();
            const videoBox = await page.locator('.trend-video').boundingBox();
            if (width > 800) {
              assert.ok(copyBox.x + copyBox.width <= videoBox.x, 'intro stays inside its column without covering YouTube');
              assert.ok(await page.locator('.hero-copy').evaluate(el => parseFloat(getComputedStyle(el).paddingInlineStart) >= 0));
            } else {
              assert.ok(copyBox.y + copyBox.height <= videoBox.y, 'intro stays above the video on phones');
              assert.equal(await page.locator('.hero-copy').evaluate(el => getComputedStyle(el).textAlign), 'left');
            }
            await page.waitForFunction(() => document.querySelector('#news-status').textContent.includes('접속 기준:'));
            assert.equal(await page.locator('#trends .card').count(), 6);
            assert.equal(await page.locator('#trends .news-photo img').count(), 6);
            assert.match(await page.locator('#trends .news-photo-credit').first().textContent(), /테스트신문/);
            assert.ok(await page.evaluate(() => document.querySelector('#news-status').compareDocumentPosition(document.querySelector('#trends .cards')) & Node.DOCUMENT_POSITION_PRECEDING), 'collection details appear below news cards');
            const newsStatus = await page.locator('#news-status').textContent();
            assert.ok(newsStatus.includes('2026. 10. 08.') && newsStatus.includes('00:01:00'), 'visit timestamp rolls over to the Korean calendar day');
            assert.equal(await page.locator('#video-player iframe').count(), 0);
            await page.locator('#video-start').click();
            await page.waitForSelector('#video-player iframe');
            assert.equal(await page.locator('#video-player iframe').getAttribute('src'), 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&playsinline=1&rel=0&controls=1');
            assert.equal(await page.locator('#video-title').textContent(), trend.video.title);
            const playerBox = await page.locator('#video-player').boundingBox();
            assert.ok(playerBox.x >= 0 && playerBox.x + playerBox.width <= width, 'video must fit viewport');
            trend = { available: false, reason: 'setup_required' };
            await page.reload();
            await page.waitForFunction(() => document.querySelector('#video-loading').textContent.includes('준비'));
            assert.equal(await page.locator('#video-player iframe').count(), 0);
            assert.ok(await page.locator('#video-watch').isVisible());
            await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'anonymous');
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must fit viewport');
          assert.equal(await page.locator('header a[href*="partnership"]').count(), 0);
          assert.ok((await page.locator('header').boundingBox()).height <= (width <= 1100 ? 65 : 110), 'header remains one line');
          await page.locator('#signup-open').click();
          await page.waitForFunction(() => !document.querySelector('[data-mode="signup"][data-social="kakao"]').disabled);
          assert.equal(await page.locator('[data-mode="signup"][data-social="kakao"]').textContent(), '카카오로 가입하기');
          assert.equal(await page.locator('[data-mode="signup"][data-social="google"]').textContent(), '구글로 가입하기');
          await page.locator('[data-mode="signup"][data-social="kakao"]').click();
          await page.waitForFunction(() => document.querySelector('#auth-error-dialog').open);
          assert.ok((await page.locator('#auth-error-message').textContent()).includes('테스트 인증'));
          await page.locator('#auth-error-close').click();
          await page.locator('#signup-close').click();
          await page.locator('#login-open').click();
          await page.waitForFunction(() => !document.querySelector('#login-submit').disabled);
          await page.waitForFunction(() => !document.querySelector('#login-dialog [data-social="kakao"]').disabled);
          const boxes = await page.evaluate(() => {
            const rect = id => { const r = document.querySelector(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
            return { dialog: rect('#login-dialog'), identifier: rect('#login-identifier'), password: rect('#login-password'), submit: rect('#login-submit'), kakao: rect('#login-dialog [data-social="kakao"]'), google: rect('#login-dialog [data-social="google"]'), float: getComputedStyle(document.querySelector('#login-dialog [data-social="kakao"]')).float, width: innerWidth };
          });
          assert.ok(boxes.identifier.bottom <= boxes.password.top, 'ID must be above password');
          assert.ok(boxes.password.bottom <= boxes.submit.top, 'password must be above submit');
          assert.ok(boxes.submit.bottom <= boxes.google.top, 'social buttons appear below the password form');
          assert.ok(boxes.google.bottom <= boxes.kakao.top, 'Google must appear first');
          assert.equal(boxes.float, 'none', 'article dialog float must not leak into login');
          for (const key of ['dialog', 'identifier', 'password', 'submit', 'kakao', 'google']) {
            assert.ok(boxes[key].left >= 0 && boxes[key].right <= boxes.width, key + ' must fit viewport');
          }
          await page.locator('#login-identifier').fill('tester');
          await page.locator('#login-password').fill('wrong-password');
          await page.locator('#login-submit').click();
          await page.waitForFunction(() => document.querySelector('#auth-error-dialog')?.open);
          assert.ok((await page.locator('#auth-error-message').textContent()).includes('아이디 또는 비밀번호'));
          await page.locator('#auth-error-close').click();
          await page.waitForFunction(() => !document.querySelector('#auth-error-dialog').open);
          assert.ok(await page.locator('#login-dialog').evaluate(el => el.open));
          assert.equal(await page.locator('#login-identifier').inputValue(), 'tester');
          assert.equal(await page.locator('#login-password').inputValue(), '');
          loginSucceeds = true;
          await page.locator('#login-password').fill('correct-password');
          await page.locator('#login-submit').click();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'authenticated' && !document.querySelector('#login-dialog').open);
          assert.equal(await page.locator('#member-feedback').textContent(), '');
          assert.ok(!(await page.locator('#kakao-link-button').isVisible()));
          assert.equal(await page.locator('#member-status').textContent(), '테스트회원님');
          for (const role of [{ level: 'regular', isAdmin: true, icon: 'member-diamond' }, { level: 'special', isAdmin: false, icon: 'member-crown' }, { level: 'regular', isAdmin: false, icon: null }]) {
            await page.evaluate(role => dispatchEvent(new CustomEvent('member-authenticated', { detail: { id: 'member', username: '테스트회원', ...role } })), role);
            for (const selector of ['#member-status', '#menu-account-status']) {
              assert.equal(await page.locator(selector + ' .member-diamond').count(), role.icon === 'member-diamond' ? 1 : 0);
              assert.equal(await page.locator(selector + ' .member-crown').count(), role.icon === 'member-crown' ? 1 : 0);
            }
          }

          assert.ok(await page.locator('#logout-button').isVisible());
          assert.ok(!(await page.locator('#login-open').isVisible()));
          assert.ok(!(await page.locator('#signup-open').isVisible()));
          if (width <= 768) {
            const headerBox = await page.locator('header').boundingBox();
            assert.ok(headerBox.height <= 82, 'member controls stay on one header row');
            assert.ok(await page.locator('#member-status').evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 11), 'member ID uses compact text');
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('member-authenticated', { detail: { id: 'member', username: 'abcdefghijklmnopqrst', kakaoLinked: true } })));
            assert.ok(await page.locator('#member-status').evaluate(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis'), 'complete member ID fits without truncation');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long member ID does not overflow');
            assert.ok(await page.locator('#member-status .member-profile-link').evaluate(el => {
              const range = document.createRange(); range.selectNodeContents(el);
              const box = document.querySelector('#member-status').getBoundingClientRect();
              return [...range.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
            }), 'every character of the name is visible inside its container');
          }
          const logout = await page.locator('#logout-button').boundingBox();
          assert.ok(logout.x >= 0 && logout.x + logout.width <= width, 'logout must fit viewport');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'linked account page must fit viewport');
          await page.evaluate(() => dispatchEvent(new CustomEvent('member-authenticated', { detail: { id: 'member', username: '구글회원', googleLinked: true, kakaoLinked: false } })));
          await page.locator('#menu-open').click();
          assert.ok(await page.locator('#kakao-link-button').isHidden(), 'Google-linked members do not receive account linking prompts');
          await page.locator('#menu-close').click();
          state.user.kakaoLinked = false;
          await page.reload();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'authenticated');
          await page.waitForFunction(() => !document.querySelector('#kakao-link-button').hidden);
          await page.locator('#menu-open').click();
          assert.ok(await page.locator('#kakao-link-button').isVisible());
          assert.equal(await page.locator('#menu-account-status').textContent(), state.user.username + '님');
          assert.equal(await page.locator('#menu-profile-link').getAttribute('href'), '/mypage');
          assert.equal(await page.locator('#mypage-link').count(), 0);
          assert.equal(await page.locator('#menu-account-action').textContent(), '로그아웃');
          assert.ok(await page.locator('#menu-account-status').evaluate(el => getComputedStyle(el, '::before').content === 'none'), 'ordinary members have no login marker');
          assert.equal(await page.locator('#site-menu .menu-footer .menu-inquiry').getAttribute('href'), '/inquiry');
          const linkBox = await page.locator('#kakao-link-button').boundingBox();
          assert.ok(linkBox.x >= 0 && linkBox.x + linkBox.width <= width && linkBox.height >= 44, 'Kakao link must fit viewport and touch target');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'unlinked account page must fit viewport');
          await page.locator('#menu-close').click();
          await page.waitForFunction(() => !document.querySelector('#site-menu').open);
          await page.locator('#logout-button').click();
          await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'anonymous');
          assert.ok(await page.locator('#login-open').isVisible());
          assert.ok(!(await page.locator('#logout-button').isVisible()));
          assert.equal(await page.locator('#member-feedback').textContent(), '');
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
