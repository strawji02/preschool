# 식자재 단가 감사 시스템 - DB 스키마 설계 계획

> **상태**: 설계 확정 (2026-02-01)
> **결정사항**: 사용자 피드백 반영 완료

---

## 1. 데이터 분석 결과 요약

### CJ Freshway 단가표
| 항목 | 값 |
|------|-----|
| **총 상품 수** | 15,806개 |
| **주요 컬럼** | 상품코드, 상품명, 단가, **판매단가** ✓, 상세분류, 온도조건, 원산지 |
| **단위 종류** | EA (14,111), BOX (824), KG (686), PAC (185) |
| **온도조건** | 실온 (6,867), 냉동 (4,741), 냉장 (4,198) |
| **과/면세** | 과세 (11,459), 면세 (4,347) |
| **카테고리 수** | 576개 상세분류 |
| **규격 위치** | 상품명에 포함 (예: "백설 밀가루(강력_1등 20Kg/EA)") |

### 신세계푸드 단가표
| 항목 | 값 |
|------|-----|
| **총 상품 수** | 8,060개 |
| **주요 컬럼** | 코드, 품목명, **결정단가** ✓, 규격, 카테고리, 품목군, 원산지 |
| **단위 종류** | 개 (3,929), 팩 (1,634), 박스 (862), 봉 (852), kg (748) 등 |
| **카테고리** | 가공 (4,580), 소모품 (1,886), 농산 (840), 축산 (427), 수산 (327) |
| **과면세** | 과세 (6,206), 면세 (1,854) |
| **규격 위치** | 별도 컬럼 (예: "1KG", "500G", "45G*20개*6팩") |

---

## 2. 핵심 설계 결정사항

### 2.1 단일 통합 테이블 (`products`)

**결정**: 두 공급사 데이터를 단일 테이블에 통합

**근거**:
1. 두 공급사만 지원 (확장 예정 없음)
2. Fuzzy Matching 시 단일 테이블이 쿼리 효율적
3. 공급사 간 가격 비교 시 JOIN 불필요
4. 컬럼 통일화로 코드 복잡도 감소

### 2.2 기준단가 결정

| 공급사 | 사용 컬럼 | 비고 |
|--------|----------|------|
| **CJ** | `판매단가` | 할인 적용 후 실제 판매가 |
| **신세계** | `결정단가` | 확정 단가 |

### 2.3 데이터 보관 정책

- **마스터 데이터 (products)**: 최신 단가만 유지, 이력 관리 없음
- **감사 데이터 (audit_*)**: 최신 세션만 유지, 히스토리 불필요
- **인증**: 추후 결정 (MVP는 인증 없이 진행)

---

## 3. 단위 정규화 전략 ⭐

### 3.1 듀얼 컬럼 구조

```sql
unit_raw TEXT,           -- 원본: '개', 'EA', 'kg', '봉'
unit_normalized TEXT,    -- 정규화: 'EA', 'KG', 'BOX'
```

### 3.2 정규화 매핑 테이블

```sql
CREATE TABLE unit_mappings (
  id SERIAL PRIMARY KEY,
  raw_unit TEXT NOT NULL UNIQUE,
  normalized_unit TEXT NOT NULL,
  unit_category TEXT NOT NULL  -- 'COUNT', 'WEIGHT', 'VOLUME', 'PACKAGE'
);

-- 초기 매핑 데이터
INSERT INTO unit_mappings (raw_unit, normalized_unit, unit_category) VALUES
-- COUNT (개수 단위)
('EA', 'EA', 'COUNT'),
('ea', 'EA', 'COUNT'),
('개', 'EA', 'COUNT'),
('마리', 'EA', 'COUNT'),
('판', 'EA', 'COUNT'),
('SET', 'SET', 'COUNT'),

-- WEIGHT (무게 단위)
('KG', 'KG', 'WEIGHT'),
('kg', 'KG', 'WEIGHT'),
('키로', 'KG', 'WEIGHT'),
('G', 'G', 'WEIGHT'),
('g', 'G', 'WEIGHT'),
('그램', 'G', 'WEIGHT'),

-- PACKAGE (포장 단위)
('BOX', 'BOX', 'PACKAGE'),
('box', 'BOX', 'PACKAGE'),
('박스', 'BOX', 'PACKAGE'),
('상', 'BOX', 'PACKAGE'),
('팩', 'PACK', 'PACKAGE'),
('PAC', 'PACK', 'PACKAGE'),
('봉', 'BAG', 'PACKAGE'),
('포', 'BAG', 'PACKAGE'),

-- VOLUME (부피 단위)
('L', 'L', 'VOLUME'),
('l', 'L', 'VOLUME'),
('ML', 'ML', 'VOLUME'),
('ml', 'ML', 'VOLUME'),
('병', 'BOTTLE', 'VOLUME'),
('페트', 'BOTTLE', 'VOLUME');
```

