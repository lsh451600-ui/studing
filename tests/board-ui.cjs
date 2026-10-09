const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, pathname === '/board' ? 'board.html' : pathname.slice(1));
    if (!file.startsWith(root + '/')) return res.writeHead(403).end();
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream' }).end(data); } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const privateMarkup = await readFile(resolve(root, 'private.html'), 'utf8');
  assert.match(privateMarkup, /<a href="\/recipes"><span class="menu-number">03<\/span><span>레시피<\/span>/);
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let isAdmin = false, authenticated = false, missing = false, commentWrites = 0, postWrites = 0, viewWrites = 0;
      const posts = [{ id: 1, title: '외식 이야기', body: '<script>window.injected = true</script>', author: '회원', created_at: '2026-10-07T01:00:00Z', comments: 0 }], comments = [];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/session') return route.fulfill({ json: { available: true, authenticated, user: authenticated ? { id: 'member', username: 'member', isAdmin } : null } });
        if (url.pathname === '/api/register') return route.fulfill({ json: { available: true } });
        if (url.pathname === '/api/oauth') return route.fulfill({ json: { providers: {} } });
        if (url.pathname === '/api/visitors') return route.fulfill({ json: { available: true, today: 1, total: 2 } });
        if (url.pathname === '/api/board-views') {
          assert.equal(req.method(), 'POST'); viewWrites++;
          const post = posts.find(p => p.id === Number(url.searchParams.get('id'))); post.views = (post.views || 0) + 1;
          return route.fulfill({ json: { views: post.views } });
        }
        if (url.pathname === '/api/board-posts') {
          if (missing) return route.fulfill({ status: 503, json: { message: '게시판 저장소 연결이 필요합니다.' } });
          if (req.method() === 'POST') {
            assert.ok(authenticated); const data = req.postDataJSON(); postWrites++;
            assert.equal(typeof data.is_secret, 'boolean'); posts.unshift({ ...data, id: 2, author: '회원', created_at: '2026-10-07T02:00:00Z', comments: 0 });
            return route.fulfill({ json: { id: 2 } });
          }
          if (req.method() === 'PATCH') { assert.ok(authenticated); Object.assign(posts[0], req.postDataJSON()); return route.fulfill({ json: { id: 1 } }); }
          if (req.method() === 'DELETE') { assert.ok(authenticated); posts.splice(0, posts.length); return route.fulfill({ json: { id: 1 } }); }
          return route.fulfill({ json: url.searchParams.has('id') ? { post: posts.find(p => p.id === Number(url.searchParams.get('id'))), comments, permissions: authenticated ? { canEdit: true, canDelete: true } : { canEdit: false, canDelete: false } } : { posts, next: null } });
        }
        if (url.pathname === '/api/board-comments') {
          assert.ok(authenticated);
          if (req.method() === 'DELETE') {
            const index = comments.findIndex(c => c.id === Number(url.searchParams.get('id')));
            assert.ok(index >= 0); comments.splice(index, 1);
            return route.fulfill({ json: { id: Number(url.searchParams.get('id')) } });
          }
          if (req.method() === 'PATCH') {
            comments.find(c => c.id === Number(url.searchParams.get('id'))).body = req.postDataJSON().body;
            return route.fulfill({ json: { id: Number(url.searchParams.get('id')) } });
          }
          const data = req.postDataJSON(); assert.equal(data.postId, 1); commentWrites++;
          comments.push({ canEdit: true, canDelete: true, id: commentWrites, body: data.body, author: '회원', created_at: '2026-10-07T02:00:00Z' });
          return route.fulfill({ json: { id: commentWrites } });
        }
        return route.continue();
      });
      const page = await context.newPage(); await page.goto(origin + '/board');
      await page.waitForSelector('.board-row');
      await page.waitForFunction(() => document.getElementById('board-login-hint').hidden === false);
      await page.locator('.board-row').click();
      await page.waitForSelector('#board-detail:not([hidden])');
      assert.equal(await page.locator('#board-search-form').count(), 0);
      assert.ok(await page.locator('#board-write').isVisible());
      assert.ok(await page.locator('#board-post-form').isHidden());
      assert.equal(await page.locator('#board-title').textContent(), '외식 이야기');
      assert.equal(await page.locator('.board-post-card').evaluate(element => getComputedStyle(element).backgroundColor), await page.locator('#board-comment-form').evaluate(element => getComputedStyle(element).backgroundColor));
      assert.equal(await page.locator('.board-title-box #board-author').count(), 1);
      assert.equal(await page.locator('#board-author').evaluate(element => getComputedStyle(element).textAlign), 'right');
      assert.equal(await page.locator('.board-title-line #board-title').count(), 0);
      assert.equal(await page.locator('.board-title-line #board-author').count(), 1);
      assert.ok(await page.locator('#board-author').evaluate(element => {
        const author = element.getBoundingClientRect(), title = document.querySelector('#board-title').getBoundingClientRect();
        return author.bottom <= title.top && Math.abs(author.right - title.right) < 1;
      }));
      assert.equal(await page.locator('#board-back').count(), 0);
      assert.equal(await page.title(), '외모Check-자유게시판');
      assert.equal(await page.locator('#board-body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(252, 251, 248)');
      assert.ok(await page.locator('#board-detail').evaluate(element => Math.abs(element.getBoundingClientRect().width - document.querySelector('.board-page').getBoundingClientRect().width) < 1));
      assert.equal(await page.locator('#board-body').textContent(), posts[0].body);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.ok(await page.locator('#board-comment-submit').isDisabled());
      authenticated = true;
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('member-authenticated', { detail: { id: 'member', username: 'abcdefghijklmnopqrst', kakaoLinked: true } })));
      await page.waitForFunction(() => !document.querySelector('#board-comment-submit').disabled);
      assert.ok(await page.locator('#board-login-hint').isHidden());
      await page.locator('#board-comment-body').fill('좋은 이야기입니다.'); await page.locator('#board-comment-submit').click();
      await page.waitForFunction(() => document.querySelectorAll('.board-comment').length === 1); assert.equal(commentWrites, 1);
      assert.ok(await page.locator('#board-comment-submit').evaluate(element => Math.abs(element.getBoundingClientRect().right - document.querySelector('#board-comment-body').getBoundingClientRect().right) < 1));
      assert.equal(await page.locator('#board-author strong').evaluate(element => getComputedStyle(element).fontWeight), '700');
      assert.ok(!(await page.locator('#board-author').textContent()).includes('한국 시간'));
      await page.getByRole('button', { name: '댓글 수정', exact: true }).click();
      await page.locator('.board-comment-edit textarea').fill('수정한 댓글');
      await page.locator('.board-comment-edit button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.board-comment-body')?.textContent === '수정한 댓글');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '댓글 삭제', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.board-comment').length === 0);
      assert.equal(comments.length, 0);
      assert.equal(viewWrites, 1, 'comment and login refreshes do not count new views');
      await page.locator('#board-heading-link').click();
      await page.waitForSelector('.board-row');
      assert.equal(new URL(page.url()).pathname, '/board');
      await page.waitForFunction(() => document.querySelector('.board-row .board-meta')?.textContent.includes('조회수 1 · 댓글'));
      assert.match(await page.locator('.board-row .board-meta').textContent(), /조회수 1 · 댓글/);
      if (width >= 768) assert.ok(await page.locator('.board-row .board-meta').evaluate(meta => {
        const row = meta.parentElement.getBoundingClientRect(), box = meta.getBoundingClientRect(), title = meta.previousElementSibling.getBoundingClientRect();
        return Math.abs(box.right - row.right + 4) < 1 && box.left > title.left && Math.abs((box.top + box.bottom) / 2 - (title.top + title.bottom) / 2) < 1;
      }));
      await page.locator('.board-row').click();
      await page.waitForSelector('#board-detail:not([hidden])');
      await page.locator('#board-edit-open').click();
      await page.locator('#board-edit-title').fill('수정한 이야기');
      await page.locator('#board-edit-body').fill('수정한 내용');
      await page.locator('#board-edit-submit').click();
      await page.waitForFunction(() => document.querySelector('#board-title').textContent === '수정한 이야기');
      assert.equal(posts[0].body, '수정한 내용');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#board-delete').click();
      await page.waitForFunction(() => !document.querySelector('#board-index').hidden);
      assert.equal(posts.length, 0);
      await page.locator('#board-write').click();
      assert.equal(await page.locator('#board-post-category option[value=공지]').evaluate(el => el.disabled), true);
      await page.locator('#board-post-category').selectOption('질문');
      await page.locator('#board-post-secret').check();
      await page.locator('#board-post-title').fill('새 게시글');
      await page.locator('#board-post-body').fill('새 게시글 본문');
      await page.locator('#board-post-submit').click();
      await page.waitForFunction(() => document.querySelector('#board-title').textContent === '새 게시글');
      assert.equal(postWrites, 1);
      assert.equal(posts[0].category, '질문');
      assert.equal(await page.locator('#board-detail-category').textContent(), '🔒 비밀글 · 질문');
      await page.locator('#board-write').click();
      assert.ok(await page.locator('#board-post-form').isVisible());
      assert.equal(new URL(page.url()).pathname, '/board');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await context.addInitScript(() => {
        window.loginFlash = false;
        new MutationObserver(() => {
          const hint = document.getElementById('board-login-hint');
          const login = document.getElementById('login-open');
          if ((hint && !hint.hidden) || (login && !login.hidden)) window.loginFlash = true;
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      });
      await page.goto(origin + '/board');
      await page.waitForFunction(() => document.querySelector('.member-controls').dataset.state === 'authenticated');
      assert.equal(await page.evaluate(() => window.loginFlash), false);
      isAdmin = true; await page.goto(origin + '/board');
      await page.waitForFunction(() => !document.querySelector('#board-post-category option[value=공지]').disabled);
      await page.locator('#board-write').click();
      await page.locator('#board-post-category').selectOption('공지');
      await page.locator('#board-post-title').fill('운영 공지');
      await page.locator('#board-post-body').fill('운영 안내');
      await page.locator('#board-post-submit').click();
      await page.waitForFunction(() => document.querySelector('#board-title').textContent === '운영 공지');
      assert.equal(await page.locator('#board-title').evaluate(el => getComputedStyle(el).color), 'rgb(199, 53, 53)');
      await page.locator('#board-heading-link').click();
      await page.locator('.board-notice').waitFor();
      assert.equal(await page.locator('.board-notice strong').evaluate(el => getComputedStyle(el).color), 'rgb(199, 53, 53)');
      posts[0].authorLevel = 'special';
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await page.locator('.board-row .member-crown').waitFor();
      comments.push({ id: 99, author: '이전 댓글 작성자', body: '이전 댓글', created_at: '2026-10-07T02:00:00Z', authorLevel: 'regular' });
      await page.locator('.board-row').first().click();
      await page.locator('[data-comment-id="99"]').waitFor();
      await page.locator('#board-comment-body').fill('작성 중인 내용');
      comments.find(comment => comment.id === 99).authorLevel = 'special';
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await page.locator('[data-comment-id="99"] .member-crown').waitFor();
      assert.equal(await page.locator('#board-comment-body').inputValue(), '작성 중인 내용');
      assert.equal(await page.locator('#board-author .member-crown').count(), 1);
      missing = true; await page.goto(origin + '/board');
      await page.waitForFunction(() => document.querySelector('#board-status').textContent.includes('저장소'));
      console.log('PASS community read, login gating, safe text, post, comment, missing storage', width); await context.close();
    }
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
