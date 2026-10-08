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

대표 주소는 `https://dining.win`입니다. 이전 Pages 도메인과 `www.dining.win`에서 공개 페이지를 요청하면 새 도메인으로 301 이동하고, `index.html`·공개 `.html` 별칭 및 후행 슬래시도 대표 경로로 정리합니다. 다만 현재 `www.dining.win`은 DNS에서 찾을 수 없으므로 Cloudflare DNS에 `www` 호스트를 먼저 연결해야 방문자가 리디렉션에 도달할 수 있습니다. 구 도메인에서 진행 중인 OAuth 콜백은 PKCE 쿠키를 보존하도록 예외 처리합니다.

Google Fonts 원격 `@import`를 제거해 첫 렌더링을 막던 글꼴 요청을 없애고 시스템 글꼴을 사용합니다. 대형 PNG 로고는 WebP 파생 이미지로 교체했으며 파비콘을 필요한 크기로 줄였습니다. 뉴스 사진은 원 출처의 저작물 URL을 사용하므로 원본 포맷·파일 크기를 이 저장소에서 바꿀 수 없습니다. 사진 표시에는 고정 비율과 `object-fit: cover`를 적용하고 지연 로딩을 유지합니다. 이미지의 제작 메타데이터는 기존 원본에서도 파일 크기의 16% 미만이었습니다.

HTTPS Strict-Transport-Security 헤더는 1년 유효기간으로 설정했습니다. SPF는 DNS와 발신 이메일 제공업체에 맞는 TXT 값이 필요합니다. 현재 도메인에 SPF/MX 레코드가 없고 이 사이트는 자체 도메인 발신 메일을 구성하지 않았으므로 임의의 SPF 값을 게시하지 않습니다. 메일 발신을 설정할 때 제공업체가 지정한 SPF 값을 DNS에 등록하세요.

AI 검색 및 GEO 관련 외부 글은 사용자에게 유용한 원본 콘텐츠, 구체적인 상황을 반영한 질문·답변, 읽기 쉬운 구조, 시각 자료, 사실에 맞는 최신 정보를 강조합니다. 이를 반영해 각 실무 가이드에 실제 계산과 관찰 절차에 근거한 질문·답변을 추가했습니다. 후기·외부 추천·브랜드 언급은 실제 이용자와 독립된 출처에서 생겨야 하며 사이트가 임의로 만들지 않습니다. structured data도 화면에 보이는 내용과 일치시키고, GEO 적용이 노출이나 추천을 보장한다고 설명하지 않습니다. Google은 별도의 AI 검색 최적화 기술 요건보다 기본 검색 크롤링·색인 요건과 사람 중심의 독창적인 콘텐츠, 페이지 경험, 표시 콘텐츠와 구조화 데이터의 일치를 강조합니다.

검색 반영과 순위는 검색엔진이 결정합니다. 구조 검사는 콘텐츠의 전문성·사실성이나 검색 상위 노출을 보증하지 않습니다. 실제 매장 경험과 검증 가능한 근거를 갖춘 콘텐츠를 지속적으로 보완하고 수집/색인/검색어 실적을 관찰합니다.

참고: [Google AI 검색 콘텐츠 안내](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search), [토스페이먼츠 GEO 이커머스 글](https://www.tosspayments.com/blog/articles/39461), [Google SEO 기본 가이드](https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=ko), [네이버 검색엔진 최적화의 목적](https://searchadvisor.naver.com/guide/seo-basic-intro).
