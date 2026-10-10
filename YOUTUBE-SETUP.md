# 외식 트렌드 최신 유튜브 영상

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
최근 7일의 ‘외식 트렌드|외식 산업|푸드 트렌드’ 검색 결과 최대 50개에서 공개·임베드 가능한 영상 중 발행일이 가장 최신인 1개를 선정합니다. 동일 발행일에는 조회수로 정렬합니다.
영상 전용 GitHub Actions가 2시간마다(UTC 짝수 시각 17분) 캐시 갱신을 실행합니다. 기사 수집과 독립적으로 실행됩니다. GitHub 예약 작업은 혼잡 시 지연될 수 있습니다. 방문 시에도 해당 시간대의 수집본이 없으면 갱신하며, 전 지역에 공유되는 D1 잠금으로 동시 API 호출을 제한합니다.
갱신 실패 시 최대 7일의 이전 결과와 지연 표시를 제공합니다. 첫 연결 전에는 유튜브 검색 링크를 제공합니다. API 키는 브라우저로 전달되지 않습니다.

공식 문서: https://developers.google.com/youtube/v3/getting-started
검색 기준: https://developers.google.com/youtube/v3/docs/search/list

D1이 없거나 연결에 실패하면 Cloudflare 지역별 캐시로 영상 조회를 계속합니다. 이 경우 조회 결과는 다음 2시간 갱신 구간까지, 실패 사유는 5분 캐시됩니다. 전 지역의 API 사용량을 함께 제한하려면 MEMBERS_DB를 연결합니다.

오류 안내:
- YT-01: Production 환경에 YOUTUBE_API_KEY 등록 후 재배포.
- YT-02: API 키 값이 잘못됨. 앞뒤 공백을 제외한 실제 키인지 확인.
- YT-03: 해당 키가 속한 구글 프로젝트에서 YouTube Data API v3 활성화.
- YT-04: 키의 애플리케이션 제한사항을 없음으로, API 제한사항을 YouTube Data API v3로 설정. 서버 호출이므로 HTTP 리퍼러 제한은 사용하지 않음.
- YT-05: 일일 API 할당량 확인.
- YT-06: 구글에서 요청 거부. 활성화와 키 제한 설정 확인.
- YT-07/08: 유튜브 연결 시간 초과/연결 실패.
- YT-09: 최근 7일 조건에 맞는 공개 영상 없음.
- YT-10: Cloudflare 캐시 연결 실패.
- YT-11: 구글에서 기타 오류 응답 반환.

/api/trend-video는 키나 구글 원문 오류를 노출하지 않고 고정된 reason 값만 제공합니다.

통신 처리 보완:
- Google 공식 클라이언트의 youtube.googleapis.com을 먼저 사용하며, 연결 실패 시 www.googleapis.com의 동일 API로 한 번 전환합니다.
- 이동 응답의 Location은 따라가지 않습니다. 허용한 두 Google 주소로만 요청합니다.
- YT-12: 유튜브 JSON 응답 형식 오류.
- YT-13: 두 공식 API 주소에서 예상하지 못한 이동 응답.
- YT-14: 영상 처리 중 내부 오류. 실제 연결 실패(YT-08)와 구분합니다.
- Cloudflare 함수 로그의 youtube_transport_failed는 stage, host, type, 허용된 네트워크 code만 기록합니다. API 키·요청 URL·원문 예외 메시지는 기록하지 않습니다.

외식업 트렌드, 외식 창업, 식당 창업, 프랜차이즈 동향, 외식업 경기까지 검색어를 확장합니다. 영상 길이 제한 없이 최신 발행순으로 선정합니다. 새 조건은 v8 캐시부터 적용됩니다.
