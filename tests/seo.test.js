import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const origin='https://dining.win';
const publicPages=['index.html','about.html','guides.html','editorial.html','privacy.html','terms.html',...readdirSync('guides').filter(p=>p.endsWith('.html')).map(p=>'guides/'+p)];
test('all indexable pages agree on the dining.win canonical, metadata and crawlable body',()=>{
 const titles=new Set();
 for(const file of publicPages){
  const html=readFileSync(file,'utf8');const path=file==='index.html'?'/':'/'+file.replace(/\.html$/,'');
  assert.equal((html.match(/rel="canonical"/g)||[]).length,1,file);
  assert.ok(html.includes('rel="canonical" href="'+origin+path+'"'),file);
  assert.ok(!html.includes('studing.pages.dev'),file);
  const title=html.match(/<title>(.*?)<\/title>/s)?.[1];assert.ok(title && !titles.has(title),file+' unique title');titles.add(title);
  assert.equal((html.match(/name="description"/g)||[]).length,1,file);
  assert.ok(!/name="robots" content="[^"]*noindex/.test(html),file);
  assert.ok(html.includes('property="og:url" content="'+origin+path+'"'),file);
  assert.ok(html.includes('property="og:image" content="'+origin+'/assets/image.png"'),file);
  assert.ok(html.includes('type="application/rss+xml"'),file);
  assert.ok(html.includes('<h1') && html.includes('href="/guides"'),file);
  for(const [,json] of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) assert.ok(JSON.parse(json));
 }
});
test('sitemap includes only canonical public pages and discovery points to the same host',()=>{
 const sitemap=readFileSync('sitemap.xml','utf8');const urls=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
 assert.equal(new Set(urls).size,urls.length);
 assert.deepEqual(new Set(urls),new Set(publicPages.map(file=>origin+(file==='index.html'?'/':'/'+file.replace(/\.html$/,'')))));
 const robots=readFileSync('robots.txt','utf8');assert.ok(robots.includes('Sitemap: '+origin+'/sitemap.xml'));
 assert.ok(robots.includes('Allow: /') && robots.includes('Disallow: /api/'));
});
test('RSS contains original guide full text with stable canonical links, not copied external news',()=>{
 const feed=readFileSync('feed.xml','utf8');
 assert.equal((feed.match(/<item>/g)||[]).length,readdirSync('guides').filter(p=>p.endsWith('.html')).length);
 assert.ok(feed.includes('<content:encoded>') && feed.includes('https://dining.win/guides/'));
 assert.ok(!feed.includes('studing.pages.dev') && !feed.includes('news.google.com') && !feed.includes('adsbygoogle'));
});
test('member and recovery pages retain noindex after SEO updates',()=>{
 for(const name of ['board','recipes','private','startup','mypage','forgot-password','reset-password','404']) assert.match(readFileSync(name+'.html','utf8'),/name="robots" content="[^"]*noindex/);
});
