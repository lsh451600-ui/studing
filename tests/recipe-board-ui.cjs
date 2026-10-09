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
      let submissions = 0, accountWriterMode = false, failComment = false;
      const commentStore = new Map([['first', [{ id: 1, author: '다른 회원', body: '다른 회원 댓글', created_at: '2026-10-08T01:00:00Z', canEdit: false, canDelete: false }]]]);
      let commentId = 1;
      const posts = [{ canEdit: true, canDelete: true, id: 'first', category: '베이커리', downloads: 0, attachment_url: '/api/recipe-file?id=first', attachment_name: 'recipe.pdf', title: '봄나물 비빔밥', body: '재료: 봄나물과 밥\n나물을 무쳐 밥과 함께 담습니다.', created_at: '2026-10-07T01:00:00Z' }];
      const listing = (params = new URLSearchParams()) => {
        let filtered = posts.filter(p => (!params.get('category') || p.category === params.get('category')) && (!params.get('q') || (p.title + ' ' + p.body).includes(params.get('q'))));
        if (params.get('sort') === 'title') filtered.sort((a,b) => a.title.localeCompare(b.title, 'ko'));
        if (params.get('sort') === 'downloads') filtered.sort((a,b) => (b.downloads || 0) - (a.downloads || 0));
        const totalPages = Math.max(1, Math.ceil(filtered.length / 10)), page = Math.min(Number(params.get('page') || 1), totalPages);
        return { posts: filtered.slice((page - 1) * 10, page * 10), total: filtered.length, totalPages, page };
      };
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/recipe-file') { posts[0].downloads++; return route.fulfill({ body: '%PDF-1.7 recipe', headers: { 'Content-Type': 'application/octet-stream', 'X-Recipe-Downloads': String(posts[0].downloads) } }); }
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated: false } });
        if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: {} } });
        if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
        if (url.pathname === '/api/recipes') {
          if (req.method() === 'DELETE') return route.fulfill({ json: {} });
          assert.equal(req.postDataJSON().password, 'reader-password');
          return route.fulfill({ json: { ...listing(), adminConfigured: true, canWrite: accountWriterMode, accountWriter: accountWriterMode, storageAvailable: true, next: null } });
        }
        if (url.pathname === '/api/recipe-comments') {
          if (req.method() === 'GET') return route.fulfill({ json: { comments: commentStore.get(url.searchParams.get('postId')) || [] } });
          if (req.method() === 'POST') {
            if (failComment) { failComment = false; return route.fulfill({ status: 503, json: { message: '댓글 저장 실패' } }); }
            const data = req.postDataJSON(), comments = commentStore.get(String(data.postId)) || [];
            comments.push({ id: ++commentId, author: '나의 닉네임', body: data.body, created_at: '2026-10-08T02:00:00Z', canEdit: true, canDelete: true });
            commentStore.set(String(data.postId), comments); return route.fulfill({ json: { id: commentId } });
          }
          const comments = [...commentStore.values()].find(comments => comments.some(c => c.id === Number(url.searchParams.get('id'))));
          const index = comments.findIndex(c => c.id === Number(url.searchParams.get('id')));
          assert.ok(comments[index].canEdit);
          if (req.method() === 'PATCH') comments[index].body = req.postDataJSON().body;
          if (req.method() === 'DELETE') comments.splice(index, 1);
          return route.fulfill({ json: {} });
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
            assert.ok(accountWriterMode, 'only authenticated operator submits a post');
            const payload = req.postDataJSON(); assert.equal(payload.title, '새 레시피'); assert.equal(payload.body, '새 레시피 조리 순서');
            if (payload.image) { assert.equal(payload.image.type, 'image/png'); assert.ok(payload.image.base64.length > 0); }
            posts.unshift({ ...payload, id: 'new', created_at: '2026-10-07T02:00:00Z' }); submissions++;
            return route.fulfill({ json: { success: true } });
          }
          return route.fulfill({ json: listing(url.searchParams) });
        }
        return route.continue();
      });
      const errors = []; const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/recipes');
      assert.ok(await page.locator('#recipe-gate').isVisible());
      const gateBox = await page.locator('#recipe-gate').boundingBox();
      const mainBox = await page.locator('main').boundingBox();
      assert.ok(Math.abs(gateBox.x - mainBox.x) <= 1, 'password gate aligns with left edge');
      assert.equal(await page.locator('main h1').evaluate(el => getComputedStyle(el).textAlign), 'left');
      assert.ok(!(await page.locator('#recipe-board').isVisible()));
      await page.locator('#recipe-password').fill('reader-password'); await page.locator('#recipe-submit').click();
      await page.waitForFunction(() => !document.querySelector('#recipe-board').hidden);
      assert.equal(await page.locator('.recipe-post').count(), 1);
      assert.ok(await page.locator('#recipe-editor').isHidden());
      assert.ok(await page.locator('#recipe-admin-open').isHidden());
      assert.equal(submissions, 0);
      await page.locator('.recipe-row').click(); assert.ok(await page.locator('.recipe-post-body').isVisible());
      assert.equal(await page.locator('.recipe-row-arrow').count(), 0);
      for (let theme = 0; theme < 2; theme++) {
        assert.equal(await page.locator('.recipe-detail').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
        assert.equal(await page.locator('.recipe-row').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
        assert.equal(await page.locator('.recipe-row').evaluate(el => getComputedStyle(el).borderBottomStyle), 'solid');
        assert.equal(await page.locator('.recipe-post-body').evaluate(el => getComputedStyle(el).color), 'rgb(20, 43, 73)');
        await page.locator('#theme-toggle').click();
      }
      await page.locator('.recipe-comment').waitFor();
      assert.equal(await page.locator('.recipe-comment').first().getByRole('button').count(), 0);
      const draft = page.locator('.recipe-comment-form textarea');
      await draft.fill('맛있는 레시피 감사합니다.'); failComment = true;
      await page.getByRole('button', { name: '댓글 등록', exact: true }).click();
      await page.getByText('댓글 저장 실패', { exact: true }).waitFor();
      assert.equal(await draft.inputValue(), '맛있는 레시피 감사합니다.');
      await page.getByRole('button', { name: '댓글 등록', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-comment').length === 2);
      assert.equal(await draft.inputValue(), '');
      const mine = page.locator('.recipe-comment').last();
      await mine.getByRole('button', { name: '수정', exact: true }).click();
      await mine.locator('.recipe-comment-edit textarea').fill('수정한 레시피 댓글');
      await mine.getByRole('button', { name: '저장', exact: true }).click();
      await page.getByText('수정한 레시피 댓글', { exact: true }).waitFor();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.recipe-comment').last().getByRole('button', { name: '삭제', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-comment').length === 1);
      assert.equal(await page.locator('.recipe-comment').first().locator('.recipe-comment-body').textContent(), '다른 회원 댓글');
      const received = page.waitForEvent('download'); await page.locator('.recipe-attachment').click();
      assert.equal((await received).suggestedFilename(), 'recipe.pdf');
      await page.waitForFunction(() => document.querySelector('.recipe-downloads').textContent === '1');
      if (width <= 900) {
        const footer = await page.locator('footer').evaluate(el => {
          const brand = el.querySelector('.footer-brand').getBoundingClientRect(), links = [...el.querySelectorAll('.journal-footer a')].map(a => a.getBoundingClientRect());
          return { brand: { top: brand.top, bottom: brand.bottom, right: brand.right }, links: links.map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })), right: el.getBoundingClientRect().right };
        });
        assert.ok(footer.brand.right <= footer.links[0].left);
        assert.ok(footer.links.every(r => Math.abs(r.top - footer.links[0].top) < 1));
        assert.ok(footer.links[0].top < footer.brand.bottom && footer.links[0].bottom > footer.brand.top);
        assert.ok(footer.links.at(-1).right <= footer.right + 1);
      }

      const alignment = await page.evaluate(() => {
        const heading = document.querySelector('.recipe-list-heading').children[2].getBoundingClientRect();
        const count = document.querySelector('.recipe-downloads').getBoundingClientRect();
        return Math.abs((heading.left + heading.right) / 2 - (count.left + count.right) / 2);
      });
      assert.ok(alignment < 1, 'download numbers centered below header');
      await page.locator('#recipe-category-menu summary').click();
      assert.deepEqual(await page.locator('#recipe-category-menu button').allTextContents(), ['모두보기', '베이커리', '한식', '중식', '일식', '양식']);
      await page.locator('#recipe-category-menu button[data-category="한식"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 0);
      assert.equal(await page.locator('#recipe-filter-category').inputValue(), '한식');
      await page.locator('#recipe-category-menu summary').click();
      await page.locator('#recipe-category-menu button[data-category="베이커리"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 1);
      await page.locator('#recipe-category-menu summary').click();
      await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/recipe-posts'), page.locator('#recipe-category-menu button[data-category=""]').click()]);
      await page.locator('.recipe-row').click();
      await page.locator('.recipe-post-actions').getByRole('button', { name: '수정', exact: true }).click();
      await page.locator('.recipe-inline-edit input').fill('수정한 자료');
      await page.locator('.recipe-inline-edit textarea').fill('수정한 자료 내용');
      await page.locator('.recipe-inline-edit').getByRole('button', { name: '저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.recipe-row-title').textContent === '수정한 자료');
      assert.equal(posts[0].body, '수정한 자료 내용');
      await page.locator('#recipe-filter-category').selectOption('한식');
      await page.locator('#recipe-search-query').fill('검색어');
      await page.locator('#recipe-heading-link').click();
      await page.waitForFunction(() => !document.querySelector('.recipe-post').open);
      assert.equal(await page.locator('#recipe-filter-category').inputValue(), '');
      assert.equal(await page.locator('#recipe-search-query').inputValue(), '');
      assert.ok(await page.locator('#recipe-editor').isHidden());
      assert.equal(await page.locator('.recipe-board-kicker').count(), 0);
      assert.equal(await page.locator('#recipe-admin-panel').count(), 0);
      assert.ok(await page.locator('#recipe-search-form').evaluate(form => form.querySelector('label').htmlFor === 'recipe-filter-category'));
      for (let n = 0; n < 21; n++) posts.push({ id: 'paged-' + n, downloads: n + 10, category: n % 2 ? '한식' : '베이커리', title: '페이지 자료 ' + n, body: '내용 ' + n, created_at: '2026-10-07T01:00:00Z' });
      await page.locator('#recipe-heading-link').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 10);
      assert.deepEqual(await page.locator('#recipe-pagination button').allTextContents(), ['1', '2', '3']);
      await page.locator('.recipe-row').nth(1).click();
      await page.locator('.recipe-post').nth(1).locator('.recipe-comments-empty').waitFor();
      assert.equal(await page.locator('.recipe-post').nth(1).locator('.recipe-comment').count(), 0);

      await page.getByRole('button', { name: '2페이지', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#recipe-pagination [aria-current]').textContent === '2');
      assert.equal(await page.locator('.recipe-post').count(), 10);
      await page.getByRole('button', { name: '3페이지', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 2);
      await page.locator('#recipe-search-query').fill('수정한 자료');
      await page.locator('#recipe-search-submit').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 1);
      assert.equal(await page.locator('.recipe-row-title').textContent(), '수정한 자료');
      assert.equal(await page.locator('#recipe-pagination [aria-current]').textContent(), '1');
      await page.locator('#recipe-search-query').fill('페이지 자료');
      await page.locator('#recipe-search-submit').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 10);
      await page.getByRole('button', { name: '2페이지', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#recipe-pagination [aria-current]').textContent === '2');
      assert.ok((await page.locator('.recipe-row-title').allTextContents()).every(t => t.startsWith('페이지 자료')));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'pagination fits viewport');
      await page.locator('[data-recipe-sort="downloads"]').click();
      await page.waitForFunction(() => document.querySelector('[data-recipe-sort="downloads"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.locator('#recipe-pagination [aria-current]').textContent(), '1');
      assert.equal(await page.locator('.recipe-downloads').first().textContent(), '30');
      await page.getByRole('button', { name: '2페이지', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#recipe-pagination [aria-current]').textContent === '2');
      assert.equal(await page.locator('.recipe-downloads').first().textContent(), '20');
      await page.locator('[data-recipe-sort="title"]').click();
      await page.waitForFunction(() => document.querySelector('[data-recipe-sort="title"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.locator('#recipe-pagination [aria-current]').textContent(), '1');
      const sortedTitles = await page.locator('.recipe-row-title').allTextContents();
      assert.deepEqual(sortedTitles, [...sortedTitles].sort((a,b) => a.localeCompare(b,'ko')));
      assert.equal(await page.locator('#recipe-search-query').inputValue(), '페이지 자료');
      posts.splice(1); await page.locator('#recipe-heading-link').click();
      await page.waitForFunction(() => document.querySelectorAll('.recipe-post').length === 1);
      accountWriterMode = true;
      await page.goto(origin + '/recipes');
      await page.locator('#recipe-password').fill('reader-password'); await page.locator('#recipe-submit').click();
      await page.waitForFunction(() => !document.querySelector('#recipe-board').hidden);
      assert.ok(await page.locator('#recipe-editor').isVisible());
      assert.ok(await page.locator('#recipe-admin-open').isVisible());
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
      await page.locator('#recipe-heading-link').click();
      await page.waitForFunction(() => document.querySelector('#recipe-editor').hidden);
      await page.locator('#recipe-admin-open').click(); assert.ok(await page.locator('#recipe-editor').isVisible());
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('member-session-change', { detail: false })));
      assert.ok(await page.locator('#recipe-editor').isHidden()); assert.ok(await page.locator('#recipe-admin-open').isHidden());
      assert.deepEqual(errors, []);
      console.log('PASS board gate, owner authentication, photo submission, heading navigation, operator-only editor', width);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
