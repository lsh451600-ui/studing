"""Publish one original practical guide per Korea-local ISO week.

OPENAI_API_KEY is read only from the runner environment. No generated HTML is
trusted: structured plain text is validated and escaped into the current shell.
"""
import json
import os
import re
import sys
from datetime import datetime
from difflib import SequenceMatcher
from html import escape, unescape
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
KST = ZoneInfo('Asia/Seoul')


def week_slug(now):
    year, week, _ = now.astimezone(KST).isocalendar()
    return f'weekly-{year}-{week:02d}'


def titles(root):
    return [unescape(re.search(r'<h1[^>]*>(.*?)</h1>', p.read_text(), re.S)[1])
            for p in sorted((root / 'guides').glob('*.html'))]


def validate(data, previous):
    for key in ('title', 'summary', 'category', 'scope'):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f'Missing {key}')
    if len(data['title']) > 90 or len(data['summary']) > 250:
        raise ValueError('Title/summary too long')
    def normalized(value):
        return re.sub(r'\W', '', value).casefold()
    if any(SequenceMatcher(None, normalized(data['title']), normalized(t)).ratio() > .72 for t in previous):
        raise ValueError('Duplicate topic/title')
    sections = data.get('sections', [])
    if not 5 <= len(sections) <= 8:
        raise ValueError('Expected 5–8 substantive sections')
    for section in sections:
        if not section.get('heading') or not 2 <= len(section.get('paragraphs', [])) <= 5:
            raise ValueError('Incomplete section')
        if any(not isinstance(p, str) or len(p) < 80 for p in section['paragraphs']):
            raise ValueError('Thin paragraph')
    if not 5 <= len(data.get('worksheet', [])) <= 10:
        raise ValueError('Worksheet missing')
    text = json.dumps(data, ensure_ascii=False)
    if not 2300 <= len(text) <= 16000 or '<' in text or 'https://' in text or 'http://' in text:
        raise ValueError('Invalid text, length or unverified external citations')
    if '예시' not in text:
        raise ValueError('Hypothetical examples must be labelled')
    return data


def generate(previous):
    key = os.environ.get('OPENAI_API_KEY', '')
    if not key:
        raise RuntimeError('Register OPENAI_API_KEY in GitHub Actions secrets to enable weekly writing.')
    string = {'type': 'string'}
    def obj(properties):
        return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}
    schema = obj({'title': string, 'summary': string, 'category': string, 'scope': string,
                  'sections': {'type': 'array', 'items': obj({'heading': string, 'paragraphs': {'type': 'array', 'items': string}})},
                  'worksheet': {'type': 'array', 'items': string}})
    prompt = '''한국어 외식 저널의 공개 실무 학습 가이드 한 편을 새로 작성하세요.
기존 제목들과 다른 구체적인 매장 운영 질문을 선택하세요. 메뉴·손익·고객 동선 외에도 예약 취소, 피크타임 인수인계, 포장 경험, 재방문 관찰 등 새로운 문제를 탐색하세요.
기존 글과 같은 깊이의 5~8개 절, 절마다 2~5개 문단(문단당 100~300자), 총 3000~6000자로 작성하세요.
구체적인 실행 순서, 설명용 가상 매장 사례(반드시 '예시' 표시), 수치 사용 시 분모와 단위 및 검산, 반례와 적용 한계, 1~2주 소규모 시험과 중단 기준, 인쇄할 기록지 질문 5~10개를 포함하세요.
시장 통계, 취재·경험·실제 성과·전문가 검수 주장을 만들지 마세요. 법률·세무·건강·식품 안전 지침을 다루지 마세요. 외부 사실을 확인할 웹 접근이 없으므로 인용·URL·참고문헌을 생성하지 마세요. 관찰 제안과 가정으로만 설명하고 scope에 이 한계를 명시하세요.
모든 필드는 HTML/마크다운 없는 일반 문자열입니다. summary는 160자 이하, title은 65자 이하. 기존 제목: ''' + json.dumps(previous, ensure_ascii=False)
    body = json.dumps({'model': os.environ.get('OPENAI_GUIDE_MODEL') or 'gpt-4.1', 'store': False,
                       'input': prompt, 'max_output_tokens': 10000,
                       'text': {'format': {'type': 'json_schema', 'name': 'weekly_guide', 'strict': True, 'schema': schema}}}).encode()
    request = Request('https://api.openai.com/v1/responses', data=body,
                      headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=180) as response:
            result = json.load(response)
    except HTTPError as error:
        raise RuntimeError(f'Writing API returned HTTP {error.code}; check Actions secret, model access and billing.') from None
    if result.get('status') != 'completed':
        raise RuntimeError('Writing did not complete; no page published.')
    output = ''.join(c.get('text', '') for item in result.get('output', [])
                     if item.get('type') == 'message' for c in item.get('content', []) if c.get('type') == 'output_text')
    return validate(json.loads(output), previous)


