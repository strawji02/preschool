# Phase 2: 백엔드 API 구현 스펙

> 보관 문서: 현재 운영 규칙은 AGENTS.md와 docs/systems/를 우선합니다.

> **상태**: 설계 완료
> **날짜**: 2026-02-01
> **의존성**: Phase 1 (DB 설계 & 시드) ✅ 완료

---

## 1. 개요

### 1.1 목표
Vercel Serverless 환경(10초 Timeout)에 최적화된 **페이지 단위 처리(Page-by-Page)** 아키텍처로 OCR + Fuzzy Matching API 구현

### 1.2 핵심 제약사항

| 제약 | 해결책 |
|------|--------|
| Vercel Free Tier 10초 Timeout | 단일 페이지 이미지만 처리 |
| 멀티페이지 PDF 처리 불가 | 프론트엔드에서 PDF→이미지 변환 후 순차 요청 |
| Stateless API | 세션 ID로 상태 연결 |

### 1.3 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend (Browser)                                                   │
│                                                                      │
│  1. PDF 로드 (PDF.js)                                                │
│  2. 페이지별 Canvas 렌더링 → Base64 이미지                            │
│  3. 순차 API 호출:                                                   │
│     Page 1 → /api/analyze/page → 결과 저장                           │
│     Page 2 → /api/analyze/page → 결과 저장                           │
│     ...                                                              │
│  4. 모든 페이지 완료 시 UI 렌더링                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Backend API (Vercel Serverless)                                      │
│                                                                      │
│  POST /api/session/init                                              │
│  ├── audit_sessions 생성                                             │
│  └── session_id 반환                                                 │
│                                                                      │
│  POST /api/analyze/page         ← 핵심 Worker API                    │
│  ├── 1. 이미지 저장 (Supabase Storage)                               │
│  ├── 2. Gemini OCR (lib/gemini.ts)                                   │
│  ├── 3. Fuzzy Matching (lib/matching.ts)                             │
│  └── 4. audit_items INSERT                                           │
│                                                                      │
│  GET /api/products/search                                            │
│  └── pg_trgm Fuzzy 검색 (수동 매칭용)                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ External Services                                                    │
│                                                                      │
│  [Supabase PostgreSQL]    [Supabase Storage]    [Google Gemini API]  │
│   - products (23,866)      - invoice-images/     - Vision OCR        │
│   - audit_sessions         - {session}/{page}    - 2.5 Flash         │
│   - audit_items                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 파일 구조

```
src/
├── app/
│   └── api/
│       ├── session/
│       │   └── init/
│       │       └── route.ts      # POST: 세션 생성
│       ├── analyze/
│       │   └── page/
│       │       └── route.ts      # POST: 페이지 분석 (핵심 Worker)
│       └── products/
│           └── search/
│               └── route.ts      # GET: Fuzzy 검색
├── lib/
│   ├── gemini.ts                 # Google Gemini Vision API 래퍼
│   ├── matching.ts               # Fuzzy Matching 로직
│   └── supabase/                 # (기존)
│       ├── client.ts
│       ├── server.ts
│       └── admin.ts
└── types/
    └── audit.ts                  # 타입 정의

scripts/
└── test-phase2.ts                # E2E 테스트 스크립트
```

---

## 3. API 엔드포인트 상세

### 3.1 `POST /api/session/init`

**목적**: 새 감사 세션 생성

**Request**:
```typescript
interface InitSessionRequest {
  name: string           // 세션명 (예: "2026년 1월 거래명세서")
  supplier: 'CJ' | 'SHINSEGAE'
  total_pages: number    // PDF 총 페이지 수
}
```

**Response**:
```typescript
interface InitSessionResponse {
  success: boolean
  session_id: string     // UUID
  message?: string
}
```

**구현 로직**:
1. `audit_sessions` 테이블에 INSERT
2. `status = 'processing'` 초기값
3. 생성된 `session_id` 반환

**예상 시간**: < 500ms

---

### 3.2 `POST /api/analyze/page` ⭐ (핵심 Worker)

**목적**: 단일 페이지 이미지 분석 (OCR + Matching)

**Request**:
```typescript
interface AnalyzePageRequest {
  session_id: string
  page_number: number
  image: string          // Base64 인코딩된 이미지 (JPEG/PNG)
}
```