### 3.3 정규화 함수 (TypeScript)

```typescript
const UNIT_MAPPING: Record<string, string> = {
  // COUNT
  'EA': 'EA', 'ea': 'EA', '개': 'EA', '마리': 'EA', '판': 'EA',
  // WEIGHT
  'KG': 'KG', 'kg': 'KG', '키로': 'KG',
  'G': 'G', 'g': 'G', '그램': 'G',
  // PACKAGE
  'BOX': 'BOX', 'box': 'BOX', '박스': 'BOX', '상': 'BOX',
  'PAC': 'PACK', '팩': 'PACK',
  '봉': 'BAG', '포': 'BAG',
  // VOLUME
  'L': 'L', 'l': 'L', 'ML': 'ML', 'ml': 'ML',
  '병': 'BOTTLE', '페트': 'BOTTLE',
};

function normalizeUnit(rawUnit: string): string {
  return UNIT_MAPPING[rawUnit.trim()] ?? rawUnit.toUpperCase();
}
```

---

## 4. 규격 파싱 전략 ⭐

### 4.1 CJ 데이터: 상품명에서 추출

**핵심 규칙**: 마지막 총 패키지 무게만 추출 (내부 구성품 무게 무시)

```
✅ "오뚜기 케찹(9g*1000개입 1회용 9Kg/BOX)" → 9KG (O)
❌ "오뚜기 케찹(9g*1000개입 1회용 9Kg/BOX)" → 9g (X, 내부 구성품)
```

**파싱 성공률**: 99% (200개 샘플 테스트)

```typescript
interface ParsedSpec {
  quantity: number;
  unit: string;
  package?: string;
  raw?: string;
  parseFailed?: boolean;
}

function parseCJSpec(productName: string): ParsedSpec | null {
  // 패턴 1: 숫자+단위/포장단위 (20Kg/EA, 9Kg/BOX)
  const pattern1 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\s*\/\s*([A-Za-z]+)\)?$/;
  let match = productName.match(pattern1);
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      package: match[3].toUpperCase()
    };
  }

  // 패턴 2: 숫자+단위 포장단위 - 슬래시 없음 (22kg EA)
  const pattern2 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\s+([A-Za-z]+)\)?$/;
  match = productName.match(pattern2);
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      package: match[3].toUpperCase()
    };
  }

  // 패턴 3: 마지막 숫자+단위만 (fallback)
  const pattern3 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\)?$/;
  match = productName.match(pattern3);
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase()
    };
  }

  return { raw: productName, parseFailed: true };
}
```

### 4.2 신세계 데이터: 규격 컬럼 직접 사용

**파싱 성공률**: 99.7% (8,060개 전체 테스트)

