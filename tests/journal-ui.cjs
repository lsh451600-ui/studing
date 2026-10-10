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
      for (const path of ['/', '/guides', '/guides/menu-margin', '/guides/break-even', '/guides/solo-dining', '/guides/menu-complexity', '/about', '/editorial', '/privacy', '/terms', '/404']) {
        await page.goto(origin + path);
        assert.equal(await page.locator('main h1').count(), 1, path);
        assert.equal(await page.locator('main .home-introduction').count(), path === '/about' ? 1 : 0);
        if (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 180)) {
          const logoWidth = await page.locator('header .site-logo').evaluate(el => el.getBoundingClientRect().width);
          await page.evaluate(() => window.scrollTo({top:180,behavior:'instant'}));
          await page.waitForTimeout(350);
          assert.ok(await page.locator('header .site-logo').evaluate(el => el.getBoundingClientRect().width) < logoWidth, path + ' logo shrinks at ' + width);
          await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
          await page.waitForTimeout(350);
        }

        assert.equal(await page.locator('.journal-nav').count(), 0);
        if (width <= 900) {
          assert.ok(await page.locator('footer').evaluate(el => {
            const brand = el.querySelector('.footer-brand').getBoundingClientRect();
            const links = [...el.querySelectorAll('.journal-footer a')].map(a => a.getBoundingClientRect());
            return links.length > 0 && links.every(r => Math.abs(r.top - links[0].top) < 1) && brand.right <= links[0].left && links[0].top < brand.bottom && links[0].bottom > brand.top && links.at(-1).right <= el.getBoundingClientRect().right + 1;
          }), path + ' footer stays beside logo at ' + width);
        }

        await page.locator('#menu-open').click();
        assert.ok(!(await page.locator('.menu-group .menu-submenu[href="/guides"]').isVisible()));
        await page.locator('#startup-toggle').click();
        assert.equal(await page.locator('#startup-toggle').getAttribute('aria-expanded'), 'true');
        assert.ok(await page.locator('.menu-group .menu-submenu[href="/guides"]').isVisible());
        await page.keyboard.press('Escape');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' overflow at ' + width);
        if (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight > 170)) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForFunction(() => !document.querySelector('#back-to-top').hidden);
        const arrow = await page.locator('#back-to-top').boundingBox();
        assert.ok(Math.abs(arrow.x + arrow.width / 2 - width / 2) < 1, 'back to top centered');
        await page.locator('#back-to-top').click();
        await page.waitForFunction(() => scrollY === 0);
        assert.ok(await page.locator('#back-to-top').isHidden());
        }
        if (path === '/about') {
          const widths = await page.evaluate(() => ({ intro: document.querySelector('.home-introduction').getBoundingClientRect().width, main: document.querySelector('main').getBoundingClientRect().width }));
          assert.ok(Math.abs(widths.intro - widths.main) < 1, 'introduction uses the full about content width');
          if (width === 1280 && theme === 'light') await page.screenshot({ path: '/tmp/studing-about-moved.png', fullPage: true });
        }
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
    console.log('66 public page/viewport/theme checks, full-width introduction and calculator interactions passed.');
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