**Response**:
```typescript
interface AnalyzePageResponse {
  success: boolean
  page_number: number
  items: AuditItem[]     // 추출 및 매칭된 항목들
  error?: string
}

interface AuditItem {
  id: string
  extracted_name: string
  extracted_spec?: string
  extracted_quantity: number
  extracted_unit_price: number
  matched_product?: {
    id: string
    product_name: string
    standard_price: number
  }
  match_score?: number
  match_status: 'auto_matched' | 'pending' | 'unmatched'
  match_candidates?: MatchCandidate[]
  loss_amount?: number
}

interface MatchCandidate {
  id: string
  product_name: string
  standard_price: number
  match_score: number
}
```

**구현 로직**:
```
1. Image Upload (Supabase Storage)
   └── /invoice-images/{session_id}/{page_number}.jpg

2. Gemini OCR (lib/gemini.ts)
   ├── Prompt: 거래명세서 품목 추출
   └── Output: { items: [{ name, spec, qty, price }] }

3. Fuzzy Matching (lib/matching.ts)
   ├── 각 품목에 대해 pg_trgm similarity 검색
   ├── supplier 필터링 (세션의 supplier 사용)
   └── 3-Tier 분류:
       ├── > 0.8: auto_matched (상위 1개 선택)
       ├── 0.3 ~ 0.8: pending (상위 5개 후보)
       └── < 0.3: unmatched

4. DB Insert (audit_items)
   ├── extracted_* 필드 저장
   ├── matched_product_id 연결
   ├── match_candidates JSON 저장
   └── loss_amount 계산

5. Response 반환
```

**Timeout 예산** (총 10초):
| 단계 | 예상 시간 | 비고 |
|------|----------|------|
| Image Upload | 1-2초 | Base64 → Storage |
| Gemini OCR | 3-5초 | Vision API 호출 |
| Fuzzy Matching | 1-2초 | 품목당 ~200ms × 10개 |
| DB Insert | 0.5초 | Batch INSERT |
| **총합** | **5.5-9.5초** | ✅ 10초 내 |

---

### 3.3 `GET /api/products/search`

**목적**: 수동 매칭을 위한 Fuzzy 검색

**Request (Query Params)**:
```typescript
interface SearchParams {
  q: string              // 검색어
  supplier?: 'CJ' | 'SHINSEGAE'
  limit?: number         // 기본값: 10
}
```

**Response**:
```typescript
interface SearchResponse {
  success: boolean
  products: {
    id: string
    product_name: string
    standard_price: number
    unit_normalized: string
    spec_quantity?: number
    spec_unit?: string
    match_score: number
  }[]
}
```

**SQL 쿼리**:
```sql
SELECT
  id,
  product_name,
  standard_price,
  unit_normalized,
  spec_quantity,
  spec_unit,
  similarity(product_name, $1) as match_score
FROM products
WHERE
  ($2 IS NULL OR supplier = $2)
  AND similarity(product_name, $1) > 0.1
ORDER BY match_score DESC
LIMIT $3;
```

---

## 4. 라이브러리 모듈 상세

### 4.1 `src/lib/gemini.ts`

**목적**: Google Gemini Vision API 래퍼

**환경 변수**:
```env
GOOGLE_GEMINI_API_KEY=your_api_key_here
```

**인터페이스**:
```typescript
// Input
interface GeminiOCRRequest {
  image: string          // Base64 이미지
  supplier: 'CJ' | 'SHINSEGAE'
}

// Output
interface GeminiOCRResponse {
  success: boolean
  items: ExtractedItem[]
  raw_response?: string  // 디버깅용
  error?: string
}

interface ExtractedItem {
  name: string           // 품목명
  spec?: string          // 규격 (있으면)
  quantity: number       // 수량
  unit_price: number     // 단가
  total_price?: number   // 금액 (수량 × 단가)
}
```

**Gemini Prompt 설계**:
```typescript
const EXTRACTION_PROMPT = `
당신은 식자재 거래명세서 OCR 전문가입니다.
이미지에서 품목 리스트를 추출하여 JSON 형식으로 반환하세요.

