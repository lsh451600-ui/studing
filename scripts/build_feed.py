"""Build RSS containing our complete public guide articles, never external news."""
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import format_datetime
from html import unescape
from pathlib import Path
from zoneinfo import ZoneInfo

CONTENT = 'http://purl.org/rss/1.0/modules/content/'
ATOM = 'http://www.w3.org/2005/Atom'
ET.register_namespace('content', CONTENT)
ET.register_namespace('atom', ATOM)
ORIGIN = 'https://dining.win'


def build(root):
    rss = ET.Element('rss', version='2.0')
    channel = ET.SubElement(rss, 'channel')
    for key, value in [('title', '외모Check 실무 가이드'), ('link', ORIGIN + '/guides'),
                       ('description', '외식 매장 운영의 질문을 계산 예시와 관찰 기록지로 점검하는 공개 실무 가이드.'), ('language', 'ko')]:
        ET.SubElement(channel, key).text = value
    ET.SubElement(channel, '{' + ATOM + '}link', href=ORIGIN + '/feed.xml', rel='self', type='application/rss+xml')
    articles = []
    for path in (root / 'guides').glob('*.html'):
        html = path.read_text()
        metadata = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)[1])
        date = datetime.fromisoformat(metadata['datePublished']).replace(tzinfo=ZoneInfo('Asia/Seoul'))
        body = re.search(r'<article\b[^>]*>(.*?)</article>', html, re.S)[1]
        body = re.sub(r'<(?:script|style|button)\b[^>]*>.*?</(?:script|style|button)>', '', body, flags=re.S)
        body = re.sub(r'(href|src)="(/[^\"]*)"', lambda m: m[1] + '="' + ORIGIN + m[2] + '"', body)
        articles.append((date, path.stem, metadata, body))
    articles.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if articles:
        ET.SubElement(channel, 'lastBuildDate').text = format_datetime(articles[0][0])
    for date, slug, metadata, body in articles:
        item = ET.SubElement(channel, 'item')
        url = ORIGIN + '/guides/' + slug
        for key, value in [('title', metadata['headline']), ('link', url), ('description', metadata['description']),
                           ('pubDate', format_datetime(date)), ('author', None)]:
            if value is not None:
                ET.SubElement(item, key).text = unescape(value)
        ET.SubElement(item, 'guid', isPermaLink='true').text = url
        ET.SubElement(item, '{' + CONTENT + '}encoded').text = body
    ET.indent(rss)
    return ET.tostring(rss, encoding='utf-8', xml_declaration=True).decode() + '\n'


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    (root / 'feed.xml').write_text(build(root))
