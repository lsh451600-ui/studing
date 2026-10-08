# 구글·카카오 로그인 활성화

홈페이지 코드에는 구글·카카오 로그인 버튼, 서버 PKCE 코드 교환, HttpOnly 로그인 쿠키, 첫 소셜 로그인 회원의 아이디·전화번호 입력이 구현되어 있습니다. 제공자 연결이 완료되기 전에는 해당 버튼이 ‘연결 준비 중’으로 표시됩니다. Cloudflare의 기존 SUPABASE_* 환경 변수 3개는 유지하세요. Google/Kakao 앱 Secret을 GitHub나 채팅에 올리지 않습니다.

## 1. 추가 SQL 적용

Supabase SQL Editor에서 `supabase/migrations/20261007100000_social_members.sql` 전체를 실행하세요. 기존 회원 SQL을 다시 실행할 필요는 없습니다. 이 SQL은 기존 이메일 회원과 비밀번호 가입을 유지하고, 구글·카카오 신규 계정은 첫 로그인 후 본인 프로필을 생성하도록 변경합니다.

이 SQL 적용 전에 구글·카카오 로그인을 활성화하면 기존 프로필 생성 트리거 때문에 신규 소셜 가입이 실패합니다. 기존 회원 데이터는 삭제하지 않습니다.

## 2. Supabase URL 설정

Authentication → URL Configuration:

Site URL:
```
https://studing.pages.dev
```

Redirect URLs에 다음을 추가하세요. 끝의 `**`도 포함합니다. 서버가 생성한 일회용 flow 값이 쿼리에 붙기 때문입니다.
```
https://studing.pages.dev/api/oauth-callback**
```

이 주소는 홈페이지에서 인증 결과를 처리하는 주소입니다. 아래의 Google/Kakao에 넣는 Supabase 콜백 주소와 다릅니다.

## 3. 구글 연결

1. Google Cloud Console 또는 Google Auth Platform에서 프로젝트를 선택하고 OAuth 동의 화면의 앱 이름·지원 이메일·대상 사용자를 설정합니다.
2. OAuth 클라이언트를 Web application 유형으로 생성합니다.
3. Authorized JavaScript origins에 `https://studing.pages.dev`를 넣습니다.
4. Authorized redirect URIs에 다음 주소를 등록합니다.
```
https://wwqdmhjmfdndwxyfajfq.supabase.co/auth/v1/callback
```
5. Supabase Authentication → Sign In / Providers → Google에서 Google 로그인을 켜고 Google의 Client ID와 Client Secret을 넣어 저장합니다.
6. 테스트 모드라면 Google 설정에 테스트 사용자 이메일을 등록합니다. 일반 방문자에게 제공할 때는 앱 게시 및 Google이 요구하는 검증을 완료합니다.

공식 안내: https://supabase.com/docs/guides/auth/social-login/auth-google

## 4. 카카오 연결

카카오 이메일 제공 권한이 없어도 로그인하도록 OpenID Connect 방식으로 변경했습니다.
**[이메일 권한 없는 카카오 로그인 설정](KAKAO-NOEMAIL-SETUP.md)**을 따라주세요.
카카오 OpenID Connect ON, 홈페이지 콜백 URI 추가, Cloudflare 카카오 환경 변수 2개, Supabase 이메일 없는 로그인 허용이 필요합니다.
기존 Supabase 콜백 방식의 카카오 이메일 동의 설정 대신 새 안내를 사용합니다.

## 5. 실제 확인

홈페이지를 새로고침한 뒤 로그인 창을 열면 Supabase 제공자 설정을 조회해 연결된 버튼만 활성화합니다. 구글은 제공자 설정을 저장하면 활성화됩니다. 카카오는 새 안내의 Cloudflare 환경 변수를 저장한 후 재배포해야 합니다.

구글·카카오 각각: 로그인 버튼 → 계정 선택 및 동의 → 첫 방문이면 아이디·전화번호 입력 → 가입 완료 → 새로고침 → 로그아웃 → 재로그인을 확인하세요. 기존 이메일 회원의 로그인도 확인하세요. 레시피 작성 권한은 기존 별도 관리자 인증을 계속 사용합니다.

자동 테스트는 제공자 API 응답을 모의해 PKCE 흐름, 잘못된 콜백 거부, 쿠키, 회원 본인 프로필 생성 요청을 검증합니다. 실제 제공자 계정의 동의 및 프로젝트 SQL 실행은 연결 후 별도로 확인해야 합니다.

## 오류 확인

`/api/oauth?diagnostics=1`은 제공자 활성화와 프로필 완료 함수 존재 여부를 확인합니다. `profileSetup: "required"`는 `complete_member_profile` RPC가 없어 위 소셜 회원 SQL 적용이 필요하다는 뜻입니다. 조회에는 사용자 토큰·아이디를 전달하지 않으며 계정이나 프로필을 생성하지 않습니다. `ready`는 함수 존재 확인이며 Google/Kakao 콘솔 설정이나 실제 계정의 인증 성공까지 보장하지 않습니다.

Google 오류 `GOOGLE-01`은 신규 회원 DB 저장, `GOOGLE-02`는 PKCE 코드 교환, `GOOGLE-03`은 제공자 인증 문제를 구분합니다. Kakao 오류는 기존 `KAKAO-*` 및 `KOE*` 분류를 사용합니다. 진단 시 화면의 오류 코드만 공유하고 인증 코드·쿠키·토큰은 공유하지 않습니다.

Supabase가 인증 결과를 Site URL의 루트로 반환해도 홈의 첫 스크립트가 인증 코드를 URL에서 지우고 서버 콜백으로 넘깁니다. 서버는 HttpOnly 쿠키의 PKCE verifier로 교환하고 사용자 API를 검증한 뒤 로그인 쿠키를 설정합니다. 올바른 Redirect URLs 설정은 계속 유지해야 합니다. 첫 가입의 프로필 입력을 완료하기 전에는 회원 자료 페이지로 이동하지 않습니다.
