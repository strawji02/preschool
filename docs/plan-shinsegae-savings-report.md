# 신세계 절감액 보고서 시스템: 심층 분석 및 개선 전략

**작성일**: 2026-04-21
**목표**: 거래명세표 → 신세계 단가 매칭 → 도입 시 총 절감액 보고서 제출
**현재 URL**: https://firstconsulting.site/calc-food

---

## Part 1. 현재 상태 심층 분석

### 1.1 엑셀 업로드 플로우 (현재)

```
UploadZone(엑셀 드롭) → onFileSelect → useAuditSession.processExcelFile
 → excel-parser.parseInvoiceExcel (클라) → 바로 /api/analyze/excel (20개씩 배치)
 → findComparisonMatches (97회) → DB 저장 → MatchingStep으로 이동
```

**핵심 발견 — 이미 만들어져 있지만 사용 안 되는 컴포넌트**:
- `src/app/calc-food/components/ExcelUploader.tsx` (346줄) — 컬럼 매핑 표시 + 데이터 미리보기 + 합계 검증 UI가 **전부 구현되어 있음**
- 그런데 `UploadZone`(현 진입점)이 `ExcelUploader`를 **전혀 참조하지 않음** (grep 결과 확인)
- 대신 UploadZone → `onFileSelect([excelFile])` → `processExcelFile`이 파싱 + API 호출을 **무중단으로** 연속 실행

**이전 개발의 흔적**:
- 커밋 `e5bf551 feat: 합계 검증 강제화 구현`: "수량 × 단가 ≠ 금액인 행 빨간색 하이라이트, 총 합계 불일치 시 '분석 완료' 버튼 비활성화" — **매칭 완료 후 단계**에 있음
- 커밋 `a864803 feat: 거래명세서 엑셀 업로드 기능 추가`: 엑셀 업로드를 **바로 매칭으로 연결**한 커밋. 이때부터 ExcelUploader가 바이패스된 것으로 추정
- 커밋 `8f3210e feat: 거래명세표 엑셀 파일 리딩 기능 구현`: `ExcelUploader.tsx` 원본 컴포넌트 도입 시점

**결론**: 엑셀 확인 UI(`ExcelUploader`)는 **있다**. 다만 업로드 플로우가 단순화되면서 bypass되었다. 복원하려면 UploadZone이 엑셀을 감지했을 때 `ExcelUploader`를 먼저 렌더하고, 사용자가 "매칭 시작" 버튼을 누르면 `onDataParsed` 콜백으로 실제 매칭이 시작되게 바꾸면 된다.

---

### 1.2 CJ / 신세계 결합 구조

CJ와 SSG가 **타입 + UI + API + 상태관리** 전 계층에 결합되어 있다:

**타입** (`src/types/audit.ts:36-61`):
- `ComparisonItem`에 `cj_match`, `cj_candidates`, `cj_confirmed` + `ssg_match`, `ssg_candidates`, `ssg_confirmed` 모두 존재
- `SupplierScenario`는 CJ/SSG 공통 타입

**API** (`src/app/api/analyze/excel/route.ts`):
- `findComparisonMatches`가 **CJ와 SSG를 병렬로 Supabase RPC 2번 호출** (`Promise.all`)
- CJ 제거 시 RPC 호출이 절반으로 줄어 **Vercel 60초 timeout 여유** 확보

**UI**:
| 컴포넌트 | 경로 | CJ 관련 |
|----------|------|---------|
| MatchingGrid | `src/app/calc-food/components/MatchingStep/MatchingGrid.tsx:85-99` | "CJ 선택" 컬럼(주황색) + "SSG 선택" 컬럼(보라) 2칸 레이아웃 |
| ItemBreakdownTable | `src/app/calc-food/components/ReportStep/ItemBreakdownTable.tsx:199-351` | CJ 단가 / 신세계 단가 별도 컬럼 |
| ScenarioComparison | `src/app/calc-food/components/ReportStep/ScenarioComparison.tsx:13-36` | 좌 CJ 카드 / 우 신세계 카드 양쪽 |
| useAuditSession scenarios | `src/app/calc-food/hooks/useAuditSession.ts:652-707` | cj/ssg 양쪽 totalSavings 계산 |

