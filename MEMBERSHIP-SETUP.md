# 회원가입 서버 연결

회원가입 화면과 `/api/register` Cloudflare Pages Function을 포함합니다.
운영 데이터베이스가 연결되기 전에는 가입 버튼을 비활성화하고 가입 완료 메시지를 표시하지 않습니다.

1. Cloudflare 대시보드 → Storage & databases → D1 → Create database에서 `studing-members`를 생성합니다.
2. Workers & Pages → **Pages 프로젝트 studing** → Settings → Bindings에서 D1을 추가합니다.
3. 변수 이름을 **MEMBERS_DB**로 입력하고 생성한 데이터베이스를 선택합니다. Production 환경에 적용합니다.
4. Deployments에서 최신 배포를 다시 배포합니다. Preview 환경은 별도의 테스트 데이터베이스를 사용합니다.
5. `/api/register`를 GET으로 요청했을 때 `available: true`인지 확인한 뒤 홈페이지에서 테스트 계정을 가입합니다.
6. D1 콘솔에서 `SELECT id, username, created_at FROM members;`로 저장을 확인합니다. 테스트 후 테스트 계정을 삭제합니다.

회원 및 가입 요청 제한 테이블은 첫 유효 가입 요청에서 자동 생성됩니다. 데이터베이스 자체의 생성과 바인딩은 Cloudflare 관리자 설정이 필요합니다.

비밀번호는 무작위 salt와 PBKDF2-SHA256 해시로만 저장합니다. 전화번호·이메일은 D1에 저장하며 Git, 브라우저 로컬 저장소, 로그에 기록하지 않습니다. 아이디와 이메일 중복을 데이터베이스 제약 조건으로 차단하고 동일 IP에서 15분 동안 가입 요청을 5회로 제한합니다. 관리자용 회원 조회 API는 제공하지 않습니다.

현재 범위는 **회원가입**입니다. 로그인, 이메일/전화번호 본인인증, 비밀번호 재설정은 포함하지 않습니다.

서버 검증: Node.js 24에서 `node --test tests/signup.test.js`