추출 대상:
- 품목명 (name): 상품 이름
- 규격 (spec): 용량, 무게 등 (없으면 null)
- 수량 (quantity): 숫자만
- 단가 (unit_price): 숫자만 (원 단위)
- 금액 (total_price): 숫자만 (원 단위)

응답 형식:
{
  "items": [
    { "name": "양념치킨소스", "spec": "2kg", "quantity": 5, "unit_price": 12000, "total_price": 60000 },
    { "name": "간장", "spec": null, "quantity": 10, "unit_price": 3500, "total_price": 35000 }
  ]
}

주의사항:
- 숫자에서 콤마(,) 제거
- 합계/소계 행은 제외
- 품목명에 브랜드명이 있으면 포함
- JSON만 반환 (설명 없이)
`;
```

**구현 핵심**:
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function extractItemsFromImage(
  request: GeminiOCRRequest
): Promise<GeminiOCRResponse> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent([
    { text: EXTRACTION_PROMPT },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: request.image  // Base64
      }
    }
  ])

  const text = result.response.text()
  // JSON 파싱 및 유효성 검사
  // ...
}
```

---

### 4.2 `src/lib/matching.ts`

**목적**: pg_trgm 기반 Fuzzy Matching 로직

**인터페이스**:
```typescript
// Input
interface MatchRequest {
  item_name: string
  supplier: 'CJ' | 'SHINSEGAE'
}

// Output
interface MatchResult {
  status: 'auto_matched' | 'pending' | 'unmatched'
  best_match?: ProductMatch
  candidates?: ProductMatch[]
}

interface ProductMatch {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity?: number
  spec_unit?: string
  match_score: number
}
```

**3-Tier 매칭 로직**:
```typescript
export async function findMatches(
  request: MatchRequest,
  supabase: SupabaseClient
): Promise<MatchResult> {
  // pg_trgm similarity 쿼리
  const { data: candidates } = await supabase
    .rpc('search_products_fuzzy', {
      search_term: request.item_name,
      supplier_filter: request.supplier,
      limit_count: 5
    })

  if (!candidates || candidates.length === 0) {
    return { status: 'unmatched' }
  }

  const topScore = candidates[0].match_score

  // Tier 1: 자동 매칭 (> 0.8)
  if (topScore > 0.8) {
    return {
      status: 'auto_matched',
      best_match: candidates[0],
      candidates: candidates.slice(1)  // 나머지 후보
    }
  }

  // Tier 2: 후보 제시 (0.3 ~ 0.8)
  if (topScore >= 0.3) {
    return {
      status: 'pending',
      candidates: candidates
    }
  }

  // Tier 3: 매칭 없음 (< 0.3)
  return { status: 'unmatched' }
}
```

**Supabase RPC 함수** (DB에 생성 필요):
```sql
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term TEXT,
  supplier_filter TEXT,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  standard_price INTEGER,
  unit_normalized TEXT,
  spec_quantity DECIMAL,
  spec_unit TEXT,
  match_score REAL
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.product_name,
    p.standard_price,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    similarity(p.product_name, search_term) as match_score
  FROM products p
  WHERE
    p.supplier = supplier_filter
    AND similarity(p.product_name, search_term) > 0.1
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;
```

---

## 5. 타입 정의

### 5.1 `src/types/audit.ts`

```typescript
// 공급사 타입
export type Supplier = 'CJ' | 'SHINSEGAE'

// 매칭 상태
export type MatchStatus = 'auto_matched' | 'pending' | 'manual_matched' | 'unmatched'

// OCR 추출 품목
export interface ExtractedItem {
  name: string
  spec?: string
  quantity: number
  unit_price: number
  total_price?: number
}

// 매칭 후보
export interface MatchCandidate {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity?: number
  spec_unit?: string
  match_score: number
}

// 감사 항목 (DB 레코드)
export interface AuditItem {
  id: string
  session_id: string
  file_id?: string
  extracted_name: string
  extracted_spec?: string
  extracted_quantity: number
  extracted_unit_price: number
  extracted_total_price?: number
  matched_product_id?: string
  match_score?: number
  match_candidates?: MatchCandidate[]
  match_status: MatchStatus
  standard_price?: number
  price_difference?: number
  loss_amount?: number
  page_number?: number
  row_index?: number
  is_flagged: boolean
  user_note?: string
  created_at: string
  updated_at: string
}

