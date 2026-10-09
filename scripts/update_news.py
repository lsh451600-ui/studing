"""Collect Google News results and render dated source links into the homepage."""
import html
import hashlib
import json
import os
from difflib import SequenceMatcher
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))
QUERY = '외식 (트렌드 OR 소비 OR 가성비 OR 혼밥 OR 물가 OR 시장) -아카데미 -교육 -모집 when:7d'
FEED = 'https://news.google.com/rss/search?' + urllib.parse.urlencode(
    {'q': QUERY, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'})


def title_key(title):
    return re.sub(r'[^\w]', '', re.sub(r'\[[^]]*\]|【[^】]*】', '', title)).lower()


def same_article(article, previous):
    if article['url'] == previous.get('url'):
        return True
    left, right = title_key(article['title']), title_key(previous.get('title', ''))
    return bool(left and right) and (left == right or
        min(len(left), len(right)) >= 15 and SequenceMatcher(None, left, right).ratio() >= 0.86)


def collect(xml, now, history=()):
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
        if not title or not source or not now - timedelta(days=7) <= published <= now:
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
        if key not in seen and not any(same_article(article, old) for old in [*history, *unique]):
            seen.add(key)
            unique.append(article)
    if not articles:
        raise ValueError('No valid recent articles. Preserve the previous homepage.')
    return unique[:18]


def photo_url(value, base=''):
    url = urllib.parse.urljoin(base, html.unescape(value))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme == 'http':
        url = urllib.parse.urlunparse(parsed._replace(scheme='https'))
        parsed = urllib.parse.urlparse(url)
    return url if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password else None


def local_photo(value):
    return isinstance(value, str) and bool(re.fullmatch(r'/assets/news/[a-f0-9]{24}\.(jpg|png|webp)', value))


def image_extension(data):
    if data.startswith(b'\xff\xd8\xff'): return 'jpg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return 'webp'
    raise ValueError('Not a supported article photo')


def store_photo(url, original):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': original})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) < 128 or len(data) > 8 * 1024 * 1024:
        raise ValueError('Article photo size out of range')
    extension = image_extension(data)
    name = hashlib.sha256(data).hexdigest()[:24] + '.' + extension
    folder = ROOT / 'assets/news'; folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)
    return '/assets/news/' + name


class PublisherPhoto(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = {}
        self.body_images = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'meta':
            key = (data.get('property') or data.get('name') or '').lower()
            if key in ('og:image', 'twitter:image') and data.get('content'):
                self.images.setdefault(key, data['content'])
        marker = data.get('id', '') + ' ' + data.get('class', '')
        inside = tag in ('article', 'figure') or bool(re.search(r'article[-_]?view[-_]?content|article[-_]?body|news[-_]?body|article[-_]?content', marker, re.I))
        if tag == 'img' and any(active for _, active in self.stack):
            value = data.get('data-src') or data.get('data-original') or data.get('src', '')
            if value and not re.search(r'logo|banner|icon|avatar|profile|advert|pixel', value, re.I):
                self.body_images.append(value)
        if tag not in ('img', 'meta', 'link', 'input', 'br', 'hr', 'source', 'area', 'embed', 'wbr'):
            self.stack.append((tag, inside))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]; break


def resolve_publishers(articles):
    """Save verified photos from the same publisher article, including body photos."""
    for article in articles:
        if local_photo(article.get('image')) and (ROOT / article['image'].lstrip('/')).is_file():
            continue
        try:
            original = article.get('original_url', '')
            if not original:
                from googlenewsdecoder import gnewsdecoder
                original = gnewsdecoder(article['url'], interval=1).get('decoded_url', '')
            original = photo_url(original)
            if not original:
                continue
            # Some publisher AMP pages omit metadata or reject HTTP requests.
            original = original.replace('articleViewAmp.html', 'articleView.html')
            article['original_url'] = original
            candidates = []
            existing = photo_url(article.get('image', ''))
            if existing: candidates.append(existing)
            try:
                request = urllib.request.Request(original, headers={'User-Agent': 'Mozilla/5.0 (compatible; DiningTrendJournal/1.0)'})
                with urllib.request.urlopen(request, timeout=12) as response:
                    markup = response.read(2 * 1024 * 1024).decode('utf-8', errors='replace')
                    parser = PublisherPhoto(); parser.feed(markup)
                    candidates.extend(photo_url(value, response.url) for value in [parser.images.get('og:image', ''), parser.images.get('twitter:image', ''), *parser.body_images] if value)
            except Exception as error:
                print(f'Publisher page unavailable: {type(error).__name__}')
            for image in dict.fromkeys(candidates):
                if not image or re.search(r'/[^/]*(logo|banner|icon)[^/]*$', image, re.I): continue
                try:
                    article['image'] = store_photo(image, original)
                    article['image_original'] = image
                    article['image_alt'] = article['title'] + ' · ' + article['source'] + ' 제공 사진'
                    article['image_source'] = original
                    break
                except Exception as error:
                    print(f'Publisher photo unavailable: {type(error).__name__}')
        except Exception as error:
            print(f'Publisher link unavailable: {type(error).__name__}')


def render(articles, now):
    escape = html.escape
    cards = []
    for article in articles[:6]:
        published = datetime.fromisoformat(article['published_at']).astimezone(KST)
        image = article.get('image') if local_photo(article.get('image')) else photo_url(article.get('image', ''))
        if not image: continue
        photo = f'<div class="news-photo"><img src="{escape(image, quote=True)}" alt="{escape(article.get("image_alt", article["title"]), quote=True)}" data-fallback="{escape(article.get("image_original", ""), quote=True)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="640" height="400"></div><p class="news-photo-credit">사진 출처: {escape(article["source"])}</p>'
        cards.append(f'''<a class="card" href="{escape(article.get('original_url', article['url']), quote=True)}" target="_blank" rel="noopener noreferrer">
{photo}
<p class="cat">{escape(article['source'])}</p><h3>{escape(article['title'])}</h3>
<p class="desc"><time datetime="{escape(article['published_at'])}">{published:%Y.%m.%d %H:%M}</time> · 한국 시간</p>
<div class="read"><span>기사 원문 읽기</span><span aria-hidden="true">↗</span></div></a>''')
    return '''<section id="trends"><div class="section-head"><div><small>DINING TREND NEWS</small><h2>외식의 다음 장면</h2></div><span>외부 기사 링크 · 발행일 최신순</span></div>''' + f'''

<p class="external-news-note">Google 뉴스에서 수집한 외부 기사 제목입니다. 내용과 권리는 원문 매체에 있으며, 본 사이트의 실무 가이드와 구분됩니다.</p><div class="cards">{''.join(cards)}</div><p id="news-status" data-collected="{now.astimezone(KST):%Y.%m.%d %H:%M}" style="font-size:12px;color:var(--muted);line-height:1.9;white-space:pre-line" role="status">최근 7일 외식 트렌드 최신 기사 · 매일 오전 9시·오후 9시 자동 갱신 (한국 시간)<br>마지막 수집: <time datetime="{now.isoformat()}">{now.astimezone(KST):%Y.%m.%d %H:%M}</time> · 카드를 누르면 기사 원문으로 이동합니다.</p></section>'''


def update(xml, now):
    local = json.loads((ROOT / 'news.json').read_text()) if (ROOT / 'news.json').exists() else {}
    previous_path = os.environ.get('PREVIOUS_NEWS_PATH')
    remote = json.loads(Path(previous_path).read_text()) if previous_path else {}
    previous = max([local, remote], key=lambda data: data.get('updated_at', ''))
    history = []
    for data in [local, remote]:
        for article in [*data.get('history', []), *data.get('articles', [])]:
            if article.get('url') and article.get('title') and not any(old['url'] == article['url'] for old in history):
                history.append({key: article[key] for key in ('url', 'title', 'published_at')})
    unseen = collect(xml, now, history)
    # Keep current cards while filling open slots with never-published articles.
    # A partial update must not shrink six cards to only the new arrivals.
    local_articles = {a['url']: a for a in local.get('articles', [])}
    retained = [{**a, **local_articles.get(a['url'], {})} for a in previous.get('articles', [])]
    retained.extend(local.get('articles', []))
    candidates = sorted([*unseen, *retained],
                        key=lambda article: datetime.fromisoformat(article['published_at']), reverse=True)
    articles = []
    for article in candidates:
        if not now - timedelta(days=7) <= datetime.fromisoformat(article['published_at']) <= now:
            continue
        if not any(same_article(article, old) for old in articles):
            articles.append(article)

    if not articles:
        raise ValueError('No valid recent articles available')
    new_urls = {a['url'] for a in unseen}
    with_photos = []
    for article in articles:
        resolve_publishers([article])
        if local_photo(article.get('image')) and (ROOT / article['image'].lstrip('/')).is_file():
            with_photos.append(article)
        if len(with_photos) == 6: break
    articles = with_photos
    if not articles:
        raise ValueError('No verified article photos available; preserve the previous homepage')
    new_count = sum(a['url'] in new_urls for a in articles)
    for article in articles:
        if not any(old['url'] == article['url'] for old in history):
            history.append({key: article[key] for key in ('url', 'title', 'published_at')})
    history = [a for a in history if datetime.fromisoformat(a['published_at']) >= now - timedelta(days=60)]
    page = ROOT / 'index.html'
    original = page.read_text(encoding='utf-8')
    changed, count = re.subn(r'<section id="trends">.*?</section>',
                            lambda match: render(articles, now), original, count=1, flags=re.S)
    if count != 1:
        raise ValueError('News section not found; no files changed.')
    # Keep the initial template scripts: news cards are links, not dialog buttons.
    page.write_text(changed, encoding='utf-8')
    (ROOT / 'news.json').write_text(json.dumps({'updated_at': now.isoformat(),
        'source': FEED, 'articles': articles, 'history': history, 'new_articles': new_count}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'src/news-snapshot.js').write_text('export const snapshot = ' + (ROOT / 'news.json').read_text().strip() + ';\n', encoding='utf-8')
    print(f'Updated {len(articles)} articles, newest: {articles[0]["published_at"]}')


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