**결론**: CJ 완전 제거는 변경 범위가 넓지만, **feature flag(`SHOW_CJ=false`) 방식**으로 숨기기만 하는 1차 변경은 빠르게 가능. 타입/API는 그대로 두고 UI 표시만 끄는 방식.

---

### 1.3 매칭 품질 문제 (골든셋 5번 정답이 1위가 안 되는 이유)

**스크린샷 분석**:
- 입력: `(피제거)들깨가루 청학 500G/PAC` 6,950원
- 정답(Susan): **후보5** — `기피들깨가루 동방제유 500G 중국산` 5,670원 (유사도 73.0)
- 현 1위: `볶음 들깨가루 뚜레반 1KG 중국산` 13,420원 (유사도 98.0)

**근본 원인**: 매칭 점수는 동의어 확장만 반영하고 **규격·단가·원산지 근접성을 재순위에 사용하지 않는다**.

`src/lib/matching.ts` `reRankCandidates()` 현재 보너스 목록:
| 규칙 | 보너스 | 적용 여부 |
|------|-------|----------|
| 제조사 힌트 일치 | +0.08 | ✓ |
| 정육 냉장/냉동 일치 | ±0.10 | ✓ |
| 농산물 국내산 일치 | +0.02 | ✓ |
| 계란 등급 대체 | +0.04 / +0.02 | ✓ |
| 저가 우선(점수 비슷할 때) | +0.01 | ✓ |

**누락된 보너스** (Susan 피드백 기반):
| 규칙 | 영향 | 누락 |
|------|------|------|
| **규격(용량) 근접도** | 500G ↔ 500G 완전 일치 가산 | ❌ |
| **내 단가 ↔ 표준 단가 근접도** | 6,950 ↔ 5,670원(18% 차) 가산 | ❌ |
| **핵심어+접두사 완전 일치** | 기피들깨가루 = 피제거들깨가루(동의어 완전매칭) | ❌ |
| **원산지 정보 일치** | 국내산/중국산 기재 여부 | ❌(농산물 국내산만 있음) |

**기대 점수 시뮬레이션 (개선 후)**:
- 후보1 볶음 들깨가루 1KG: 유사도 0.98 + 규격불일치 -0.10 + 단가차93% -0.05 = **0.83**
- 후보5 기피들깨가루 500G: 유사도 0.73 + 규격일치 +0.10 + 단가차18% +0.05 + 접두사동의어 +0.08 = **0.96** ← **1위**

---

### 1.4 미매칭 품목 처리 (현재)

**현재 동작** (`useAuditSession.ts:670-681`):
```typescript
if (item.ssg_match) {
  ssgTotalSupplier += item.ssg_match.standard_price * item.extracted_quantity
} else {
  ssgTotalSupplier += itemTotal  // 매칭 없으면 현재가 유지 → 절감액=0
}
```

- 미매칭 품목은 "현재가 그대로"로 처리되어 **절감액 계산에 중립적으로 합산**
- 그 결과: 기존 거래명세표 총액 = 신세계 전환 총액 (미매칭 부분은 안 바뀜)
- **문제**: 사용자는 "비교 제외로 명시 + 별도 표기"를 원함. 현재는 묻혀서 보이지 않음
- **타입에 `is_excluded` 필드 없음** — 수동 제외 불가

---

### 1.5 보고서 현황

`ReportView`(`src/app/calc-food/components/ReportStep/ReportView.tsx`)의 구성:
1. `ScenarioComparison` — CJ/SSG 양 카드 (현재 총액, 공급사 총액, 절감액, 절감률, 매칭/미매칭 수)
2. `ItemBreakdownTable` — 품목별 내단가 / CJ단가 / SSG단가 / 최대절감액 표

**개선 시 필요한 요소** (사용자 요구사항 4~5번):
- [ ] 기존 업체 총액(만안 원본) 표시
- [ ] 신세계 총액 (매칭된 품목만 기준)
- [ ] 총 절감액 + 절감률
- [ ] **매칭 가능 품목 목록** (비교표)
- [ ] **비교 불가 품목 목록** (별지 / 하단 섹션)
- [ ] **총액 검증**: 비교가능 + 비교불가 = 기존 총액 (원장 맞춤)

---

## Part 2. 개선 전략 (우선순위 순)

### P0 — 매칭 품질 즉시 개선 (1~2시간)

**P0-1. reRankCandidates에 규격·단가·동의어-접두 보너스 추가**

