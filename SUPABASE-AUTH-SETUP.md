# Supabase 회원 인증 연결

코드는 Supabase Auth를 사용하며 아이디 또는 이메일로 로그인합니다. 비밀번호는 Supabase에서 관리하고, 홈페이지는 HttpOnly 인증 쿠키를 사용합니다.

## 1. 기존 프로젝트에 회원 테이블 적용

이 저장소를 내려받은 폴더에서 Supabase CLI로 실행합니다.

```sh
supabase login
supabase link --project-ref <프로젝트-reference-id>
supabase db push
```

적용 파일: `supabase/migrations/20261007090000_member_profiles.sql`.
회원 프로필 생성 트리거는 신규 Auth 사용자에게 username과 phone 메타데이터를 요구합니다. 다른 앱과 공유하는 기존 프로젝트라면 기존 가입 흐름과의 호환성을 먼저 확인하세요. 기존 Supabase 사용자는 자동으로 프로필이 생성되지 않습니다.

## 2. Cloudflare Pages 환경 변수

`studing` → Settings → Variables and Secrets → Production에 추가합니다.

| 이름 | 값 | 유형 |
| --- | --- | --- |
| SUPABASE_URL | 프로젝트 URL: https://프로젝트.supabase.co | Variable |
| SUPABASE_PUBLISHABLE_KEY | 프로젝트 API Keys의 publishable key | Variable |
| SUPABASE_SECRET_KEY | 프로젝트 API Keys의 secret key | Secret |

기존 키를 사용하는 프로젝트는 SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 이름도 지원합니다. Secret 키는 서버에서만 사용합니다. 채팅이나 저장소에 올리지 마세요.
기존 MEMBERS_DB, RECIPE_PASSWORD, RECIPE_ADMIN_PASSWORD는 레시피 기능에 필요하므로 유지합니다.

## 3. 이메일 인증

Supabase Authentication에서 Email 가입과 이메일 인증을 켜고 최소 비밀번호 길이를 12로 설정합니다. URL Configuration의 Site URL은 `https://studing.pages.dev`입니다.
Confirm signup 이메일 템플릿의 인증 링크를 다음과 같이 설정합니다.

```html
<a href="{{ .SiteURL }}/api/auth-confirm?token_hash={{ .TokenHash }}">이메일 인증</a>
```

설정 완료 후 Cloudflare에서 최신 배포를 다시 배포합니다. 가입 → 인증 메일 → 로그인 → 새로고침 → 로그아웃 순서로 확인합니다.

## 기존 회원 및 검증 범위

기존 D1 회원 데이터는 삭제하지 않습니다. 기존 D1 계정은 Supabase로 자동 이전되지 않으므로 별도 이전 또는 재가입이 필요합니다.
자동 테스트는 Supabase API 응답을 모의하여 검증하며 실제 프로젝트 연결과 SQL 적용은 별도로 필요합니다. 환경 변수만으로는 테이블 및 RPC 존재 여부를 확인할 수 없으므로 SQL 적용도 완료해야 합니다.

공식 CLI 안내: https://supabase.com/docs/reference/cli/introduction
