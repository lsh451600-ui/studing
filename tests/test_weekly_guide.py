import importlib.util
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('weekly', 'scripts/publish_weekly_guide.py')
weekly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(weekly)


def example():
    paragraph = '예시 매장은 점심 포장을 운영하는 가상의 작은 식당입니다. 주문 접수 시간과 포장 완료 시간을 구분해서 익명으로 기록하고, 바쁜 시간과 한가한 시간의 결과를 각각 비교합니다. 손님 이름과 연락처는 모으지 않습니다. 한 가지 변화만 시험하고 대기나 오류가 늘면 원래 방식으로 돌아가 원인을 기록합니다. '
    return {'title': '포장 수령 안내를 바꾸는 작은 시험', 'summary': '접수와 수령 사이의 불편을 구분해 기록하는 운영 실험입니다.', 'category': '포장 경험', 'scope': '관찰을 위한 가상 예시이며 검증된 성과가 아닙니다.', 'sections': [{'heading': f'{n+1}. 관찰 단계', 'paragraphs': [paragraph, paragraph]} for n in range(6)], 'worksheet': ['오늘 관찰할 조건과 중단 기준을 적어 보세요.'] * 5}


class WeeklyGuideTests(unittest.TestCase):
    def test_korean_week_boundary_and_iso_year(self):
        self.assertEqual(weekly.week_slug(datetime(2026, 10, 11, 14, 59, tzinfo=timezone.utc)), 'weekly-2026-41')
        self.assertEqual(weekly.week_slug(datetime(2026, 10, 11, 15, 0, tzinfo=timezone.utc)), 'weekly-2026-42')
        self.assertEqual(weekly.week_slug(datetime(2027, 1, 1, tzinfo=timezone.utc)), 'weekly-2026-53')

    def test_rejects_duplicate_thin_or_html_content(self):
        data = example()
        with self.assertRaises(ValueError): weekly.validate(data, [data['title']])
        data['sections'][0]['paragraphs'][0] = '<script>alert(1)</script>'
        with self.assertRaises(ValueError): weekly.validate(data, [])
        data = example(); data['sections'] = data['sections'][:2]
        with self.assertRaises(ValueError): weekly.validate(data, [])

    def test_publish_once_preserves_shell_and_updates_listing_sitemap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'guides').mkdir()
            for file in ['guides/menu-complexity.html', 'guides.html', 'sitemap.xml']:
                (root / file).write_text((weekly.ROOT / file).read_text())
            now = datetime(2026, 10, 12, 0, tzinfo=timezone.utc)
            self.assertTrue(weekly.publish(root, now, example()))
            path = root / 'guides/weekly-2026-42.html'
            content = path.read_text()
            self.assertIn('<h1>포장 수령 안내를 바꾸는 작은 시험</h1>', content)
            self.assertIn('https://studing.pages.dev/guides/weekly-2026-42', content)
            self.assertEqual(content.count('gtag/js?id=G-QMRKZWCG2X'), 1)
            self.assertEqual(content.count('yuj1decb23'), 1)
            self.assertIn('id="startup-toggle"', content)
            self.assertIn('id="back-to-top"', content)
            self.assertNotIn('메뉴를 줄이기 전에: 재료와 조리 병목 지도', content)
            for file in ['guides.html', 'sitemap.xml']:
                self.assertEqual((root / file).read_text().count('/guides/weekly-2026-42'), 1)
            self.assertFalse(weekly.publish(root, now, example()))
            self.assertEqual(path.read_text(), content)

    def test_missing_key_fails_without_writing(self):
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'OPENAI_API_KEY'):
                weekly.generate([])

if __name__ == '__main__':
    unittest.main()
