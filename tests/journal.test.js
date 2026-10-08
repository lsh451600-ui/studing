import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { contribution, breakEven } from '../assets/js/guide-tools.js';

test('menu comparison and break-even use contribution rather than food cost alone', () => {
  assert.deepEqual(contribution(9000, 3200), { amount: 5800, ratio: 5800 / 9000 });
  assert.deepEqual(breakEven(9000000, 12000, 4500, 25), { units: 1200, revenue: 14400000, daily: 48 });
  assert.deepEqual(breakEven(9000000, 12000, 5000, 25), { units: 1286, revenue: 15432000, daily: 52 });
});
test('unprofitable orders and invalid input cannot produce a misleading break-even target', () => {
  for (const args of [[100, 10, 10, 25], [100, 10, 11, 25], [-1, 10, 2, 25], [100, 10, -1, 25], [100, 10, 2, 0], [100, 10, 2, 2.5], [100, 10, 2, 32], [NaN, 10, 2, 25]]) assert.equal(breakEven(...args), null);
  assert.equal(contribution(0, 0), null);
  assert.equal(contribution(Infinity, 0), null);
  assert.equal(contribution(10, 12).amount, -2);
  assert.deepEqual(breakEven(0, 10, 2, 25), { units: 0, revenue: 0, daily: 0 });
});
test('public guides are substantive static pages with resolvable navigation and matching canonicals', () => {
  const pages = readdirSync('guides').filter(p => p.endsWith('.html')).map(p => 'guides/' + p);
  assert.ok(pages.length >= 4);
  for (const file of [...pages, 'guides.html', 'about.html', 'editorial.html', 'privacy.html', 'terms.html', 'index.html']) {
    const html = readFileSync(file, 'utf8');
    assert.equal((html.match(/<main\b/g) || []).length, 1, file);
    assert.ok(html.includes('href="/privacy"') && html.includes('href="/guides"'), file);
    const route = file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, '');
    assert.ok(html.includes('rel="canonical" href="https://studing.pages.dev' + route + '"'), file);
    assert.ok(!html.includes('name="robots" content="noindex'), file);
    if (file.startsWith('guides/')) {
      assert.ok(html.includes('AI 보조') && html.includes('예시'), file);
      assert.ok(html.split('<main')[1].split('</main>')[0].replace(/<[^>]+>/g, '').length > 1800, file);
      assert.equal((html.match(/adsbygoogle\.js/g) || []).length, 1);
    }
    for (const [, target] of html.matchAll(/href="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
      if (target === '/') continue;
      assert.ok(existsSync('.' + target) || existsSync('.' + target + '.html'), file + ' → ' + target);
    }
  }
});
test('ads are excluded from service, private, recovery, policy and error screens', () => {
  for (const name of ['board', 'recipes', 'startup', 'private', 'mypage', 'forgot-password', 'reset-password', 'inquiry', 'privacy', 'terms', 'editorial', 'about', 'guides', '404']) {
    assert.ok(!readFileSync(name + '.html', 'utf8').includes('adsbygoogle.js'), name);
  }
  assert.equal(readFileSync('ads.txt', 'utf8').trim(), 'google.com, pub-9310896227399637, DIRECT, f08c47fec0942fa0');
  const sitemap = readFileSync('sitemap.xml', 'utf8');
  for (const path of ['mypage', 'reset-password', 'private', 'board', 'sites/']) assert.ok(!sitemap.includes(path));
  assert.ok(readFileSync('sites/dining-trends/dist/index.html', 'utf8').includes('noindex,follow'));
});
test('every page including the active startup page shares the requested menu structure', () => {
  for (const file of [...readdirSync('.').filter(p => p.endsWith('.html') && p !== '404.html'), ...readdirSync('guides').map(p => 'guides/' + p)]) {
    const html = readFileSync(file, 'utf8');
    assert.ok(!html.includes('class="journal-nav"'), file);
    assert.equal((html.match(/class="menu-submenu" href="\/guides"/g) || []).length, 1, file);
    assert.ok(html.includes('<span>사이트소개</span>'), file);
  }
});