```typescript
function parseShinsegaeSpec(spec: string): ParsedSpec | null {
  if (!spec) return null;
  spec = spec.trim();

  // 패턴 1: 단순 숫자+단위 (1KG, 500G, 1.5L)
  const pattern1 = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/;
  let match = spec.match(pattern1);
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: match[2].toUpperCase()
    };
  }

  // 패턴 2: 복합 곱셈 (45G*20개*6팩 → 총량 계산)
  const pattern2 = /^(\d+(?:[.,]\d+)?)\s*([GgKkMmLl]+)\s*\*\s*(\d+)/;
  match = spec.match(pattern2);
  if (match) {
    let baseQty = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    let multiplier = parseInt(match[3]);

    // 추가 곱셈 처리 (45G*20개*6팩)
    const remaining = spec.substring(match[0].length);
    const multMatches = remaining.matchAll(/\*\s*(\d+)/g);
    for (const m of multMatches) {
      multiplier *= parseInt(m[1]);
    }

    return {
      quantity: baseQty * multiplier,
      unit: unit,
      raw: spec
    };
  }

  // 패턴 3: "개당" prefix 제거 후 파싱
  const pattern3 = /개당\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)/i;
  match = spec.match(pattern3);
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: match[2].toUpperCase()
    };
  }

  // 패턴 4: 범위 표현 (0.8~1.2KG → 중간값)
  const pattern4 = /^(\d+(?:[.,]\d+)?)\s*~\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/;
  match = spec.match(pattern4);
  if (match) {
    const min = parseFloat(match[1].replace(',', '.'));
    const max = parseFloat(match[2].replace(',', '.'));
    return {
      quantity: (min + max) / 2,
      unit: match[3].toUpperCase(),
      raw: spec
    };
  }

  // 패턴 5: 쉼표로 구분된 복합 정보에서 첫 번째 추출
  const pattern5 = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)/;
  match = spec.match(pattern5);
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: match[2].toUpperCase()
    };
  }

  return { raw: spec, parseFailed: true };
}
```

### 4.3 파싱 실패 처리

```typescript
// 파싱 실패 시 플래그 설정
if (result.parseFailed) {
  // DB에 raw 값 저장 + parse_failed = true
  // UI에서 수동 확인 필요 표시
}
```

**파싱 실패 엣지 케이스**:
- CJ: `"유산지(PE코팅_270*170mm_1000입 EA)"` (크기 정보, 무게 아님)
- 신세계: `"망고 34%, 용과 33%"` (구성 비율)

---

## 5. Fuzzy Matching 전략 ⭐

### 5.1 3단계 티어 전략

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟢 Tier 1: similarity > 0.8 (80%)                               │
│    → 자동 매칭 (Auto-select best match)                          │
│    → UI: 녹색 배경, 사용자가 변경 가능                             │
├─────────────────────────────────────────────────────────────────┤
│ 🟡 Tier 2: similarity 0.3 ~ 0.8 (30-80%)                        │
│    → 후보 제시 (Show top 3 candidates)                           │
│    → UI: 노란색 배경, 드롭다운에서 선택                            │
├─────────────────────────────────────────────────────────────────┤
│ 🔴 Tier 3: similarity < 0.3 (30%)                               │
│    → 매칭 없음 (No match found)                                  │
│    → UI: 빨간색 배경, 수동 검색 필요                               │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 매칭 쿼리

```sql
-- Top 5 후보 조회 (similarity > 0.3)
SELECT
  id,
  product_name,
  standard_price,
  unit_normalized,
  spec_quantity,
  spec_unit,
  similarity(product_name, $1) as match_score
FROM products
WHERE supplier = $2
  AND similarity(product_name, $1) > 0.3
ORDER BY match_score DESC
LIMIT 5;
```

### 5.3 매칭 상태 관리

```sql
-- audit_items.match_status
'auto_matched'    -- Tier 1: 자동 매칭됨 (score > 0.8)
'pending'         -- Tier 2: 후보 있음, 사용자 확인 대기
'manual_matched'  -- 사용자가 수동으로 매칭 완료
'unmatched'       -- Tier 3: 매칭 없음
```

---

## 6. 테이블 스키마 (최종)

### 6.1 `unit_mappings` (단위 매핑)

```sql
CREATE TABLE unit_mappings (
  id SERIAL PRIMARY KEY,
  raw_unit TEXT NOT NULL UNIQUE,
  normalized_unit TEXT NOT NULL,
  unit_category TEXT NOT NULL
);
```

