# 보안 정책 (Database Access)

## 접근 모델

- **인증 없음** (현재): 익명 사용자가 server route를 통해 DB 접근
- **server route만 DB 호출**: 모든 클라이언트는 `/api/*` 통과 (browser → Supabase 직접 호출 없음)
- **service_role key only**: server route는 RLS bypass되는 service_role 사용

## RLS 정책 (필수)

**모든 public table은 RLS enabled**. policy 미정의 → anon/authenticated는 default deny.

`anon` key가 `NEXT_PUBLIC_SUPABASE_ANON_KEY`로 브라우저에 노출되므로,
RLS가 없으면 누구나 console에서 DB 직접 조회/수정 가능. RLS는 마지막 방어선.

### 새 table 생성 시

마이그레이션 파일에 **반드시** 다음 SQL 포함:

```sql
CREATE TABLE public.my_table (...);
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
```

CI 검사: `npm run lint:migrations`. `046_security_hardening.sql` 이후 마이그레이션은
`CREATE TABLE` 있고 `ENABLE ROW LEVEL SECURITY` 없으면 fail.

### 인증 도입 시 추가 작업

향후 Supabase Auth 도입 시:
- table마다 `user_id` 컬럼 추가
- policy 정의: `auth.uid() = user_id`
- `src/lib/supabase/server.ts` deprecated 해제

## Supabase Client 사용 규칙

| 위치 | Client | Key |
|---|---|---|
| Server route (`/api/*`) | `createAdminClient` (`@/lib/supabase/admin`) | service_role |
| Server Component / SSR | (현재 미사용) | — |
| Browser | (현재 미사용) | — |

### ❌ 금지

- `src/lib/supabase/server.ts` 신규 import — anon key 사용, RLS에 막힘
- `src/lib/supabase/client.ts` 신규 import — browser에 service_role 키 노출 위험
- 컴포넌트에서 직접 Supabase 호출 — server route 거치도록

### ✅ 권장

```ts
// src/app/api/foo/route.ts
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createAdminClient()
  const { data } = await supabase.from('audit_items').select('*')
  return NextResponse.json({ data })
}
```

## 함수 (RPC) 정책

- 모든 함수 `SET search_path = public, pg_temp` 명시 (CVE-2018-1058 방지)
- 새 함수 생성 시 마이그레이션에 포함

## 검증 방법

### 정기 점검

```bash
# Supabase advisor 직접 조회 (Management API)
TOKEN=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w \
  | sed 's/^go-keyring-base64://' | base64 -d)
curl -s "https://api.supabase.com/v1/projects/kihwrilnkaszuhhengvp/advisors/security" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.lints[] | select(.level=="ERROR")'
```

ERROR 0건이어야 함. WARN은 검토 후 결정.

### 마이그레이션 검사

```bash
npm run lint:migrations
```

## API 인증 (Origin guard + shared secret)

**위치**: `middleware.ts` (root)

모든 `/api/*` 경로는 다음 중 하나를 만족해야 통과:

1. **Browser 요청**: `Sec-Fetch-Site: same-origin` OR Origin/Referer가 `firstconsulting.site` / Vercel preview
2. **Server-to-server**: `X-App-Secret` 헤더가 `APP_SHARED_SECRET` env와 일치

차단 효과:
- 자동화 봇/스크래퍼 (Origin 누락) → 401
- 직접 curl/script 호출 (secret 없음) → 401
- 일반 브라우저 사용자 → 자동 same-origin 통과 (UX 영향 0)

### 환경변수 설정

**Vercel Dashboard → Settings → Environment Variables**:
- `APP_SHARED_SECRET`: 32자 이상 random string (예: `openssl rand -hex 32`)
- (선택) `ALLOWED_HOSTS`: 콤마 구분 추가 허용 도메인

**로컬 (.env.local)**: 동일 키 추가 (선택)

### 서버-서버 호출 시

curl/script로 API 테스트 시:
```bash
curl -H "X-App-Secret: ${APP_SHARED_SECRET}" "https://firstconsulting.site/api/sessions"
```

## 인시던트 이력

- **2026-05-12 Phase 2**: API 인증 layer 추가 (옵션 A — shared secret + origin guard)
  - 원인: 모든 mutation API가 인증 없이 노출 — DELETE/PATCH 무단 호출 가능
  - 해결: `middleware.ts` — same-origin/X-App-Secret 검증
  - 영향: 일반 사용자 UX 0, 봇 90%+ 차단

