# 레시피 페이지 비밀번호 설정

1. Cloudflare → Workers & Pages → Pages 프로젝트 `studing` → Settings → Variables and Secrets.
2. Production 환경에 **Secret** 유형으로 `RECIPE_PASSWORD`를 추가합니다. 실제 사용할 비밀번호를 값으로 입력합니다.
3. 저장 후 Deployments에서 최신 배포를 다시 배포합니다. Preview에는 필요할 때만 별도의 테스트 비밀번호를 설정합니다.
4. `/recipes`에서 잘못된 비밀번호가 거부되는지, 설정한 비밀번호로 열리는지 확인합니다.

실제 비밀번호는 저장소, HTML, JavaScript 파일에 포함하지 않습니다. 서버 설정이 없으면 페이지를 열어주지 않습니다. 비밀번호는 URL, 쿠키, 로컬 저장소에 저장하지 않으며 새로고침·페이지 이탈 후 다시 입력해야 합니다.

실제 레시피는 아직 등록하지 않았습니다. 보호된 콘텐츠는 `functions/api/recipes.js`의 비밀번호 검증 이후 반환하며 공개 정적 HTML에 추가하지 않습니다.

기존 회원가입용 `MEMBERS_DB`가 연결되면 IP별 15분당 10회 요청 제한도 사용합니다. 데이터베이스가 연결되지 않았다면 Cloudflare에서 `/api/recipes`에 요청 제한 규칙을 설정할 수 있습니다.
