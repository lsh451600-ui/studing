import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update_news', Path(__file__).resolve().parents[1] / 'scripts/update_news.py')
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)
NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)

def feed(*stories):
    return '<rss><channel>' + ''.join(
        f'<item><title>{title} - 신문</title><link>https://news.google.com/rss/articles/{key}</link><source>신문</source><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate></item>'
        for key, title in stories) + '</channel></rss>'

class NewsDeduplication(unittest.TestCase):
    def test_same_url_and_republished_similar_title_are_excluded(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        history = [{'url': 'https://news.google.com/rss/articles/old', 'title': title}]
        articles = news.collect(feed(('old', title), ('syndicated', '[분석] ' + title + ' 전망'), ('new', '외식 식재료 물가 상승에 음식점 혼밥 메뉴 확산')), NOW, history)
        self.assertEqual([a['url'].rsplit('/', 1)[-1] for a in articles], ['new'])

    def test_duplicate_titles_from_different_links_only_appear_once(self):
        title = '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'
        self.assertEqual(len(news.collect(feed(('a', title), ('b', '[뉴스] ' + title)), NOW)), 1)

    def test_next_run_keeps_display_and_history_when_no_unseen_story_exists(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers'):
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

    def test_retained_collection_strips_photos_and_preserves_original_guide_section(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(news, 'ROOT', Path(folder)), patch.object(news, 'resolve_publishers'):
            root = Path(folder)
            (root / 'src').mkdir()
            (root / 'index.html').write_text('<section class="guide-feature">Original guides</section><section id="trends"></section>')
            xml = feed(('a', '외식 시장 가성비 소비 증가로 프랜차이즈 산업 변화'))
            news.update(xml, NOW)
            previous = json.loads((root / 'news.json').read_text())
            previous['articles'][0].update(image='assets/news/old.jpg', image_source='https://publisher.test/photo.jpg', image_alt='Photo')
            (root / 'news.json').write_text(json.dumps(previous))
            news.update(xml, NOW)
            result = json.loads((root / 'news.json').read_text())
            self.assertNotIn('image', result['articles'][0])
            self.assertNotIn('image_source', result['articles'][0])
            self.assertNotIn('<img', (root / 'index.html').read_text())
            self.assertIn('Original guides', (root / 'index.html').read_text())

if __name__ == '__main__':
    unittest.main()