- **2026-05-12 Phase 1**: Critical/High 보안 fix (C2/C3/H4)
  - C2: PostgREST `.or()` injection — `sanitizeOrFilterValue` 적용
  - C3: Storage path traversal — `isValidUuid` + 세션 존재 확인
  - H4: Error message leakage — `apiError` wrapper 21개 위치

- **2026-05-11**: Supabase advisor 보안 알림 (RLS Disabled in Public × 6, Sensitive Columns Exposed × 2, Function Search Path Mutable × 9)
  - 원인: 초기 setup에서 RLS 미설정
  - 해결: `046_security_hardening.sql` — 6개 table RLS enable + 9개 함수 search_path 고정
  - 재발방지: `scripts/lint-migrations.sh` + 본 문서

## 2026-08-10 — 구글 클라우드 보안 권고 대조

구글이 보낸 자격증명 관리 권고를 실제 환경과 하나씩 맞춰 봤다.

### 통과

```
저장소에 키 없음        private_key·BEGIN PRIVATE KEY·AIza…·JWT  전부 0건
                        (git 이력 전체 검색. `service_role` 38건은 역할 이름)
.gitignore              .env* / .env*.local  차단
사용자 관리 SA 키       5개 프로젝트 전부 0개 — 구글 관리 키만 있다
API 키 API 제한         7개 전부 걸려 있다 (Gemini·Firebase 각각)
```

다운로드형 서비스 계정 키가 하나도 없어서 권고의 **가장 큰 항목(장수명 키)은
해당 사항이 없다.**

### ⚠️ 찾은 것 — service_role 코드가 브라우저 번들에 실려 있었다

`unitConversionUnified.ts`가 `unit-conversion-db`를 직접 import했는데, 이걸 쓰는
`MatchingRow`·`CandidateSelector`가 **둘 다 클라이언트 컴포넌트**였다.

```
calc-food/page.tsx → AnalysisDashboard → MatchingStep → CandidateSelector ('use client')
  → unitConversionUnified → unit-conversion-db → supabase/admin  (service_role)
```

**키 값은 새지 않았다.** Next는 `NEXT_PUBLIC_` 접두어만 인라인한다 — 번들에는
`env.SUPABASE_SERVICE_ROLE_KEY`라는 **이름만** 있고 값은 `undefined`였다.
브라우저 파일에서 실제 키를 찾아본 결과 0건.

그래도 서버 전용 DB 코드가 브라우저에 실릴 이유는 없다. 끊었다.

- `admin.ts`·`unit-conversion-db.ts`에 **`import 'server-only'`** — 다시 새면 빌드가 깨진다
- `admin/unit-conversions/page.tsx`는 **타입만** 가져오게 (`import type`)
- 재검사: 브라우저 파일에 키 이름 0건 / 값 0건

### ⚠️ 함께 드러난 것 — DB 단위 환산은 한 번도 동작한 적이 없다

`convertPriceUnified`의 Strategy 1·2(DB 환산)는 브라우저에서 키가 없어 늘 예외로
빠졌고 `try/catch` 폴백이 받아 왔다. 호출자가 클라이언트 둘뿐이라 **서버에서
실행된 적이 없다.** 죽은 경로라 걷어냈다.

되살리려면 API 경로로 빼야 하고, **매칭 결과가 달라지므로 별도 작업**이다.

### 남은 권고 — GCP 쪽 (챗봇 프로젝트 소관)

```
API 키 환경 제한(IP·리퍼러)   7개 전부 없음 — 유출 시 어디서든 호출 가능
조직 정책                    disableServiceAccountKeyCreation 미설정
                             serviceAccountKeyExpiryHours 미설정
                             (조직이 없어 프로젝트 단위로 걸어야 한다)
필수 연락처                  API 자체가 비활성 — 사실상 미설정
예산 알림                    API 자체가 비활성 — 미설정
```

⚠️ **예산 알림이 없어서** 26년 상반기 Artifact Registry 90GB(월 ₩13,371)가
몇 달간 눈에 안 띄었다. 권고문의 "소비 급증이 자격증명 침해의 첫 신호"가
정확히 그 사례다.

키가 0개인 지금 `disableServiceAccountKeyCreation`을 거는 것은 **끊길 것이 없어
가장 싸다.** 나중에 키가 생긴 뒤에는 못 건다.
