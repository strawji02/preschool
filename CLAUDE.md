# preschool — 유치원 급식 플랫폼

> 이 파일은 매 세션 자동 로드됩니다. **얇게 유지**하세요.
> 상세 스펙은 아래 시스템별 MD에 있고, **작업에 해당하는 것 1개만** 읽습니다.

## 두 시스템이 공존·운영 중

| 시스템 | 상태 | 문서 | 요청 헤더 |
|---|---|---|---|
| **급식 정산** | 신규 개발 | `docs/systems/settlement.md` (+ `settlement/` 6개) | `[정산]` |
| **급식 비교** | 운영 중 (95% 완성) | `docs/systems/comparison.md` | `[비교]` |

**작업 시작 전**: 요청 헤더(`[정산]`/`[비교]`)를 보고 **해당 시스템 MD만** 읽으세요.
헤더가 없으면 어느 시스템인지 먼저 물어보세요. 두 MD를 동시에 읽지 마세요.

정산은 문서가 커서 한 번 더 쪼개져 있습니다. `settlement.md`(색인·산식)를 먼저 읽고,
그 안의 표에서 **작업에 해당하는 하위 파일 1개만** 엽니다. 마감 버그를 잡을 때
수금 문서는 필요 없습니다.

⚠️ 하위 파일로 갈려도 **섹션 번호는 그대로**입니다 (`docs §8-2` 등). 코드 주석
120여 곳이 번호로 참조하므로 절대 다시 매기지 마세요.

⚠️ **비교 시스템은 실제 운영 중**입니다. 정산 개발이 비교 시스템을 깨뜨리면 안 됩니다.
공용 파일(`src/lib/`, `src/middleware.ts`, `src/app/layout.tsx`)을 건드리면 반드시 전체 테스트를 돌리세요.

## 모듈 경계 (모듈러 모놀리스)

단일 Next 앱 안에서 도메인을 분리합니다. 모노레포 아님 — 앱이 2개로 분리될 때 재검토.

```
src/app/(public)/      공개 마케팅 홈 (/)
src/app/app/           로그인 필수 런처 + 두 모듈
src/features/settlement/   정산 도메인 로직
src/features/comparison/   비교 도메인 로직
src/features/shared/       유치원·영업자 마스터 (양쪽 공용)
src/lib/                   범용 유틸 (format, cn, supabase)
```

**규칙**
1. `features/settlement` ↔ `features/comparison` **직접 import 금지**. 공유는 `features/shared` 또는 `lib` 경유.
2. 각 feature는 `index.ts` barrel로만 노출. 내부 파일 직접 import 금지.
   - **클라이언트 컴포넌트는 `client.ts` barrel을 쓴다.** `index.ts`에는 service_role
     접근 코드가 섞여 있어 브라우저 번들에 서버 코드가 끌려 들어간다.
     서버 전용 모듈에는 `import 'server-only'`를 걸어 빌드가 실패하게 둔다.
3. 신규 정산 코드만 새 구조로 작성. 기존 `calc-food`는 건드릴 일 있을 때 점진 이동.

## 개발 규칙 (공통)

- **한국어로 대화, 간결하게.**
- **커밋은 main·develop 양쪽에** 매번. 커밋 메시지 끝에:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **산술·환산·합계·매칭 변경은 TDD** — 실패 테스트 먼저, 그다음 구현. (돈 계산은 예외 없음)
- **Supabase는 CLI/Management API로만.** 대시보드 SQL Editor 안내 금지.
  실데이터 조회는 `.env.local`의 service_role + PostgREST.
- 검증 순서: `npx vitest run src/lib` → `npx tsc --noEmit` → `npx next build`
  - **셋 다 깨끗해야 합니다.** 2026-07-31부터 필터가 필요 없습니다 — 예외를 다시
    만들지 마세요. 필터는 진짜 에러도 같이 가립니다.
  - `.test.ts` 파일에는 반드시 `describe`/`it`을 쓰세요. `console.log` 스크립트를
    그 이름으로 두면 vitest가 상시 FAIL을 내면서 **종료 코드는 0**이라 아무도 못 잡습니다.
- 배포: Vercel 단일 프로젝트 (`firstconsulting.site`). main push = 프로덕션.
- 버전 표시: `scripts/generate-version.mjs`가 **경로로** 시스템을 판별합니다.
  모듈 경계를 바꾸면 이 파일의 경로 목록도 같이 고치세요 — 갈라지면 사용자가
  "안 바뀌었다"는 잘못된 정보를 봅니다.

## 인증 (신규 도입)

- Supabase Auth + Google OAuth (`@supabase/ssr` 이미 설치됨)
- 화이트리스트: Before User Created Hook으로 미승인 이메일 **가입 자체 차단**
- `/app/*` 전 경로 + 해당 API 라우트는 **서버에서** 세션 검증
- 런처 제목 **3클릭** 은폐는 **UX 장치일 뿐** — 보안 경계가 아님
  (경계는 `middleware.ts` + `calc-food/layout.tsx`의 `requireComparisonAccess()`)