파일: `src/lib/matching.ts:192-281`

추가할 로직:
1. **규격 파싱 + 근접도 보너스**
   - 품목명/규격에서 `(\d+\.?\d*)(KG|G|ML|L)` 추출
   - 후보 `spec_quantity`/`spec_unit`과 g단위 환산 비교
   - 완전 일치(±5%): +0.10
   - 근접(±20%): +0.05
   - 불일치(>50%): -0.05

2. **단가 근접도 보너스**
   - `extractedItem.unit_price` vs `candidate.standard_price` 비율
   - 차이 ≤10%: +0.05
   - 차이 ≤30%: +0.02
   - 차이 >100%: -0.05

3. **핵심어 접두사 완전 일치 보너스**
   - 품목명에서 "접두사+본체" 분리 (기피들깨가루 → [기피, 들깨가루])
   - 후보에 같은 구조(예: 기피들깨가루 / 들깨가루) 있으면 +0.08
   - `expandWithSynonyms("기피")`에 `탈피/거피/껍질제거/피제거` 있어야 (이미 `synonyms.ts`에 있음)

**P0-2. "(피제거)들깨가루 청학" 같은 특수 케이스 회귀 테스트**

파일: `test-data/` 하위에 `matching-regression.test.ts` 추가 (가벼운 assertion)
- 만안 97품목 중 Susan이 "맞음"으로 확정한 70개 → Top 1에 그대로 나오는지
- "없음"이라 했던 17개 → 비교 제외 후보로 표시되는지

### P1 — CJ 제거 (30분 ~ 1시간)

**P1-1. feature flag로 CJ 숨김**

파일: `src/lib/constants.ts` (신설 or 기존)
```typescript
export const COMPARISON_SUPPLIERS = {
  CJ: false,   // 🔴 Phase 1: 비활성화
  SHINSEGAE: true,
}
```

변경 지점:
- `ScenarioComparison.tsx`: `COMPARISON_SUPPLIERS.CJ`일 때만 CJ 카드 렌더
- `ItemBreakdownTable.tsx`: CJ 컬럼 조건부 표시
- `MatchingGrid.tsx`: CJ 슬롯 제거, 신세계만 좌측 고정
- `useAuditSession.ts` scenarios: CJ 계산 여전히 수행(backward compat), UI에서만 숨김

**P1-2. API 레벨 CJ 호출 제거 (성능)** (선택)

`findComparisonMatches`에서 CJ RPC 호출 skip → Vercel 60초 timeout 여유 2배
- ⚠️ 추후 CJ 재도입할 때 플래그만 뒤집어서 바로 복원 가능한 구조로

### P2 — 엑셀 업로드 후 담당자 확인 절차 복원 (2~3시간)

**P2-1. UploadZone에서 엑셀은 ExcelUploader로 라우팅**

파일: `src/app/calc-food/page.tsx` 및 `UploadZone.tsx` → `useAuditSession.processFiles` 중간에 단계 추가.

플로우 변경:
```
UploadZone(엑셀) → ExcelUploader(미리보기 + 검증 + "매칭 시작" 버튼)
                 → onDataParsed → processExcelFile(실제 매칭)
```

**P2-2. ExcelUploader에 "매칭 시작" 버튼 + 합계 검증 + 편집 기능 추가**

현재 `ExcelUploader.tsx`의 미리보기(10행)는 read-only. 다음을 추가:
- 전체 행 스크롤 표시
- 각 행 합계 검증: `|수량 × 단가 - 금액| > 1원` 이면 빨간 배경
- 상단 KPI: 총 품목 수 / 총액 / 합계 불일치 수
- "매칭 시작" 버튼 (합계 불일치 0일 때만 활성화)
- (선택) 개별 행 편집 / 삭제 / "비교 제외" 체크

**P2-3. 진행률 표시 (배치 매칭)**

현재 20개씩 5배치로 매칭하지만 진행률 미표시. 각 배치마다:
- `dispatch({ type: 'UPDATE_BATCH_PROGRESS', current, total })`
- 사용자는 "3/5 배치 처리 중... (43%)" 같은 피드백 받음

### P3 — 미매칭 품목 "비교 제외" 플로우 (2~3시간)

**P3-1. 타입 확장**