### 6.2 `products` (마스터 상품)

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL CHECK (supplier IN ('CJ', 'SHINSEGAE')),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,

  -- 가격 (CJ: 판매단가, 신세계: 결정단가)
  standard_price INTEGER NOT NULL,

  -- 단위 (듀얼 컬럼)
  unit_raw TEXT NOT NULL,
  unit_normalized TEXT NOT NULL,

  -- 규격 (파싱 결과)
  spec_raw TEXT,
  spec_quantity DECIMAL(10, 2),
  spec_unit TEXT,
  spec_parse_failed BOOLEAN DEFAULT false,

  -- 카테고리
  category TEXT,
  subcategory TEXT,

  -- 추가 정보
  origin TEXT,
  tax_type TEXT CHECK (tax_type IN ('과세', '면세')),
  storage_temp TEXT,
  order_deadline TEXT,
  supply_status TEXT DEFAULT '가능',

  -- 검색 최적화
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(product_name, ''))
  ) STORED,

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(supplier, product_code)
);

-- 인덱스
CREATE INDEX idx_products_supplier ON products(supplier);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_unit_normalized ON products(unit_normalized);
CREATE INDEX idx_products_spec_unit ON products(spec_unit);
CREATE INDEX idx_products_name_trgm ON products USING gin (product_name gin_trgm_ops);
CREATE INDEX idx_products_search ON products USING gin (search_vector);
CREATE INDEX idx_products_parse_failed ON products(spec_parse_failed) WHERE spec_parse_failed = true;
```

### 6.3 `audit_sessions` (감사 세션)

```sql
CREATE TABLE audit_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  supplier TEXT NOT NULL CHECK (supplier IN ('CJ', 'SHINSEGAE')),
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),

  -- 통계
  total_items INTEGER DEFAULT 0,
  matched_items INTEGER DEFAULT 0,
  pending_items INTEGER DEFAULT 0,
  unmatched_items INTEGER DEFAULT 0,

  -- 금액 요약
  total_billed DECIMAL(12, 2) DEFAULT 0,
  total_standard DECIMAL(12, 2) DEFAULT 0,
  total_loss DECIMAL(12, 2) DEFAULT 0,  -- 부당 청구액 (양수)

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_sessions_status ON audit_sessions(status);
CREATE INDEX idx_audit_sessions_created ON audit_sessions(created_at DESC);
```

### 6.4 `audit_files` (업로드 파일)

```sql
CREATE TABLE audit_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  page_count INTEGER,
  ocr_status TEXT DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processing', 'completed', 'error')),
  ocr_raw_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_files_session ON audit_files(session_id);
CREATE INDEX idx_audit_files_status ON audit_files(ocr_status);
```

### 6.5 `audit_items` (감사 항목)

```sql
CREATE TABLE audit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  file_id UUID REFERENCES audit_files(id) ON DELETE SET NULL,

  -- OCR 추출 데이터
  extracted_name TEXT NOT NULL,
  extracted_spec TEXT,
  extracted_quantity DECIMAL(10, 2) NOT NULL,
  extracted_unit_price DECIMAL(10, 2) NOT NULL,
  extracted_total_price DECIMAL(12, 2),

  -- 매칭 결과
  matched_product_id UUID REFERENCES products(id),
  match_score DECIMAL(5, 4),
  match_candidates JSONB,  -- Top 5 후보 저장
  match_status TEXT DEFAULT 'pending' CHECK (
    match_status IN ('auto_matched', 'pending', 'manual_matched', 'unmatched')
  ),

  -- 감사 계산 결과
  standard_price DECIMAL(10, 2),
  price_difference DECIMAL(10, 2),  -- 청구단가 - 기준단가
  loss_amount DECIMAL(12, 2),        -- price_difference * quantity

  -- 메타데이터
  page_number INTEGER,
  row_index INTEGER,
  is_flagged BOOLEAN DEFAULT false,
  user_note TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_items_session ON audit_items(session_id);
