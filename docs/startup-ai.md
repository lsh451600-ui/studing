# AI 창업 시뮬레이션

메뉴 > 창업의 모든것 > AI로 창업 미리해보기 (`/startup-ai`). 로그인한 회원이 이용합니다. 자본·업종·업태·지역·상권·메뉴를 입력하고 월 고정비와 변동비율을 수정하면 자본 배분, 손익분기점, 하루 필요 고객 수를 계산합니다. 금액 단위는 만원이며 실제 매물 및 상권 데이터는 조회하지 않습니다.

Cloudflare Pages 및 해당 Workers 배포 환경에 서버 비밀값 `OPENAI_API_KEY`를 설정하면 OpenAI Responses API로 SWOT, 자본 검토, 마케팅 3가지, 주요 위험과 대비책을 생성합니다. 선택 환경변수 `OPENAI_STARTUP_MODEL` 기본값은 `gpt-4.1-mini`입니다. 키는 브라우저에 전송하지 않으며 `store:false`, 구조화 응답, 45초 시간 제한, 계정별 시간당 5회 분석 제한을 적용합니다. 키 미설정·연결 실패 시 기본 계산만 제공하고 AI 분석이 없음을 명시합니다.

`GET /api/startup-simulations?status=1`은 키 설정 여부만 공개합니다. 일반 GET은 최근 10개 분석, `?id=...`는 본인 분석만 반환합니다. POST는 로그인과 동일 출처 검증 후 입력·결과를 D1 MEMBERS_DB의 전용 startup_simulations 테이블에 저장합니다. 다른 회원의 결과는 조회할 수 없습니다. PDF 저장은 브라우저 인쇄 기능을 사용합니다. 이메일 발송 기능은 없습니다.

검증: `node --test tests/startup-simulation.test.js`, `NODE_PATH=/tmp/login-browser-check/node_modules node tests/startup-ai-ui.cjs`.