`src/types/audit.ts`:
```typescript
export interface ComparisonItem {
  // ... 기존 필드
  is_excluded?: boolean           // 담당자가 비교 제외로 마크
  exclusion_reason?: string       // 선택: 사유 (매칭 없음, 일회성 구매 등)
}
```

DB 스키마(`audit_items`)에도 컬럼 추가 마이그레이션 필요.

**P3-2. MatchingView에 "비교 제외" 토글**

미매칭 품목(match_status === 'unmatched')에만 "이 품목은 비교 불가" 버튼 노출. 클릭 시 `is_excluded = true`로 업데이트.

**P3-3. 시나리오 계산에서 제외 품목 처리**

`useAuditSession.ts:652-707` 수정:
```typescript
for (const item of items) {
  if (item.is_excluded) continue  // 절감액 계산에서 완전 제외
  // ...
}
```

### P4 — 보고서 개편 (3~4시간)

**P4-1. ReportView 레이아웃 재설계**

```
[상단] 요약 카드 (크게)
  - 기존 업체: {업체명} 총 {원}
  - 신세계 도입 시: 총 {원} (절감 {원}, {%}↓)

[중단] 비교 가능 품목 테이블
  - 품명 / 규격 / 수량 / 내단가 / 신세계단가 / 절감액

[하단] 비교 불가 품목 별지
  - 품명 / 규격 / 수량 / 단가 / 금액
  - 사유: 매칭 없음 / 담당자 제외

[맨 아래] 총액 검증
  - 비교가능 {원} + 비교불가 {원} = 기존 총액 {원} ✓
```

**P4-2. 엑셀 다운로드 양식 개편**

`src/app/calc-food/components/ReportStep/` 하단의 엑셀 export 로직 (commit `5a01790`):
- 시트1: 요약 & 총액
- 시트2: 비교 가능 품목
- 시트3: 비교 불가 품목 (별지)
- 시트4: 매칭 상세 (담당자 검토용)

---

## Part 3. 실행 순서 제안

**즉시 (오늘) — 약 3시간**
1. **P0-1** 매칭 보너스 추가 (규격·단가·접두사 동의어) — 약 1.5h
2. **P1-1** CJ feature flag로 숨김 — 약 0.5h
3. 로컬 검증 후 develop→main 머지 → Vercel 자동 배포 — 약 0.5h
4. **P0-2** 만안 검수 엑셀로 회귀 확인 — 약 0.5h

**다음 단계 (1~2일) — 약 6시간**
5. **P2** 엑셀 업로드 후 담당자 확인 절차 복원 — 약 3h
6. **P3** 미매칭 품목 비교 제외 UI + DB 스키마 — 약 3h

**마무리 (추가 4시간)**
7. **P4** 보고서 개편 + 엑셀 다운로드 양식 — 약 4h

---

## Part 4. 리스크와 확인 요청

### 리스크
- **DB 마이그레이션** (P3 `is_excluded` 컬럼): 프로덕션 DB에 SQL 실행 필요. Supabase 콘솔 접근 권한 확인 필요
- **매칭 알고리즘 회귀**: 새 보너스가 다른 품목 순위를 나쁘게 만들 수 있음 → 전체 97품목 자동 회귀 테스트 필수
- **ExcelUploader UI 복원**: 현재 `UploadZone`이 모든 파일 타입을 단일 경로로 처리. 엑셀만 분기 추가 시 PDF 플로우 영향 없게 주의

### 확인 요청
1. **CJ 완전 제거인가, 숨김인가?** — 숨김(flag)이 안전. 향후 재도입 가능. 괜찮은지?
2. **`is_excluded` DB 컬럼 추가 OK?** — Supabase `audit_items`에 `ALTER TABLE` 필요. 직접 하실지 제가 SQL 만들어 드릴지
3. **총액 검증 기준**: `비교가능 + 비교불가 = 기존 총액`이 엄격 일치(±1원) 여야 하는지, 아니면 %단위 오차 허용인지
4. **업체명 표시**: 보고서 상단 "기존 업체 = 만안" 같은 업체명은 어디서 가져오나? (엑셀 파일명? 사용자 입력?)
5. **진행 순서**: P0~P1만 먼저 배포하고 Susan 재검수 받는 방식 vs P0~P4 한 번에 배포 중 선호?

응답 주시면 즉시 P0부터 구현 들어가겠습니다.