def publish(root, now, data):
    slug = week_slug(now)
    target = root / 'guides' / (slug + '.html')
    if target.exists():
        return False
    validate(data, titles(root))
    e = escape
    date = now.astimezone(KST).date().isoformat()
    route = '/guides/' + slug
    url = 'https://studing.pages.dev' + route
    shell = (root / 'guides/menu-complexity.html').read_text()
    shell = re.sub(r'<title>.*?</title>', '<title>' + e(data['title']) + ' · 외·모Check</title>', shell, count=1)
    for name, value in [('description', data['summary']), ('og:title', data['title']), ('og:description', data['summary']), ('og:url', url)]:
        shell = re.sub(r'(<meta (?:name|property)="' + name + r'" content=")[^"]*', lambda m: m[1] + e(value, quote=True), shell, count=1)
    shell = re.sub(r'(<link rel="canonical" href=")[^"]*', lambda m: m[1] + url, shell, count=1)
    metadata = {'@context': 'https://schema.org', '@type': 'Article', 'headline': data['title'], 'description': data['summary'], 'url': url, 'inLanguage': 'ko', 'datePublished': date, 'dateModified': date, 'author': {'@type': 'Organization', 'name': '외·모Check'}}
    shell = re.sub(r'<script type="application/ld\+json">.*?</script>', lambda m: '<script type="application/ld+json">' + json.dumps(metadata, ensure_ascii=False).replace('<', '\\u003c') + '</script>', shell, count=1, flags=re.S)
    article = '<article><p><a href="/guides">실무 가이드</a> / ' + e(data['category']) + '</p><h1>' + e(data['title']) + '</h1><p class="meta">외·모Check · ' + date + ' 발행 · AI 보조 자동 작성 · <a href="/editorial">작성 원칙</a></p><div class="note">예시 숫자와 매장은 설명용 가정입니다. 실제 취재 또는 검증된 성과가 아닙니다. 이 글은 AI 보조 자동 작성 자료이며 전문가 검수를 거친 지침이 아닙니다.</div><p class="lead">' + e(data['summary']) + '</p>'
    for section in data['sections']:
        article += '<h2>' + e(section['heading']) + '</h2>' + ''.join('<p>' + e(p) + '</p>' for p in section['paragraphs'])
    article += '<section class="worksheet"><h2>내 매장 기록지</h2><ol>' + ''.join('<li>' + e(q) + ' <p>기록: ______________________________</p></li>' for q in data['worksheet']) + '</ol></section><button class="print-guide" type="button" onclick="window.print()">기록지 인쇄</button><h2>작성 범위와 한계</h2><p>' + e(data['scope']) + '</p><p><a href="/inquiry">내용 문의 및 주제 제안</a> · <a href="/guides">다른 실무 가이드</a></p></article>'
    shell = re.sub(r'(<main\b[^>]*>).*?(</main>)', lambda m: m[1] + article + m[2], shell, count=1, flags=re.S)
    hub_path = root / 'guides.html'
    hub = hub_path.read_text()
    card = '<article class="guide-tile"><small>' + date + ' · ' + e(data['category']) + '</small><h3>' + e(data['title']) + '</h3><p>' + e(data['summary']) + '</p><a href="' + route + '">가이드 읽기 →</a></article>'
    if '<div class="guide-grid">' not in hub:
        raise ValueError('Guide listing marker missing')
    hub = hub.replace('<div class="guide-grid">', '<div class="guide-grid">' + card, 1)
    sitemap_path = root / 'sitemap.xml'
    sitemap = sitemap_path.read_text()
    if '</urlset>' not in sitemap:
        raise ValueError('Sitemap marker missing')
    sitemap = sitemap.replace('</urlset>', '  <url><loc>' + url + '</loc><lastmod>' + date + '</lastmod></url>\n</urlset>')
    # Complete validation before writing anything. The workflow commits all three together.
    target.write_text(shell)
    hub_path.write_text(hub)
    sitemap_path.write_text(sitemap)
    return True


def main():
    now = datetime.now(KST)
    if (ROOT / 'guides' / (week_slug(now) + '.html')).exists():
        print('Already published this Korea-local week; no API call or changes.')
        return
    if os.environ.get('GITHUB_EVENT_NAME') == 'schedule' and now.weekday() != 0:
        raise RuntimeError('Scheduled run is not Monday in Korea; refusing stale publication.')
    data = generate(titles(ROOT))
    publish(ROOT, now, data)
    print('Published', week_slug(now))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print('::error::' + str(error), file=sys.stderr)
        sys.exit(1)
