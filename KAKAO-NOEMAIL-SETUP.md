# 이메일 권한 없는 카카오 로그인 설정

## 변경 내용

카카오 로그인은 이제 Supabase의 기본 OAuth 리다이렉트를 사용하지 않습니다. 서버가 카카오에 `scope=openid`만 요청하고, 서버에서 인가 코드를 교환한 다음 Supabase의 `grant_type=id_token`으로 로그인합니다. 카카오 이메일·닉네임·프로필 사진 권한을 요청하지 않습니다. 카카오 OIDC 토큰의 서명·발급자·수신 대상·nonce는 Supabase가 검증합니다. 홈페이지는 검증된 Supabase 세션을 HttpOnly 쿠키로 유지합니다.

기존 구글 로그인, 비밀번호 로그인, 레시피 관리자 인증은 기존 방식을 사용합니다. 첫 소셜 회원은 아이디·전화번호를 직접 입력합니다. 이메일이 없는 카카오 계정은 기존 이메일 계정과 자동으로 합쳐지지 않을 수 있습니다.

## 1. 카카오 OpenID Connect 활성화

카카오 Developers → 해당 앱 → 카카오 로그인 → OpenID Connect에서 활성화 상태를 ON으로 설정합니다. 기존 카카오 로그인 사용 설정도 ON으로 유지합니다. 이메일 동의항목은 설정하지 않아도 됩니다.

## 2. 카카오 리다이렉트 URI 추가

카카오 Developers → 앱 → 플랫폼 키 → 사용 중인 REST API 키 → 카카오 로그인 리다이렉트 URI에 다음 주소를 **추가**하고 저장합니다.

```text
https://dining.win/api/kakao-callback
```

이전 Supabase 콜백 주소를 직접 열지 않습니다. 새 로그인은 위 홈페이지 콜백 주소로 돌아옵니다. 기존 URI는 남겨도 됩니다.

## 3. Cloudflare Pages 환경 변수 2개 추가

Workers & Pages → Pages 프로젝트 `studing` → Settings → Variables and Secrets → Production에 추가합니다.

| 이름 | 값 | 유형 |
| --- | --- | --- |
| KAKAO_REST_API_KEY | 카카오 앱의 REST API 키 | Text |
| KAKAO_CLIENT_SECRET | 해당 REST API 키의 활성화된 카카오 로그인 Client Secret | Secret |

Supabase의 Kakao Client ID와 Cloudflare KAKAO_REST_API_KEY에는 **동일한 카카오 앱의 REST API 키**를 사용합니다. 다른 타입의 키나 다른 앱의 키를 혼용하지 않습니다. 실제 키를 GitHub나 채팅에 올리지 않습니다.

기존 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY는 유지합니다. 환경 변수 저장 후 Pages를 재배포해야 서버에 반영됩니다. 카카오 환경 변수 2개가 없으면 홈페이지의 카카오 버튼은 연결 준비 중으로 표시됩니다.

## 4. Supabase에서 이메일 없는 로그인 허용

Authentication → Sign In / Providers → Kakao:

- Enable Sign in with Kakao: ON
- Client ID: 같은 카카오 REST API 키
- Client Secret: 같은 카카오 로그인 Client Secret
- Allow users without an email: ON
- nonce 검증을 건너뛰는 옵션이 있다면 비활성화 상태를 유지합니다.

Save를 누릅니다. 기존 소셜 회원 SQL (`20261007100000_social_members.sql`)이 적용되어 있어야 합니다. 이번 변경에 추가 SQL은 없습니다. 이전 안내의 이메일 동의항목 활성화 대신 위 설정을 사용합니다.

## 5. 확인

환경 변수 저장 후 최신 배포를 다시 배포하고 홈페이지를 Ctrl+Shift+R로 새로고침합니다. 로그인 → 카카오로 계속하기 → 계정 인증 → 아이디·전화번호 입력 → 가입 완료를 확인합니다.

코드는 모의 응답 테스트로 검증합니다. 실제 카카오 앱의 OIDC 활성화, 키 설정, Supabase 이메일 없는 계정 허용 및 실제 계정 로그인은 사용자의 설정 후 확인이 필요합니다.

공식 참고:
- https://supabase.com/docs/guides/auth/social-login/auth-kakao (Using Kakao Login JS SDK의 ID Token 흐름)
- https://developers.kakao.com/docs/ko/kakaologin/rest-api

## 오류 코드 확인

콜백 실패 시 비밀 값이나 원본 서버 오류 대신 아래 고정 코드만 표시합니다.

| 화면 코드 | 확인할 설정/단계 |
| --- | --- |
| KAKAO-01 | 쿠키/요청 만료. 홈페이지의 로그인 버튼에서 새로 시작 |
| KAKAO-02 | Cloudflare 카카오/Supabase 환경 변수 |
| KAKAO-03 | 카카오 인가 코드 교환. Client Secret/리다이렉트 URI/코드 만료 |
| KAKAO-04 | 카카오 Client Secret 및 활성화 상태 |
| KAKAO-05 | 카카오 OpenID Connect 활성화 |
| KAKAO-06 | Supabase Kakao의 Allow users without an email |
| KAKAO-07 | Supabase Kakao 제공자 활성화 |
| KAKAO-08 | Supabase Client ID와 Cloudflare REST API 키의 앱 일치 |
| KAKAO-09 | nonce 검증. 새 로그인으로 재시도, 검증 해제 금지 |
| KAKAO-10 | Supabase 사용자 저장/서버 오류. 소셜 프로필 SQL 및 Auth 로그 확인 |
| KAKAO-11 | Supabase ID Token 교환 실패. Supabase Auth 로그 확인 |
| KAKAO-12 | 발급된 Supabase 세션의 사용자 확인 실패 |
| KAKAO-13 | 카카오 인가 요청 거부 |

이 분류는 실패 단계를 좁혀 주며 상세 원인이 확정되었다는 뜻은 아닙니다. Supabase Auth 로그를 공유할 때 토큰이나 Secret은 가립니다.

## 기존 가입자 카카오 연결
Supabase Authentication → Sign In / Providers → User Signups에서 Allow manual linking(수동 계정 연결 허용)을 켜고 저장합니다.
기존 아이디/비밀번호로 홈페이지 로그인 → 상단 카카오 계정 연결 → 카카오 인증 순서로 연결합니다.
연결 후에는 카카오 로그인으로 같은 회원 ID와 프로필을 사용합니다. 이메일 권한은 요청하지 않습니다.
이미 다른 회원으로 가입한 카카오는 자동 병합하지 않고 연결 오류를 표시합니다.
