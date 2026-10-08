# 실무 가이드 주간 발행

`Publish weekly practical guide`가 매주 월요일 한국 시간 오전 9시(UTC 00:00)에 실행됩니다. GitHub 예약 실행은 지연될 수 있습니다. 공개 가이드 한 편을 작성하고 `/guides` 목록과 사이트맵에 추가하여 main에 푸시합니다. 기존 Cloudflare Pages Git 연결이 배포합니다. 수동 실행도 같은 한국 시간 ISO 주에는 한 편만 게시하며, 이미 게시했다면 API를 호출하지 않습니다.

## 필요한 설정

저장소 Settings → Secrets and variables → Actions → New repository secret에 `OPENAI_API_KEY`를 등록해야 합니다. 채팅이나 코드에 키를 넣지 마세요. API 사용 권한과 결제 설정이 필요합니다. 선택 사항인 Actions variable `OPENAI_GUIDE_MODEL`로 모델을 변경할 수 있습니다(기본 `gpt-4.1`). 키가 없거나 API가 실패하면 워크플로가 오류로 끝나며 빈 글을 게시하지 않습니다. Actions에서 이 워크플로의 Run workflow를 실행하면 실제 작성·게시 연결을 시험할 수 있습니다.

## 작성과 검증 범위

기존 제목을 전달해 다른 운영 질문을 고르고 사례, 실행 순서, 관찰 시험, 반례, 인쇄 기록지를 구성합니다. 결과는 구조화된 일반 텍스트이며 모든 값을 HTML 이스케이프합니다. 제목 유사도, 분량, 절 구성, 가상 예시 표시를 검사한 뒤 페이지·목록·사이트맵을 함께 커밋합니다. 외부 검색이나 전문가 검수 없이 작성되므로 시장 통계·법률·세무·식품 안전 기준·취재·성과 주장과 확인되지 않은 참고 URL을 생성하지 않도록 제한하고 페이지에도 AI 자동 작성과 적용 한계를 밝힙니다. 자동 구조 검증은 사실성이나 글의 품질을 보증하지 않습니다. 실패 시 기존 게시물은 유지됩니다.

API 구현은 [OpenAI 공식 Structured Outputs 문서](https://developers.openai.com/api/docs/guides/structured-outputs)를 따릅니다.