// 감사 세션 (DB 레코드)
export interface AuditSession {
  id: string
  name: string
  supplier: Supplier
  status: 'processing' | 'completed' | 'error'
  total_items: number
  matched_items: number
  pending_items: number
  unmatched_items: number
  total_billed: number
  total_standard: number
  total_loss: number
  created_at: string
  updated_at: string
}

// API Request/Response 타입
export interface InitSessionRequest {
  name: string
  supplier: Supplier
  total_pages: number
}

export interface InitSessionResponse {
  success: boolean
  session_id: string
  message?: string
}

export interface AnalyzePageRequest {
  session_id: string
  page_number: number
  image: string  // Base64
}

export interface AnalyzePageResponse {
  success: boolean
  page_number: number
  items: AuditItem[]
  error?: string
}

export interface SearchProductsParams {
  q: string
  supplier?: Supplier
  limit?: number
}

export interface SearchProductsResponse {
  success: boolean
  products: MatchCandidate[]
}
```

---

## 6. 테스트 스크립트

### 6.1 `scripts/test-phase2.ts`

**목적**: 로컬 이미지로 전체 파이프라인 E2E 테스트

**실행 방법**:
```bash
npx tsx scripts/test-phase2.ts ./test-invoice.jpg
```

**테스트 시나리오**:
```typescript
import fs from 'fs'
import path from 'path'

const API_BASE = 'http://localhost:3000/api'

async function testPhase2(imagePath: string) {
  console.log('🧪 Phase 2 E2E 테스트 시작\n')

  // 1. 이미지 파일 읽기
  const imageBuffer = fs.readFileSync(imagePath)
  const base64Image = imageBuffer.toString('base64')
  console.log(`✅ 이미지 로드: ${path.basename(imagePath)} (${imageBuffer.length} bytes)\n`)

  // 2. 세션 생성
  console.log('📋 Step 1: 세션 생성...')
  const initRes = await fetch(`${API_BASE}/session/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '테스트 세션',
      supplier: 'CJ',
      total_pages: 1
    })
  })
  const initData = await initRes.json()
  console.log(`   Session ID: ${initData.session_id}\n`)

  // 3. 페이지 분석
  console.log('🔍 Step 2: 페이지 분석 (OCR + Matching)...')
  const analyzeRes = await fetch(`${API_BASE}/analyze/page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: initData.session_id,
      page_number: 1,
      image: base64Image
    })
  })
  const analyzeData = await analyzeRes.json()

  if (!analyzeData.success) {
    console.error(`❌ 분석 실패: ${analyzeData.error}`)
    return
  }

  console.log(`   추출된 품목: ${analyzeData.items.length}개\n`)

  // 4. 결과 출력
  console.log('📊 Step 3: 결과 요약')
  console.log('─'.repeat(80))

  let autoMatched = 0
  let pending = 0
  let unmatched = 0

  for (const item of analyzeData.items) {
    const statusIcon = {
      'auto_matched': '🟢',
      'pending': '🟡',
      'unmatched': '🔴'
    }[item.match_status]

    console.log(`${statusIcon} ${item.extracted_name}`)
    console.log(`   수량: ${item.extracted_quantity}, 청구단가: ${item.extracted_unit_price.toLocaleString()}원`)

    if (item.matched_product) {
      console.log(`   매칭: ${item.matched_product.product_name}`)
      console.log(`   기준단가: ${item.matched_product.standard_price.toLocaleString()}원`)
      console.log(`   손실액: ${(item.loss_amount ?? 0).toLocaleString()}원`)
    }

    if (item.match_candidates?.length) {
      console.log(`   후보: ${item.match_candidates.length}개`)
    }

    console.log('')

    if (item.match_status === 'auto_matched') autoMatched++
    else if (item.match_status === 'pending') pending++
    else unmatched++
  }

  // 5. 통계
  console.log('─'.repeat(80))
  console.log('📈 매칭 통계:')
  console.log(`   🟢 자동 매칭: ${autoMatched}건`)
  console.log(`   🟡 후보 제시: ${pending}건`)
  console.log(`   🔴 매칭 없음: ${unmatched}건`)
  console.log('')

  // 6. Fuzzy 검색 테스트
  console.log('🔎 Step 4: Fuzzy 검색 API 테스트...')
  const searchRes = await fetch(
    `${API_BASE}/products/search?q=치킨소스&supplier=CJ&limit=5`
  )
  const searchData = await searchRes.json()
  console.log(`   검색 결과: ${searchData.products.length}개`)
  for (const p of searchData.products.slice(0, 3)) {
    console.log(`   - ${p.product_name} (${(p.match_score * 100).toFixed(1)}%)`)
  }

  console.log('\n✅ Phase 2 테스트 완료!')
}

