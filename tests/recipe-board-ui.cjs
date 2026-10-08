const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, pathname === '/recipes' ? 'recipes.html' : pathname.slice(1));
    if (!path.startsWith(root + '/')) return res.writeHead(403).end();
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch();
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let admin = false, submissions = 0;
      const posts = [{ canEdit: true, canDelete: true, id: 'first', title: '봄나물 비빔밥', body: '재료: 봄나물과 밥\n나물을 무쳐 밥과 함께 담습니다.', created_at: '2026-10-07T01:00:00Z' }];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated: false } });
        if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: {} } });
        if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
        if (url.pathname === '/api/recipes') {
          if (req.method() === 'DELETE') { admin = false; return route.fulfill({ json: {} }); }
          assert.equal(req.postDataJSON().password, 'reader-password');
          return route.fulfill({ json: { posts, adminConfigured: true, storageAvailable: true, next: null } });
        }
        if (url.pathname === '/api/recipe-admin') {
          if (req.method() === 'DELETE') { admin = false; return route.fulfill({ json: {} }); }
          if (req.postDataJSON().password !== 'owner-password') return route.fulfill({ status: 401, json: { message: '관리자 비밀번호를 확인해 주세요.' } });
          admin = true; return route.fulfill({ json: { authenticated: true } });
        }
        if (url.pathname === '/api/recipe-posts') {
          if (req.method() === 'PATCH') {
            Object.assign(posts.find(p => p.id === url.searchParams.get('id')), req.postDataJSON());
            return route.fulfill({ json: {} });
          }
          if (req.method() === 'DELETE') {
            const index = posts.findIndex(p => p.id === url.searchParams.get('id')); assert.ok(index >= 0); posts.splice(index, 1);
            return route.fulfill({ json: {} });
          }
          if (req.method() === 'POST') {
            assert.ok(admin, 'only authenticated owner submits a post');
            const payload = req.postDataJSON(); assert.equal(payload.title, '새 레시피'); assert.equal(payload.body, '새 레시피 조리 순서');
            assert.equal(payload.image.type, 'image/png'); assert.ok(payload.image.base64.length > 0);
            posts.unshift({ ...payload, id: 'new', created_at: '2026-10-07T02:00:00Z' }); submissions++;
            return route.fulfill({ json: { success: true } });
          }
          return route.fulfill({ json: { posts, next: null } });
        }
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(origin + '/recipes');
      assert.ok(await page.locator('#recipe-gate').isVisible());
      const gateBox = await page.locator('#recipe-gate').boundingBox();
      assert.ok(Math.abs(gateBox.x + gateBox.width / 2 - width / 2) <= 2, 'password gate is centered');
      assert.ok(!(await page.locator('#recipe-board').isVisible()));
      await page.locator('#recipe-password').fill('reader-password'); await page.locator('#recipe-submit').click();
      await page.waitForFunction(() => !document.querySelector('#recipe-board').hidden);
      assert.equal(await page.locator('.recipe-post').count(), 1);
      assert.ok(await page.locator('#recipe-editor').isVisible());
      assert.equal(submissions, 0);
      await page.locator('.recipe-row').click(); assert.ok(await page.locator('.recipe-post-body').isVisible());
      await page.locator('.recipe-post-actions').getByRole('button', { name: '수정', exact: true }).click();
      await page.locator('.recipe-inline-edit input').fill('수정한 자료');
      await page.locator('.recipe-inline-edit textarea').fill('수정한 자료 내용');
      await page.locator('.recipe-inline-edit').getByRole('button', { name: '저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.recipe-row-title').textContent === '수정한 자료');
      assert.equal(posts[0].body, '수정한 자료 내용');
      await page.locator('#recipe-admin-open').click();
      await page.locator('#recipe-admin-password').fill('wrong-password'); await page.locator('#recipe-admin-submit').click();
      await page.waitForFunction(() => document.querySelector('#recipe-admin-status').textContent.includes('확인'));
      assert.ok(await page.locator('#recipe-editor').isVisible()); assert.equal(submissions, 0);
      await page.locator('#recipe-admin-password').fill('owner-password'); await page.locator('#recipe-admin-submit').click();
      await page.waitForFunction(() => document.querySelector('#recipe-admin-panel').hidden && !document.querySelector('#recipe-admin-exit').hidden);
      await page.locator('#recipe-post-category').selectOption('한식');
      await page.locator('#recipe-post-title').fill('새 레시피'); await page.locator('#recipe-post-body').fill('새 레시피 조리 순서');
      await page.locator('#recipe-post-image').setInputFiles({ name: 'recipe.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#recipe-image-preview').waitFor({ state: 'visible' });
      await page.waitForFunction(() => { const image = document.querySelector('#recipe-image-preview'); return image.complete && image.naturalWidth > 0; });
      assert.ok(await page.locator('#recipe-image-preview').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'composer fits viewport');
      await page.locator('#recipe-post-submit').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 2);
      assert.equal(submissions, 1); assert.equal(await page.locator('.recipe-row-title').first().textContent(), '새 레시피');
      await page.locator('.recipe-row').nth(1).click();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.recipe-post').nth(1).getByRole('button', { name: '삭제', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 1);
      assert.equal(posts.length, 1);
      await page.locator('#recipe-admin-exit').click(); await page.waitForFunction(() => !document.querySelector('#recipe-editor').hidden);
      assert.equal(admin, false);
      console.log('PASS recipe board gate, owner authentication, photo submission', width);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
