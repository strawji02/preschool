# 웹 배포를 위한 매칭 개선 포팅 계획

**목표**: `test-data/generate-golden-set.ts`의 개선 사항을 프로덕션(`firstconsulting.site/calc-food`)에 반영하여 실제 유저가 사용하는 매칭 품질을 올린다.

**대상 URL**: https://firstconsulting.site/calc-food
**배포 방식**: Vercel 자동 배포 (main 브랜치 머지 시)
**현재 브랜치**: `develop`

---

## 1. 배경 정리: 테스트 vs 프로덕션

| 구분 | 테스트 스크립트 | 프로덕션 |
|------|----------------|---------|
| 진입점 | `test-data/generate-golden-set.ts` | `calc-food/page.tsx` → `/api/analyze/excel` → `findComparisonMatches()` (`src/lib/matching.ts`) |
| DB | 로컬 엑셀 (신세계 단가) | Supabase RPC (`search_products_hybrid` 등) |
| 검색 루프 | 클라이언트 사이드 `includes()` 루프 | 서버 사이드 BM25 + semantic + trigram |
| 동의어 | 스크립트 내부 `SYNONYMS`/`BRAND_EQUIVALENTS` | `src/lib/synonyms.ts`의 `FOOD_SYNONYMS` |
| 키워드 추출 | 스크립트 내 `extractKeywords()` | `preprocessing.ts`의 `dualNormalize`, `extractSearchHints` + `matching.ts`의 `expandWithCompoundSplitting` |
| 결과 정제 | 클라 스코어 + Gemini Evaluator | Supabase 스코어 + `reRankCandidates()` 도메인 재순위 |

**핵심 차이**: 프로덕션은 Supabase 풀텍스트 검색이라 `hasWordMatch` 같은 단어경계 필터를 **검색 쿼리 단계가 아니라 결과 후처리 단계**에 끼워 넣어야 한다.

---

## 2. 이식할 개선 사항 (우선순위 순)

### P0 — 오탐 버그 수정 (Susan 검수에서 가장 치명적이었던 이슈)

**P0-1. 짧은 키워드의 복합어 중간 매칭 차단**
- 증상: "무우"→"무" 키워드가 `무항생제 닭다리살`, `무농약 찹쌀` 같은 완전 다른 품목에 매칭
- 포팅 대상: `hasWordMatch()` 함수
- 적용 위치: `matching.ts`의 후보 배열을 받은 직후 (RPC 응답 → `reRankCandidates` 이전)
- 로직: 2글자 이하 키워드가 품명에 나타날 때 앞뒤 모두 한글이면 제외 (예: `세척무`는 OK, `무항생제`는 탈락)

**P0-2. 브랜드만 일치하는 후보 제외**
- 증상: "스팸캔(CJ)"→"CJ 프로틴바", "카레분(오뚜기)"→"오뚜기밥"
- 포팅 대상: `isBrandKeyword()` + coreKeyword 매칭 필수화
- 적용 위치: `matching.ts` 후보 후처리 단계
- 로직: 브랜드 키워드만 매칭된 후보는 비-브랜드 핵심어도 최소 1개는 일치해야 통과

### P1 — 동의어/변환 룰 확장

**P1-1. `src/lib/synonyms.ts` 보강**
- 추가 엔트리(테스트 스크립트의 `SYNONYMS`와 동기화):
  - 모두부=판두부=손두부=즉석두부
  - 볶음용멸치=지리멸치=조림멸치=잔멸치=세멸
  - 볼어묵=어묵(+ 역방향), 돼지등뼈=돈등뼈
  - 스팸=스팸캔, 통단무지=단무지, 오이피클=오이피클슬라이스
  - 자른미역=건미역, 옛날자른미역=미역
  - 무우=무=세척무=흙무, 돈민찌=다짐육
  - 영계=생닭, 알배기=알배추, 기피=탈피=거피=껍질제거
  - 느타리=맛느타리=애느타리
  - 계란 등급: 왕란/특란/대란/중란/소란

**P1-2. 브랜드 동등 매핑 신설**
- 파일 위치: `src/lib/synonyms.ts`에 `BRAND_EQUIVALENTS` export 추가
- 엔트리: 대상↔청정원, 한성↔한성기업, CJ↔CJ제일제당↔비비고, 효성↔효성어묵
- 사용처: `preprocessing.ts`의 `extractSearchHints()`가 브랜드 추출 후 동등 브랜드도 검색어에 포함

**P1-3. ITEM_TRANSFORMS (품목별 검색어 치환)**
- 예: "카레분"→"카레", "통단무지"→"단무지", "스팸캔"→"스팸", "자른미역"→"미역,건미역"
- 적용 위치: `preprocessing.ts`의 `extractCoreKeyword` 또는 `dualNormalize` 내부

### P2 — 기존 로직 정합성 확인

**P2-1. `reRankCandidates()`의 정육 냉장/냉동 우선 룰 검증**
- Susan 피드백: "정육은 냉장/냉동 우선 구분 후 규격 비교"
- 현재 `isMeatItem` + `extractStorageType` 이미 있음 → 정상 작동하는지 로그로 검증

**P2-2. 스파게티소스 기본값 룰(`expandSauceQuery`) 이미 반영됨** — OK

**P2-3. 계란 등급 대체(`getEggGradeSubstitutes`) 이미 반영됨** — OK