// CLI 실행
const imagePath = process.argv[2]
if (!imagePath) {
  console.error('사용법: npx tsx scripts/test-phase2.ts <이미지경로>')
  process.exit(1)
}

testPhase2(imagePath).catch(console.error)
```

---

## 7. 환경 변수

### 7.1 필요한 환경 변수

```env
# 기존 (Phase 1에서 설정됨)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Phase 2 추가
GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 7.2 Gemini API 키 발급

1. https://aistudio.google.com/app/apikey 접속
2. "Create API key" 클릭
3. `.env.local`에 추가

---

## 8. DB 마이그레이션 (추가)

### 8.1 RPC 함수 생성

파일: `supabase/migrations/005_rpc_functions.sql`

```sql
-- Fuzzy Matching RPC 함수
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term TEXT,
  supplier_filter TEXT,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  standard_price INTEGER,
  unit_normalized TEXT,
  spec_quantity DECIMAL,
  spec_unit TEXT,
  match_score REAL
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.product_name,
    p.standard_price,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    similarity(p.product_name, search_term) as match_score
  FROM products p
  WHERE
    p.supplier = supplier_filter
    AND similarity(p.product_name, search_term) > 0.1
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 세션 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_session_stats(session_uuid UUID)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE audit_sessions
  SET
    total_items = (
      SELECT COUNT(*) FROM audit_items WHERE session_id = session_uuid
    ),
    matched_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'auto_matched'
    ),
    pending_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'pending'
    ),
    unmatched_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'unmatched'
    ),
    total_billed = (
      SELECT COALESCE(SUM(extracted_unit_price * extracted_quantity), 0)
      FROM audit_items WHERE session_id = session_uuid
    ),
    total_standard = (
      SELECT COALESCE(SUM(standard_price * extracted_quantity), 0)
      FROM audit_items
      WHERE session_id = session_uuid AND matched_product_id IS NOT NULL
    ),
    total_loss = (
      SELECT COALESCE(SUM(loss_amount), 0)
      FROM audit_items
      WHERE session_id = session_uuid AND loss_amount > 0
    ),
    updated_at = now()
  WHERE id = session_uuid;
END;
$$;
```

---

## 9. 구현 순서 (체크리스트)

### Phase 2.1: 기반 작업
- [ ] 환경 변수 설정 (`GOOGLE_GEMINI_API_KEY`)
- [ ] Supabase RPC 함수 생성 (005 마이그레이션)
- [ ] Supabase Storage 버킷 확인 (`invoice-images`)

### Phase 2.2: 라이브러리 구현
- [ ] `src/types/audit.ts` - 타입 정의
- [ ] `src/lib/gemini.ts` - Gemini OCR 래퍼
- [ ] `src/lib/matching.ts` - Fuzzy Matching 로직

### Phase 2.3: API 엔드포인트 구현
- [ ] `POST /api/session/init` - 세션 생성
- [ ] `POST /api/analyze/page` - 페이지 분석 (핵심)
- [ ] `GET /api/products/search` - Fuzzy 검색

### Phase 2.4: 테스트 및 검증
- [ ] `scripts/test-phase2.ts` - E2E 테스트 스크립트
- [ ] 실제 거래명세서 이미지로 테스트
- [ ] 매칭 품질 검증

---

## 10. 성공 기준

| 항목 | 기준 |
|------|------|
| API 응답 시간 | `/api/analyze/page` < 10초 |
| OCR 정확도 | 품목명 추출 > 90% |
| 매칭 정확도 | Auto-matched 중 오매칭 < 5% |
| 테스트 통과 | `test-phase2.ts` 정상 실행 |

---

*작성일: 2026-02-01*
*Phase 2 설계 완료 ✅*