CREATE INDEX idx_audit_items_matched ON audit_items(matched_product_id);
CREATE INDEX idx_audit_items_status ON audit_items(match_status);
CREATE INDEX idx_audit_items_flagged ON audit_items(is_flagged) WHERE is_flagged = true;
```

---

## 7. 컬럼 매핑 (최종)

| 통합 컬럼명 | CJ 원본 | 신세계 원본 | 타입 |
|------------|---------|------------|------|
| `supplier` | 'CJ' | 'SHINSEGAE' | TEXT |
| `product_code` | 상품코드 | 코드 | TEXT |
| `product_name` | 상품명 | 품목명 | TEXT |
| `standard_price` | **판매단가** | **결정단가** | INTEGER |
| `unit_raw` | 단위 | 단위 | TEXT |
| `unit_normalized` | (정규화) | (정규화) | TEXT |
| `spec_raw` | (상품명에서 추출) | 규격 | TEXT |
| `spec_quantity` | (파싱) | (파싱) | DECIMAL |
| `spec_unit` | (파싱) | (파싱) | TEXT |
| `category` | 상세분류 | 카테고리 | TEXT |
| `subcategory` | - | 품목군 | TEXT |
| `origin` | 원산지 | 원산지 | TEXT |
| `tax_type` | 과/면세 | 과면세 | TEXT |
| `storage_temp` | 온도조건 | - | TEXT |
| `order_deadline` | 마감일+마감시간 | 발주구분 | TEXT |

---

## 8. Supabase 설정

### 8.1 필수 확장

```sql
-- pg_trgm: Fuzzy Matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID 생성
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 유사도 임계값 설정 (0.3 = 30%)
SET pg_trgm.similarity_threshold = 0.3;
```

### 8.2 Storage 버킷

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-pdfs', 'invoice-pdfs', false);
```

### 8.3 RLS (Row Level Security)

```sql
-- MVP: RLS 비활성화 (추후 인증 추가 시 활성화)
-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
```

---

## 9. 데이터 플로우

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. PDF Upload                                                    │
│    → audit_sessions 생성                                         │
│    → audit_files 저장 (Storage bucket)                           │
├─────────────────────────────────────────────────────────────────┤
│ 2. OCR Processing (Gemini Vision)                                │
│    → 품목명, 규격, 수량, 단가 추출                                 │
│    → audit_items 생성 (extracted_* 필드)                         │
├─────────────────────────────────────────────────────────────────┤
│ 3. Fuzzy Matching (pg_trgm)                                      │
│    → Top 5 후보 조회 (similarity > 0.3)                          │
│    → 티어별 상태 설정:                                            │
│       > 0.8: auto_matched                                        │
│       0.3~0.8: pending (후보 저장)                                │
│       < 0.3: unmatched                                           │
├─────────────────────────────────────────────────────────────────┤
│ 4. 손실액 계산                                                    │
│    → price_difference = extracted_unit_price - standard_price    │
│    → loss_amount = price_difference * extracted_quantity         │
├─────────────────────────────────────────────────────────────────┤
│ 5. UI 표시                                                       │
│    → Split View: PDF Viewer + Data Grid                          │
│    → 티어별 색상 표시 (녹/황/적)                                   │
│    → 수동 매칭 UI (드롭다운/검색)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. 구현 순서

### Phase 1: DB 셋업
1. Supabase 프로젝트 생성
2. 확장 활성화 (pg_trgm, uuid-ossp)
3. 테이블 생성 (unit_mappings → products → audit_*)
4. 인덱스 생성
5. **seed.ts 스크립트 작성**:
   - Excel 파일 읽기 (CJ, 신세계)
   - 단위 정규화 적용
   - 규격 파싱 적용
   - products 테이블에 INSERT

### Phase 2: API 개발
1. `/api/products/search` - Fuzzy 검색
2. `/api/upload` - PDF 업로드 + 세션 생성
3. `/api/ocr` - Gemini Vision 호출
4. `/api/match` - 자동 매칭 수행
5. `/api/audit/[id]` - 감사 결과 CRUD

### Phase 3: UI 구현
1. `/calc-food` 페이지 레이아웃
2. PDF Viewer (Split View 좌측)
3. Data Grid (Split View 우측)
4. 티어별 색상 하이라이팅
5. 매칭 드롭다운/검색 UI
6. 통계 요약 패널

---

## 11. 예상 데이터 규모

| 테이블 | 예상 규모 | 비고 |
|--------|----------|------|
| `products` | ~24,000 rows | CJ 15,806 + 신세계 8,060 |
| `unit_mappings` | ~30 rows | 정적 매핑 |
| `audit_sessions` | 월 ~100 | 최신만 유지 |
| `audit_items` | 세션당 ~200 | 월 ~20,000 |

---

*작성일: 2026-02-01*
*상태: 설계 확정 ✅*