---

## 3. 구현 단계

### Step 1 — 동의어/브랜드 매핑 이식 (30분)
파일:
- `src/lib/synonyms.ts`: `FOOD_SYNONYMS`에 ~30개 추가, `BRAND_EQUIVALENTS` export 신설
- `src/lib/preprocessing.ts`: `extractSearchHints`가 `BRAND_EQUIVALENTS`를 참조하도록 수정

### Step 2 — 후처리 필터 함수 추가 (30분)
파일:
- `src/lib/matching.ts` 상단에 `hasWordMatch()`, `isBrandKeyword()` 추가
- `findComparisonMatches()` 내부에서 RPC 결과를 받은 직후(라인 ~640 근처), `reRankCandidates` 이전에 필터 적용:
  ```
  cj_candidates = filterByCoreKeywordMatch(cj_candidates, coreKeyword, brandHints, manufacturer)
  ssg_candidates = filterByCoreKeywordMatch(ssg_candidates, coreKeyword, brandHints, manufacturer)
  ```

### Step 3 — ITEM_TRANSFORMS 주입 (15분)
- `preprocessing.ts`에 상수 테이블 + `applyItemTransforms(keyword)` 추가
- `dualNormalize`에서 `forKeyword` 산출 후 적용

### Step 4 — 로컬 개발 서버 검증 (30분)
- `npm run dev` → http://localhost:3000/calc-food
- 만안 엑셀(8월 급식 거래명세서_만안.xlsx) 업로드
- 핵심 10개 품목 수동 확인: 무우, 스팸캔, 카레분, 통단무지, 비비고물만두, 옛날자른미역, 냉장돈민찌, 모두부, 볶음용멸치, 영계
- Chrome DevTools MCP로 UI 플로우 자동 스크린샷 (선택)

### Step 5 — 단위 테스트 (선택, 30분)
- `test-data/`에 `test-matching-port.ts` 작성: 포팅된 `matching.ts`를 호출해 5개 문제 품목이 올바르게 매칭되는지 assert

### Step 6 — PR 및 배포 (15분)
- `develop` → `main` PR 생성 (제목: `fix(matching): prevent brand-only/substring false matches, expand synonyms from Susan review`)
- 머지 시 Vercel이 자동 빌드 → firstconsulting.site 반영

---

## 4. 위험 및 가정

**위험**
- **R1**. Supabase RPC가 반환한 후보에 post-filter를 걸면 Top-10이 줄어들 수 있음 → `search_limit`을 일시적으로 20으로 늘리고 필터 후 Top-10 유지
- **R2**. `hasWordMatch`가 너무 엄격하면 recall 하락 → 1글자 키워드에만 엄격 적용, 2글자는 일반 substring 허용으로 완화 가능 (Susan 데이터로 재검증 필요)
- **R3**. 브랜드 필터가 정상 브랜드 매칭(예: "오뚜기 돈까스" → "오뚜기 돈까스")을 차단하면 안 됨 → coreKeyword("돈까스")도 매칭되는 경우만 통과시키므로 OK

**가정**
- Vercel 자동 배포가 `main` 브랜치 기준으로 살아 있다 (최근 커밋 히스토리로 추정)
- Supabase RPC는 현 시점에서 정상 동작 중 (별도 DB 인덱스 변경은 이번 PR에 포함 안 함)
- 환경변수(GOOGLE_GEMINI_API_KEY, Supabase URL/Key)는 Vercel에 이미 설정되어 있음

---

## 5. 검증 지표

**Before (현재 프로덕션)** — 확인 필요 (실측 아직 안 함)

**After (목표)**
- Susan이 지적한 17개 "없음" 품목 중 **12개 이상** 정답 후보 노출
- Susan이 지적한 오매칭(스팸캔→프로틴바, 카레분→오뚜기밥, 무우→닭다리살) **0건**
- 기존 "맞음" 판정 70개 품목의 Top-1이 동일하거나 더 좋아질 것 (회귀 방지)

**검증 방법**: 로컬 개발 서버에서 만안 엑셀 업로드 → 97개 품목의 Top-5 후보를 콘솔/UI에서 확인 → Susan 검수 결과와 diff

---

## 6. 일정 (실작업 기준)

| 단계 | 소요 | 누적 |
|------|------|------|
| Step 1 동의어 이식 | 30분 | 0:30 |
| Step 2 후처리 필터 | 30분 | 1:00 |
| Step 3 ITEM_TRANSFORMS | 15분 | 1:15 |
| Step 4 로컬 검증 | 30분 | 1:45 |
| Step 5 (선택) 단위 테스트 | 30분 | 2:15 |
| Step 6 PR + 배포 | 15분 | 2:30 |

**총**: 약 2-2.5시간 (단위 테스트 제외 시 1시간 45분)

---

## 7. 바로 시작할지 확인 필요한 사항

1. **브랜치 전략**: `develop`에서 바로 작업 → `main` PR? 아니면 `feature/matching-improvements-from-review` 같은 별도 브랜치?
2. **배포 타이밍**: 바로 main 머지해도 되는지, 스테이징 환경이 별도 있는지
3. **Susan 검수 재요청**: 배포 후 다시 검수 요청할지, 내부 자체 검증만 할지
4. **단위 테스트 포함 여부**: Step 5 진행 여부

응답 주시면 바로 구현 들어가겠습니다.
