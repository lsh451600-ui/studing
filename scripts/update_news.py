"""Collect Google News results and render dated source links into the homepage."""
import html
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
QUERY = '외식 (트렌드 OR 소비 OR 가성비 OR 혼밥 OR 물가 OR 시장) -아카데미 -교육 -모집 when:30d'
FEED = 'https://news.google.com/rss/search?' + urllib.parse.urlencode(
    {'q': QUERY, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'})


def collect(xml, now):
    articles = []
    seen = set()
    for item in ET.fromstring(xml).findall('./channel/item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        source = (item.findtext('source') or '').strip()
        try:
            published = parsedate_to_datetime(item.findtext('pubDate') or '')
        except (ValueError, TypeError):
            continue
        if published.tzinfo is None:
            continue
        parsed = urllib.parse.urlparse(link)
        if parsed.scheme != 'https' or parsed.hostname != 'news.google.com':
            continue
        if not title or not source or not now - timedelta(days=30) <= published <= now:
            continue
        if not any(word in title for word in ('외식', '레스토랑', '식당', '프랜차이즈', '음식점')):
            continue
        if any(word in title for word in ('아카데미', '교육 모집', '무료 교육', '무료교육', '맞춤형 교육', '룰렛', '카지노', '슬롯', '시어머니', '며느리')):
            continue
        if not any(word in title for word in ('트렌드', '소비', '물가', '시장', '열풍', '확산', '변화', '증가', '감소', '성장', '가성비', '혼밥', '식재료', '산업')):
            continue
        suffix = ' - ' + source
        if title.endswith(suffix):
            title = title[:-len(suffix)]
        key = re.sub(r'\W+', '', title).lower()
        articles.append({'title': title, 'url': link, 'source': source,
                         'published_at': published.isoformat(), '_key': key})
    articles.sort(key=lambda a: datetime.fromisoformat(a['published_at']), reverse=True)
    unique = []
    for article in articles:
        key = article.pop('_key')
        if key not in seen:
            seen.add(key)
            unique.append(article)
    if not unique:
        raise ValueError('No valid recent articles. Preserve the previous homepage.')
    return unique[:6]


def image_candidates(markup, page_url):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(markup, 'html.parser')
    body = soup.select_one('#article-view-content-div, #newsct_article, #harmonyContainer, .article-view-content, .article_body, .article-body, .news_body, article')
    images = list(body.select('img')) if body else []
    candidates = []
    for img in images:
        src = img.get('data-src') or img.get('data-original') or img.get('src')
        label = (src or '') + ' ' + (img.get('alt') or '')
        if not src or re.search(r'logo|banner|icon|avatar|advert|기자|로고', label, re.I):
            continue
        candidates.append((src, img.get('alt') or ''))
    # Publisher metadata supplies the article representative image on other layouts.
    for meta in soup.select('meta[property="og:image"], meta[name="twitter:image"]'):
        if meta.get('content'):
            candidates.append((meta['content'], ''))
    result = []
    seen = set()
    for src, alt in candidates:
        url = urllib.parse.urljoin(page_url, html.unescape(src))
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme in ('http', 'https') and parsed.hostname and url not in seen:
            seen.add(url)
            result.append((url, alt))
    return result


def download_image(url, page_url):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; DiningTrendJournal/1.0)', 'Referer': page_url})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024 or len(data) < 512:
        raise ValueError('Image is too large or too small')
    if data.startswith(b'\xff\xd8\xff'):
        ext = '.jpg'
    elif data.startswith(b'\x89PNG\r\n\x1a\n'):
        ext = '.png'
    elif data.startswith((b'GIF87a', b'GIF89a')):
        ext = '.gif'
    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        ext = '.webp'
    else:
        raise ValueError('Unsupported image response')
    relative = 'assets/news/' + hashlib.sha256(data).hexdigest()[:24] + ext
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return relative


def enrich_images(articles):
    from googlenewsdecoder import gnewsdecoder
    previous = {}
    if (ROOT / 'news.json').exists():
        previous = {a['url']: a for a in json.loads((ROOT / 'news.json').read_text())['articles']}
    for article in articles:
        cached = previous.get(article['url'], {})
        if cached.get('image') and (ROOT / cached['image']).is_file():
            for key in ('image', 'image_source', 'image_alt', 'original_url'):
                if key in cached:
                    article[key] = cached[key]
            continue
        try:
            result = gnewsdecoder(article['url'], interval=1)
            if not (result.get('success') or result.get('status')):
                raise ValueError(result.get('message', 'Cannot resolve article'))
            original_url = result['decoded_url']
            if urllib.parse.urlparse(original_url).scheme not in ('https', 'http'):
                raise ValueError('Invalid publisher URL')
            article['original_url'] = original_url
            request = urllib.request.Request(original_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; DiningTrendJournal/1.0)'})
            with urllib.request.urlopen(request, timeout=20) as response:
                page_url = response.url
                markup = response.read(3 * 1024 * 1024)
            for url, alt in image_candidates(markup, page_url)[:5]:
                try:
                    article['image'] = download_image(url, page_url)
                    article['image_source'] = url
                    article['image_alt'] = alt or article['title'] + ' · 기사 사진'
                    break
                except Exception as error:
                    print(f'Image candidate skipped: {type(error).__name__}')
        except Exception as error:
            print(f'Article image unavailable ({article["source"]}): {error}')
    used = {a.get('image') for a in articles}
    for path in (ROOT / 'assets/news').glob('*'):
        if path.is_file() and path.relative_to(ROOT).as_posix() not in used:
            path.unlink()


def render(articles, now):
    escape = html.escape
    cards = []
    for index, article in enumerate(articles[:6]):
        published = datetime.fromisoformat(article['published_at']).astimezone(KST)
        image = '<div class="news-photo news-photo-empty"><span>기사 이미지 미제공</span></div>'
        if article.get('image'):
            image = f'<div class="news-photo"><img src="{escape(article["image"], quote=True)}" alt="{escape(article.get("image_alt", article["title"]), quote=True)}" loading="lazy" decoding="async" width="640" height="400"></div>'
        cards.append(f'''<a class="card" href="{escape(article.get('original_url', article['url']), quote=True)}" target="_blank" rel="noopener noreferrer">
{image}
<p class="cat">{escape(article['source'])}</p><h3>{escape(article['title'])}</h3>
<p class="desc"><time datetime="{escape(article['published_at'])}">{published:%Y.%m.%d %H:%M}</time> · 한국 시간</p>
<div class="read"><span>기사 원문 읽기</span><span aria-hidden="true">↗</span></div></a>''')
    return '''<section id="trends"><div class="section-head"><div><small>DINING TREND NEWS</small><h2>외식의 다음 장면</h2></div><span>GOOGLE NEWS · 발행일 최신순</span></div>''' + f'''
<p style="font-size:12px;color:var(--muted);line-height:1.9">최근 30일 외식 트렌드 최신 6개 · 매일 오전 9시 수집 예정 (한국 시간)<br>마지막 수집: <time datetime="{now.isoformat()}">{now.astimezone(KST):%Y.%m.%d %H:%M}</time> · 카드를 누르면 기사 원문으로 이동합니다.</p>
<style>.news-photo{{height:200px;border-radius:10px;overflow:hidden;background:var(--surface)}}.news-photo img{{width:100%;height:100%;display:block;object-fit:cover}}.news-photo-empty{{display:grid;place-items:center;color:var(--muted);font-size:12px}}</style>
<div class="cards">{''.join(cards)}</div></section>'''


def update(xml, now):
    articles = collect(xml, now)
    enrich_images(articles)
    page = ROOT / 'index.html'
    original = page.read_text(encoding='utf-8')
    changed, count = re.subn(r'<section id="trends">.*?</section>',
                            lambda match: render(articles, now), original, count=1, flags=re.S)
    if count != 1:
        raise ValueError('News section not found; no files changed.')
    # Keep the initial template scripts: news cards are links, not dialog buttons.
    page.write_text(changed, encoding='utf-8')
    (ROOT / 'news.json').write_text(json.dumps({'updated_at': now.isoformat(),
        'source': FEED, 'articles': articles}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Updated {len(articles)} articles, images: {sum(bool(a.get("image")) for a in articles)}, newest: {articles[0]["published_at"]}')


if __name__ == '__main__':
    for attempt in range(3):
        try:
            request = urllib.request.Request(FEED, headers={'User-Agent': 'DiningTrendJournal/1.0'})
            with urllib.request.urlopen(request, timeout=45) as response:
                xml = response.read()
            update(xml, datetime.now(timezone.utc))
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
