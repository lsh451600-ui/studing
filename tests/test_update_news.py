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
def cached_photos(articles):
    folder = news.ROOT / 'assets/news'; folder.mkdir(parents=True, exist_ok=True)
    for article in articles:
        name = news.hashlib.sha256(article['url'].encode()).hexdigest()[:24] + '.jpg'
        (folder / name).write_bytes(b'\xff\xd8\xff' + b'x' * 128)
        article.update(image='/assets/news/' + name, image_source='https://publisher.test/article', image_alt=article['title'])

NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)

def feed(*stories):
    return '<rss><channel>' + ''.join(
        f'<item><title>{title} - 신문</title><link>https://news.google.com/rss/articles/{key}</link><source>신문</source><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate></item>'
        for key, title in stories) + '</channel></rss>'

class NewsDeduplication(unittest.TestCase):
    def test_one_new_article_does_not_shrink_six_cards_or_recycle_history(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers', side_effect=cached_photos):
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

    def test_publisher_photo_is_downloaded_with_credit_and_validated(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            response = io.BytesIO(b'<meta property="og:image" content="/photos/menu.jpg">')
            response.url = 'https://publisher.test/article/123'
            photo = io.BytesIO(b'\xff\xd8\xff' + b'x' * 256)
            article = {'title': '외식 메뉴 변화', 'source': '신문', 'url': 'https://news.google.com/rss/articles/a', 'original_url': response.url, 'published_at': NOW.isoformat()}
            with patch.object(news.urllib.request, 'urlopen', side_effect=[response, photo]) as fetch:
                news.resolve_publishers([article])
            self.assertEqual(fetch.call_count, 2)
            self.assertTrue(news.local_photo(article['image']))
            self.assertTrue((Path(folder) / article['image'].lstrip('/')).is_file())
            self.assertEqual(article['image_original'], 'https://publisher.test/photos/menu.jpg')
            self.assertIn('사진 출처: 신문', news.render([article], NOW))
            self.assertIsNone(news.photo_url('javascript:alert(1)'))
            self.assertFalse(news.local_photo('/assets/news/../../secret.jpg'))
            with self.assertRaises(ValueError): news.image_extension(b'<html>not a photo</html>')

    def test_missing_or_broken_metadata_falls_back_to_same_article_body_photo(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            response = io.BytesIO(b'<meta property="og:image" content="/broken.jpg"><img src="/banner.jpg"><article><figure><img data-src="/actual.jpg"></figure></article>')
            response.url = 'https://publisher.test/article/123'
            article = {'title': '외식 변화', 'source': '신문', 'url': 'https://news.google.com/rss/articles/a', 'original_url': response.url}
            with patch.object(news.urllib.request, 'urlopen', side_effect=[response, io.BytesIO(b'not image'), io.BytesIO(b'\xff\xd8\xff' + b'x' * 256)]) as fetch:
                news.resolve_publishers([article])
            self.assertEqual(fetch.call_count, 3)
            self.assertTrue(news.local_photo(article['image']))
            self.assertEqual(article['image_original'], 'https://publisher.test/actual.jpg')

    def test_same_url_and_republished_similar_title_are_excluded(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        history = [{'url': 'https://news.google.com/rss/articles/old', 'title': title}]
        articles = news.collect(feed(('old', title), ('syndicated', '[분석] ' + title + ' 전망'), ('new', '외식 식재료 물가 상승에 음식점 혼밥 메뉴 확산')), NOW, history)
        self.assertEqual([a['url'].rsplit('/', 1)[-1] for a in articles], ['new'])

    def test_duplicate_titles_from_different_links_only_appear_once(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        self.assertEqual(len(news.collect(feed(('a', title), ('b', '[뉴스] ' + title)), NOW)), 1)

    def test_next_run_keeps_display_and_history_when_no_unseen_story_exists(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers', side_effect=cached_photos):
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

    def test_new_article_without_photo_does_not_replace_six_cached_articles(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            root = Path(folder); (root / 'src').mkdir(); (root / 'index.html').write_text('<section id="trends"></section>')
            titles = ['외식 시장 소비 변화 ' + str(i) for i in range(6)]
            with patch.object(news, 'resolve_publishers', side_effect=cached_photos):
                news.update(feed(*[(str(i), title) for i, title in enumerate(titles)]), NOW)
            previous = json.loads((root / 'news.json').read_text())
            with patch.object(news, 'resolve_publishers'):
                news.update(feed(('missing', '외식 혼밥 산업 증가와 온라인 서비스 확산')), NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertEqual(result['articles'], previous['articles'])
            self.assertEqual(result['new_articles'], 0)
            self.assertEqual((root / 'index.html').read_text().count('<img'), 6)

    def test_news_collection_is_limited_to_the_last_seven_days(self):
        from datetime import timedelta
        xml = feed(('old', '외식 시장 소비 증가')).replace('Thu, 08 Oct 2026 10:00:00 GMT', (NOW - timedelta(days=8)).strftime('%a, %d %b %Y %H:%M:%S GMT'))
        with self.assertRaises(ValueError): news.collect(xml, NOW)
        self.assertIn('when%3A7d', news.FEED)

    def test_newer_remote_feed_does_not_drop_cached_photos_or_missing_cards(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)):
            root = Path(folder); (root / 'src').mkdir(); (root / 'index.html').write_text('<section id="trends"></section>')
            xml = feed(*[(str(i), '외식 시장 소비 변화 ' + str(i)) for i in range(6)])
            with patch.object(news, 'resolve_publishers', side_effect=cached_photos): news.update(xml, NOW)
            previous = json.loads((root / 'news.json').read_text())
            remote = json.loads(json.dumps(previous)); remote['updated_at'] = '2026-10-08T12:01:00+00:00'; remote['articles'].pop()
            for article in remote['articles']: article.pop('image', None)
            remote_path = root / 'remote.json'; remote_path.write_text(json.dumps(remote))
            with patch.dict(news.os.environ, {'PREVIOUS_NEWS_PATH': str(remote_path)}), patch.object(news, 'resolve_publishers'):
                news.update(xml, NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertEqual(len(result['articles']), 6)
            self.assertTrue(all(news.local_photo(a['image']) for a in result['articles']))

    def test_no_verified_photo_preserves_existing_homepage(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers'):
            root = Path(folder); (root / 'src').mkdir()
            original = '<section class="guide-feature">Original guides</section><section id="trends">Previous cards</section>'
            (root / 'index.html').write_text(original)
            with self.assertRaises(ValueError):
                news.update(feed(('a', '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화')), NOW)
            self.assertEqual((root / 'index.html').read_text(), original)
            self.assertFalse((root / 'news.json').exists())

if __name__ == '__main__':
    unittest.main()
