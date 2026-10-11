import importlib.util
import json
import tempfile
import io
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update_news', Path(__file__).resolve().parents[1] / 'scripts/update_news.py')
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)
def source_links(articles):
    for article in articles:
        for key in list(article):
            if key.startswith('image'): article.pop(key)
        article['original_url'] = 'https://publisher.test/article/' + article['url'].rsplit('/', 1)[-1]

NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)

def feed(*stories):
    return '<rss><channel>' + ''.join(
        f'<item><title>{title} - 신문</title><link>https://news.google.com/rss/articles/{key}</link><source>신문</source><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate></item>'
        for key, title in stories) + '</channel></rss>'

class NewsDeduplication(unittest.TestCase):
    def test_one_new_article_does_not_shrink_six_cards_or_recycle_history(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers', side_effect=source_links):
            root = Path(folder)
            (root / 'src').mkdir()
            (root / 'index.html').write_text('<section id="trends"></section>')
            titles = ['외식 혼밥 소비 확산과 테이블 좌석 설계', '프랜차이즈 식재료 물가 상승 비용 부담', '음식점 배달 시장 성장에 포장재 선택 변화', '레스토랑 브랜드 산업 가성비 메뉴 전략', '외식 커피 시장 감소와 카페 디저트 변화', '식당 점심 소비 증가와 지역 상권 변화']
            news.update(feed(*[(str(i), title) for i, title in enumerate(titles)]), NOW)
            self.assertEqual(len(json.loads((root / 'news.json').read_text())['articles']), 6)
            xml = feed(('new', '음식점 예약 산업 증가와 온라인 서비스 확산'))
            news.update(xml, NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertEqual(len(result['articles']), 6)
            self.assertEqual(result['new_articles'], 1)
            self.assertEqual(len({a['url'] for a in result['articles']}), 6)
            self.assertEqual(len(result['history']), 7)

    def test_source_links_never_download_or_render_publisher_photos(self):
        article = {'title': '외식 메뉴 변화', 'source': '신문', 'url': 'https://news.google.com/rss/articles/a', 'original_url': 'https://publisher.test/article/123', 'published_at': NOW.isoformat(), 'image': 'https://publisher.test/photo.jpg'}
        with patch.object(news.urllib.request, 'urlopen') as fetch:
            news.resolve_publishers([article])
        fetch.assert_not_called()
        self.assertNotIn('image', article)
        rendered = news.render([article], NOW)
        self.assertIn('https://publisher.test/article/123', rendered)
        self.assertNotIn('<img', rendered)
        self.assertIsNone(news.source_url('javascript:alert(1)'))

    def test_same_url_and_republished_similar_title_are_excluded(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        history = [{'url': 'https://news.google.com/rss/articles/old', 'title': title}]
        articles = news.collect(feed(('old', title), ('syndicated', '[분석] ' + title + ' 전망'), ('new', '외식 식재료 물가 상승에 음식점 혼밥 메뉴 확산')), NOW, history)
        self.assertEqual([a['url'].rsplit('/', 1)[-1] for a in articles], ['new'])

    def test_duplicate_titles_from_different_links_only_appear_once(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        self.assertEqual(len(news.collect(feed(('a', title), ('b', '[뉴스] ' + title)), NOW)), 1)

    def test_next_run_keeps_display_and_history_when_no_unseen_story_exists(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers', side_effect=source_links):
            root = Path(folder)
            (root / 'src').mkdir()
            (root / 'index.html').write_text('<section id="trends"></section>')
            xml = feed(('a', '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'))
            news.update(xml, NOW)
            first = json.loads((root / 'news.json').read_text())
            news.update(xml, NOW)
            second = json.loads((root / 'news.json').read_text())
            self.assertEqual(second['articles'], first['articles'])
            self.assertEqual(second['new_articles'], 0)
            self.assertEqual(len(second['history']), 1)

    def test_new_article_without_photo_updates_source_list(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            root = Path(folder); (root / 'src').mkdir(); (root / 'index.html').write_text('<section id="trends"></section>')
            titles = ['외식 시장 소비 변화 ' + str(i) for i in range(6)]
            with patch.object(news, 'resolve_publishers', side_effect=source_links):
                news.update(feed(*[(str(i), title) for i, title in enumerate(titles)]), NOW)
            previous = json.loads((root / 'news.json').read_text())
            with patch.object(news, 'resolve_publishers'):
                news.update(feed(('missing', '외식 혼밥 산업 증가와 온라인 서비스 확산')), NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertEqual(len(result['articles']), 6)
            self.assertEqual(result['new_articles'], 1)
            self.assertTrue(any(a['url'].endswith('/missing') for a in result['articles']))
            self.assertEqual((root / 'index.html').read_text().count('<img'), 0)

    def test_news_collection_is_limited_to_the_last_seven_days(self):
        from datetime import timedelta
        xml = feed(('old', '외식 시장 소비 증가')).replace('Thu, 08 Oct 2026 10:00:00 GMT', (NOW - timedelta(days=8)).strftime('%a, %d %b %Y %H:%M:%S GMT'))
        with self.assertRaises(ValueError): news.collect(xml, NOW)
        self.assertIn('when%3A7d', news.FEED)

    def test_newer_remote_feed_does_not_drop_source_links_or_missing_cards(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            root = Path(folder); (root / 'src').mkdir(); (root / 'index.html').write_text('<section id="trends"></section>')
            xml = feed(*[(str(i), '외식 시장 소비 변화 ' + str(i)) for i in range(6)])
            with patch.object(news, 'resolve_publishers', side_effect=source_links): news.update(xml, NOW)
            previous = json.loads((root / 'news.json').read_text())
            remote = json.loads(json.dumps(previous)); remote['updated_at'] = '2026-10-08T12:01:00+00:00'; remote['articles'].pop()
            for article in remote['articles']: article.pop('image', None)
            remote_path = root / 'remote.json'; remote_path.write_text(json.dumps(remote))
            with patch.dict(news.os.environ, {'PREVIOUS_NEWS_PATH': str(remote_path)}), patch.object(news, 'resolve_publishers'):
                news.update(xml, NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertEqual(len(result['articles']), 6)
            self.assertTrue(all('image' not in a for a in result['articles']))

    def test_invalid_feed_preserves_existing_homepage(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers'):
            root = Path(folder); (root / 'src').mkdir()
            original = '<section class="guide-feature">Original guides</section><section id="trends">Previous cards</section>'
            (root / 'index.html').write_text(original)
            with self.assertRaises(ValueError):
                news.update(feed(), NOW)
            self.assertEqual((root / 'index.html').read_text(), original)
            self.assertFalse((root / 'news.json').exists())

if __name__ == '__main__':
    unittest.main()
