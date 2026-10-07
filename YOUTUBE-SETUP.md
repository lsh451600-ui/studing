# 외식 트렌드 인기 유튜브 영상

1. https://console.cloud.google.com/ 에서 프로젝트를 선택하거나 생성합니다.
2. API 및 서비스 → 라이브러리 → YouTube Data API v3 → 사용을 누릅니다.
3. API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키를 선택합니다.
4. 키 편집에서 API 제한사항 → 키 제한 → YouTube Data API v3를 선택하고 저장합니다. Cloudflare 서버에서 호출하므로 웹사이트(HTTP 리퍼러) 제한은 사용하지 않습니다.
5. Cloudflare → Workers 및 Pages → studing → 설정 → Variables and Secrets에서 추가합니다.
   - 유형: Secret(비밀)
   - 이름: YOUTUBE_API_KEY
   - 값: 발급받은 API 키
6. 저장 후 최신 배포에서 Retry deployment로 다시 배포합니다.

기존 MEMBERS_DB D1 바인딩을 공유 캐시에 사용합니다. 회원/레시피 테이블과 별도로 dining_video_cache 테이블이 자동 생성됩니다.
최근 30일의 ‘외식 트렌드|외식 산업|푸드 트렌드’ 검색 결과 최대 25개에서 공개·임베드 가능한 영상의 조회수를 확인하여 1개를 선정합니다.
유튜브 전체의 실시간 인기 순위가 아닌 관련 검색 결과 내 조회수 기준입니다. 조회가 있을 때 최대 30분 간격으로 갱신하며, 전 지역에 공유되는 D1 잠금으로 동시 API 호출을 제한합니다.
갱신 실패 시 최대 7일의 이전 결과와 지연 표시를 제공합니다. 첫 연결 전에는 유튜브 검색 링크를 제공합니다. API 키는 브라우저로 전달되지 않습니다.

공식 문서: https://developers.google.com/youtube/v3/getting-started
검색 기준: https://developers.google.com/youtube/v3/docs/search/list
