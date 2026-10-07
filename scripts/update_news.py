"""Collect Google News results and render dated source links into the homepage."""
import html
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
    return unique[:9]


def render(articles, now):
    escape = html.escape
    cards = []
    for index, article in enumerate(articles):
        published = datetime.fromisoformat(article['published_at']).astimezone(KST)
        art = ('plate', 'coffee', 'arch')[index % 3]
        interior = '<i></i>' if art == 'plate' else ''
        cards.append(f'''<a class="card" href="{escape(article['url'], quote=True)}" target="_blank" rel="noopener noreferrer">
<div class="art art{index % 3 + 1}" aria-hidden="true"><span class="num">{index+1:02d}</span><div class="{art}">{interior}</div></div>
<p class="cat">{escape(article['source'])}</p><h3>{escape(article['title'])}</h3>
<p class="desc"><time datetime="{escape(article['published_at'])}">{published:%Y.%m.%d %H:%M}</time> · 한국 시간</p>
<div class="read"><span>기사 원문 읽기</span><span aria-hidden="true">↗</span></div></a>''')
    return '''<section id="trends"><div class="section-head"><div><small>DINING TREND NEWS</small><h2>외식의 다음 장면</h2></div><span>GOOGLE NEWS · 발행일 최신순</span></div>''' + f'''
<p style="font-size:12px;color:var(--muted);line-height:1.9">최근 30일 외식 트렌드 기사 · 매일 오전 9시 수집 예정 (한국 시간)<br>마지막 수집: <time datetime="{now.isoformat()}">{now.astimezone(KST):%Y.%m.%d %H:%M}</time> · 언론사명을 누르면 기사 원문으로 이동합니다.</p>
<div class="cards">{''.join(cards)}</div></section>'''


def update(xml, now):
    articles = collect(xml, now)
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
