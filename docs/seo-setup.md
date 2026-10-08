# dining.win 검색 최적화 및 등록

Google SEO 기본 가이드와 네이버 검색엔진 최적화 가이드를 기준으로 대표 URL을 `https://dining.win`으로 설정했습니다. 공개 페이지의 canonical·Open Graph·구조화 데이터, robots.txt의 사이트맵 주소, 사이트맵의 공개 URL 및 주간 가이드 발행 주소가 같은 도메인을 사용합니다. 회원 자료·개인정보 관리·비밀번호 복구·오류 페이지는 검색 대상에 넣지 않습니다.

## Google Search Console

1. `dining.win` 도메인 속성을 추가하고 제시된 DNS TXT로 소유를 확인하거나, `https://dining.win/` URL 접두어 속성의 HTML 태그 방법으로 소유를 확인합니다.
2. HTML 태그 방식이면 실제 발급된 `google-site-verification` 태그를 홈페이지 head에 추가합니다. 임의의 인증값을 작성하지 않습니다.
3. 사이트맵 `https://dining.win/sitemap.xml`을 제출합니다.
4. 홈과 공개 가이드의 URL 검사에서 실제 크롤링된 HTML, 사용자 선언 표준 URL과 Google 선택 표준 URL을 확인합니다.

## 네이버 서치어드바이저

1. 사이트 `https://dining.win`을 등록합니다.
2. 실제 발급된 `naver-site-verification` 메타 태그 또는 원본 HTML 파일로 소유를 확인합니다.
3. 요청 → 사이트맵 제출에 `https://dining.win/sitemap.xml`을 제출합니다.
4. 요청 → RSS 제출에 `https://dining.win/feed.xml`을 제출합니다.
5. robots.txt 검증과 웹 페이지 수집 요청 후 수집/색인 상태를 확인합니다.

RSS에는 자체 가이드의 본문과 발행일·고유 주소를 넣습니다. 외부 기사를 자체 작성한 글처럼 넣지 않습니다. `python scripts/build_feed.py`로 재생성하며 주간 발행 자동화도 같은 코드를 사용합니다. 메타데이터/발행 검사: `node --test tests/seo.test.js tests/journal.test.js`, `python -m unittest discover -s tests -p test_weekly_guide.py`.

## 관리자가 별도로 적용해야 하는 항목

현재 연결에는 Search Console·서치어드바이저·Google/Kakao/Supabase 콘솔의 관리 권한이 없습니다. 외부 소유 확인·사이트맵 제출·로그인 도메인 등록은 코드 배포로 완료되지 않습니다. `supabase/config.toml`은 저장소의 설정 기록이며 호스팅된 Supabase에 자동 적용되지 않습니다.

- Kakao REST API 키의 로그인 리다이렉트 URI: `https://dining.win/api/kakao-callback`
- Google OAuth JavaScript 원본: `https://dining.win`
- Google OAuth 반환 주소: `https://wwqdmhjmfdndwxyfajfq.supabase.co/auth/v1/callback`
- Supabase Site URL: `https://dining.win`
- Supabase Redirect URLs: `https://dining.win/api/oauth-callback**`, `https://dining.win/api/auth-confirm`, `https://dining.win/reset-password`

현재 `www.dining.win`은 접근이 확인되지 않아 대표 주소나 사이트맵에 넣지 않습니다. 향후 연결하면 대표 주소인 `https://dining.win`으로 HTTP 리디렉션을 설정합니다. 이전 Pages 도메인도 같은 공개 페이지의 canonical로 새 주소를 알립니다. 이전 도메인에서 진행 중인 로그인·이메일 복구의 코드와 쿠키는 호스트에 묶이므로, 전체 주소를 무조건 이동시키기 전 외부 인증 설정과 이전 세션 영향을 확인해야 합니다.

검색 반영과 순위는 검색엔진이 결정합니다. 구조 검사는 콘텐츠의 전문성·사실성이나 검색 상위 노출을 보증하지 않습니다. 실제 매장 경험과 검증 가능한 근거를 갖춘 콘텐츠를 지속적으로 보완하고 수집/색인/검색어 실적을 관찰합니다.

참고: [Google SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=ko), [네이버 검색엔진 최적화의 목적](https://searchadvisor.naver.com/guide/seo-basic-intro).
