# 식자재 단가 비교 시스템 개선 플랜

## 📋 요구사항 요약 (식자재 단가 비교시스템_수정_0206)

### 1. 거래명세서 기능 강화
- **엑셀 다운로드**: 거래명세서 원본 데이터 엑셀 출력
- **재리딩 기능**: 확정된 항목 다시 수정 가능하게 변경
- **총액 확인**: 거래명세서 총액 표시 및 검증

### 2. 레이아웃 개선 - 카드 형식
- **3행 구조**: 품목당 3개 행으로 표시
  - 1행: 거래명세서 (원본 데이터)
  - 2행: CJ 매칭 정보
  - 3행: 신세계 매칭 정보
- **카드 디자인**: 구분선과 여백으로 시각적 구조화

### 3. 검색 팝업 개선
- **상위 5개 표시**: 매칭 후보 5개만 표시
- **드래그 가능**: 후보 간 드래그로 순서 변경 가능
- **[없음] 선택 옵션**:
  - 매칭 없음 선택 시 → 단가 0원 표시
  - "점검 필요" 플래그 자동 설정

### 4. 엑셀 다운로드 - 비교표
- **비교표 형식**: CJ vs 신세계 비교 데이터
- **견적 불가 표시**: 매칭 없는 항목 빨간색 하이라이트
- **다운로드 버튼**: ReportStep에 엑셀 다운로드 기능 추가

### 5. ML 학습 시스템
- **골든셋 구축**: 사용자가 확정한 매칭 데이터 저장
- **학습 데이터**: 사용자 수정 내역을 학습 데이터로 활용
- **자동 매칭 개선**: 골든셋 기반 매칭 정확도 향상

---

## 🏗️ 현재 구조 분석

### 타입 시스템 (src/types/audit.ts)
```typescript
✅ ComparisonItem: 비교 아이템 구조 (완료)
  - cj_candidates: SupplierMatch[] (Top 5)
  - ssg_candidates: SupplierMatch[] (Top 5)
  - is_confirmed: boolean (확정 상태)
  - savings: SavingsResult (절감액)

✅ SupplierMatch: 공급사별 매칭 정보
  - ppu: Price Per Unit 포함
  - standard_unit: 표준 단위

⚠️ 추가 필요:
  - needs_review: boolean (점검 필요 플래그)
  - user_selection_order?: number (드래그 순서)
  - golden_set_approved?: boolean (골든셋 승인)
```

### 컴포넌트 구조
```
src/app/calc-food/components/
├── MatchingStep/
│   ├── MatchingView.tsx       ✅ 메인 뷰
│   ├── MatchingRow.tsx        ⚠️ 개선 필요 (카드 레이아웃)
│   ├── CandidateSelector.tsx  ✅ 후보 선택기
│   └── MatchingHeader.tsx     ✅ 헤더
├── ReportStep/
│   ├── ReportView.tsx         ⚠️ 엑셀 다운로드 추가
│   ├── ItemBreakdownTable.tsx ✅ 품목별 분석
│   └── ScenarioComparison.tsx ✅ 시나리오 비교
└── ProductSearchModal.tsx     ⚠️ 개선 필요 (드래그, [없음])
```

### 데이터베이스 (Supabase)
```sql
✅ products 테이블: CJ/신세계 상품 DB
✅ audit_items 테이블: 매칭 결과 저장
✅ audit_sessions 테이블: 세션 관리
⚠️ 추가 필요: golden_set 테이블 (ML 학습용)
```

---

## 🎯 개선 작업 단계

### Phase 1: 타입 시스템 확장 (우선순위: 높음)
**파일**: `src/types/audit.ts`

```typescript
// 1.1 ComparisonItem 타입 확장
export interface ComparisonItem {
  // ... 기존 필드

  // 새 필드 추가
  needs_review: boolean           // 점검 필요 플래그
  user_notes?: string             // 사용자 메모
  golden_set_metadata?: {
    approved: boolean             // 골든셋 승인
    approved_at?: string
    approved_by?: string
  }
}

// 1.2 SupplierMatch 타입 확장
export interface SupplierMatch {
  // ... 기존 필드

  // 사용자 정렬 순서 (드래그)
  user_order?: number
}

// 1.3 엑셀 다운로드용 타입
export interface ExcelExportData {
  type: 'invoice' | 'comparison'
  items: ComparisonItem[]
  summary: {
    total_items: number
    total_our_cost: number
    total_cj_cost?: number
    total_ssg_cost?: number
    total_savings?: number
  }
  scenarios?: SupplierScenario[]
}

// 1.4 골든셋 타입
export interface GoldenSetEntry {
  id: string
  extracted_name: string
  extracted_spec?: string
  matched_product_id: string
  supplier: Supplier
  confidence_score: number
  approved_by?: string
  created_at: string
}
```

**작업 내용**:
- [ ] ComparisonItem에 needs_review, user_notes, golden_set_metadata 추가
- [ ] SupplierMatch에 user_order 추가
- [ ] ExcelExportData 타입 정의
- [ ] GoldenSetEntry 타입 정의

---

### Phase 2: 데이터베이스 스키마 확장 (우선순위: 높음)
**파일**: `supabase/migrations/017_golden_set_and_review_flags.sql`

```sql
-- 2.1 audit_items 테이블 확장
ALTER TABLE audit_items
ADD COLUMN needs_review BOOLEAN DEFAULT FALSE,
ADD COLUMN user_notes TEXT,
ADD COLUMN golden_set_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN golden_set_approved_at TIMESTAMPTZ,
ADD COLUMN golden_set_approved_by TEXT;

-- 2.2 golden_set 테이블 생성
CREATE TABLE golden_set (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_name TEXT NOT NULL,
  extracted_spec TEXT,
  normalized_name TEXT NOT NULL,
  matched_product_id UUID REFERENCES products(id),
  supplier TEXT NOT NULL,
  confidence_score NUMERIC(5, 4),
  match_metadata JSONB,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.3 인덱스 추가
CREATE INDEX idx_golden_set_normalized ON golden_set(normalized_name);
CREATE INDEX idx_golden_set_supplier ON golden_set(supplier);
CREATE INDEX idx_audit_items_needs_review ON audit_items(needs_review) WHERE needs_review = TRUE;

-- 2.4 RPC 함수: 골든셋 기반 매칭 개선
CREATE OR REPLACE FUNCTION match_with_golden_set(
  p_item_name TEXT,
  p_item_spec TEXT DEFAULT NULL
) RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  standard_price NUMERIC,
  supplier TEXT,
  match_score NUMERIC,
  source TEXT -- 'golden_set' | 'fuzzy_match'
) AS $$
BEGIN
  -- 골든셋 우선 검색
  RETURN QUERY
  SELECT
    g.matched_product_id,
    p.product_name,
    p.standard_price,
    g.supplier,
    g.confidence_score,
    'golden_set'::TEXT
  FROM golden_set g
  JOIN products p ON g.matched_product_id = p.id
  WHERE g.normalized_name = normalize_product_name(p_item_name)
  ORDER BY g.confidence_score DESC
  LIMIT 5;

  -- 골든셋에 없으면 기존 fuzzy matching
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p.id,
      p.product_name,
      p.standard_price,
      p.supplier,
      similarity(normalize_product_name(p_item_name), p.product_name_normalized) AS score,
      'fuzzy_match'::TEXT
    FROM products p
    WHERE p.product_name_normalized % normalize_product_name(p_item_name)
    ORDER BY score DESC
    LIMIT 5;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

**작업 내용**:
- [ ] audit_items 테이블에 needs_review, user_notes, golden_set 관련 컬럼 추가
- [ ] golden_set 테이블 생성
- [ ] 인덱스 추가
- [ ] match_with_golden_set RPC 함수 작성

---

### Phase 3: 카드 레이아웃 구현 (우선순위: 높음)
**파일**: `src/app/calc-food/components/MatchingStep/MatchingRow.tsx`

```typescript
'use client'

import { useState } from 'react'
import { Check, AlertCircle, Edit2 } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier, SupplierMatch } from '@/types/audit'
import { CandidateSelector } from './CandidateSelector'

export function MatchingRow({
  item,
  onSelectCandidate,
  onConfirm,
  onSearchClick,
  onToggleReview,    // 새 핸들러
  onEditNotes,       // 새 핸들러
}: MatchingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showNotesModal, setShowNotesModal] = useState(false)

  return (
    <div className={cn(
      "border rounded-lg p-4 mb-4 shadow-sm transition-all",
      item.is_confirmed && "bg-green-50 border-green-200",
      item.needs_review && "border-yellow-400 border-2"
    )}>
      {/* 3행 구조 */}

      {/* 1행: 거래명세서 (원본) */}
      <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 p-3 bg-gray-50 rounded mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{item.extracted_name}</span>
          {item.extracted_spec && (
            <span className="text-sm text-gray-500">({item.extracted_spec})</span>
          )}
          {item.needs_review && (
            <AlertCircle className="text-yellow-500" size={16} />
          )}
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-600">수량:</span>
          <span className="ml-2 font-medium">{item.extracted_quantity}</span>
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-600">단가:</span>
          <span className="ml-2 font-medium">{formatCurrency(item.extracted_unit_price)}</span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setShowNotesModal(true)}
            className="p-1 hover:bg-gray-200 rounded"
            title="메모 추가"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onToggleReview(item.id)}
            className={cn(
              "px-2 py-1 text-xs rounded",
              item.needs_review
                ? "bg-yellow-100 text-yellow-700"
                : "bg-gray-200 text-gray-600"
            )}
          >
            {item.needs_review ? "점검" : "정상"}
          </button>
        </div>
      </div>

      {/* 2행: CJ 매칭 */}
      <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 p-3 border-l-4 border-orange-400 bg-orange-50/30 rounded mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-orange-600">CJ</span>
          {item.cj_match ? (
            <span className="text-sm">{item.cj_match.product_name}</span>
          ) : (
            <span className="text-sm text-gray-400">미매칭</span>
          )}
        </div>
        <div className="text-right text-sm">
          {item.cj_match?.standard_unit || '-'}
        </div>
        <div className="text-right font-medium">
          {item.cj_match ? formatCurrency(item.cj_match.standard_price) : '-'}
        </div>
        <div className="flex items-center justify-end">
          <CandidateSelector
            supplier="CJ"
            candidates={item.cj_candidates}
            selectedMatch={item.cj_match}
            onSelect={(candidate) => onSelectCandidate(item.id, 'CJ', candidate)}
            onSearchClick={() => onSearchClick(item, 'CJ')}
            disabled={item.is_confirmed}
          />
        </div>
      </div>

      {/* 3행: 신세계 매칭 */}
      <div className="grid grid-cols-[2fr_1fr_1fr_80px] gap-4 p-3 border-l-4 border-purple-400 bg-purple-50/30 rounded">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-purple-600">SSG</span>
          {item.ssg_match ? (
            <span className="text-sm">{item.ssg_match.product_name}</span>
          ) : (
            <span className="text-sm text-gray-400">미매칭</span>
          )}
        </div>
        <div className="text-right text-sm">
          {item.ssg_match?.standard_unit || '-'}
        </div>
        <div className="text-right font-medium">
          {item.ssg_match ? formatCurrency(item.ssg_match.standard_price) : '-'}
        </div>
        <div className="flex items-center justify-end">
          <CandidateSelector
            supplier="SHINSEGAE"
            candidates={item.ssg_candidates}
            selectedMatch={item.ssg_match}
            onSelect={(candidate) => onSelectCandidate(item.id, 'SHINSEGAE', candidate)}
            onSearchClick={() => onSearchClick(item, 'SHINSEGAE')}
            disabled={item.is_confirmed}
          />
        </div>
      </div>

      {/* 하단: 확정 버튼 */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t">
        <div className="flex items-center gap-4">
          {item.savings.max > 0 && (
            <div className="text-sm">
              <span className="text-gray-600">최대 절감:</span>
              <span className="ml-2 font-bold text-green-600">
                {formatCurrency(item.savings.max)}
              </span>
              {item.savings.best_supplier && (
                <span className="ml-1 text-xs text-gray-500">
                  ({item.savings.best_supplier})
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => onConfirm(item.id)}
          className={cn(
            'px-4 py-2 rounded-lg font-medium transition-colors',
            item.is_confirmed
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          )}
        >
          {item.is_confirmed ? (
            <>
              <Check size={16} className="inline mr-1" />
              확정됨
            </>
          ) : (
            '확정'
          )}
        </button>
      </div>

      {/* 메모 모달 (필요시 구현) */}
      {showNotesModal && (
        <NotesModal
          item={item}
          onClose={() => setShowNotesModal(false)}
          onSave={(notes) => {
            onEditNotes(item.id, notes)
            setShowNotesModal(false)
          }}
        />
      )}
    </div>
  )
}
```

**작업 내용**:
- [ ] MatchingRow를 카드 레이아웃으로 전면 리팩토링
- [ ] 3행 구조 (거래명세서/CJ/신세계) 구현
- [ ] 점검 필요 토글 버튼 추가
- [ ] 메모 추가 기능 구현
- [ ] 시각적 구분 (색상, 보더) 개선

---

### Phase 4: 검색 팝업 개선 (우선순위: 중간)
**파일**: `src/app/calc-food/components/ProductSearchModal.tsx`

**라이브러리 추가**: `npm install @dnd-kit/core @dnd-kit/sortable`

```typescript
'use client'

import { useState, useEffect } from 'react'
import { X, Search, GripVertical, Ban } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatCurrency } from '@/lib/format'
import type { ComparisonItem, MatchCandidate, Supplier } from '@/types/audit'

// 드래그 가능한 결과 항목
function SortableResultItem({
  product,
  onSelect,
  isSelected
}: {
  product: MatchCandidate
  onSelect: () => void
  isSelected: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: product.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
        isSelected ? "bg-blue-50 border-blue-300" : "bg-white hover:bg-gray-50"
      )}
      onClick={onSelect}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="text-gray-400" size={20} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{product.product_name}</div>
        <div className="text-sm text-gray-500">
          {product.spec_quantity && product.spec_unit && (
            <span>{product.spec_quantity}{product.spec_unit}</span>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="font-bold">{formatCurrency(product.standard_price)}</div>
        <div className="text-xs text-gray-500">
          {(product.match_score * 100).toFixed(0)}% 일치
        </div>
      </div>
    </div>
  )
}

export function ProductSearchModal({
  item,
  initialSupplier,
  isOpen,
  onClose,
  onSelect,
}: ProductSearchModalProps) {
  const [results, setResults] = useState<MatchCandidate[]>([])
  const [displayResults, setDisplayResults] = useState<MatchCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 상위 5개로 제한
  useEffect(() => {
    setDisplayResults(results.slice(0, 5))
  }, [results])

  // 드래그 완료 핸들러
  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (active.id !== over.id) {
      setDisplayResults((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id)
        const newIndex = items.findIndex((item) => item.id === over.id)

        const newArray = [...items]
        const [moved] = newArray.splice(oldIndex, 1)
        newArray.splice(newIndex, 0, moved)

        return newArray
      })
    }
  }

  // [없음] 선택 핸들러
  const handleSelectNone = () => {
    const noneCandidate: MatchCandidate = {
      id: 'none',
      product_name: '매칭 없음',
      standard_price: 0,
      unit_normalized: '',
      supplier: initialSupplier || 'CJ',
      match_score: 0,
    }

    onSelect(item.id, noneCandidate, initialSupplier || 'CJ')
    // needs_review 플래그는 부모 컴포넌트에서 처리
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">상품 검색</h3>
            <p className="text-sm text-gray-500">
              원본: <span className="font-medium">{item.extracted_name}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* 검색 영역 */}
        <div className="border-b p-4">
          {/* ... 기존 검색 UI ... */}
        </div>

        {/* 결과 영역 (드래그 가능) */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              상위 {displayResults.length}개 결과 (드래그로 순서 변경)
            </span>
            <button
              onClick={handleSelectNone}
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              <Ban size={16} />
              [없음] 선택
            </button>
          </div>

          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={displayResults.map(r => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {displayResults.map((product) => (
                  <SortableResultItem
                    key={product.id}
                    product={product}
                    isSelected={selectedId === product.id}
                    onSelect={() => {
                      setSelectedId(product.id)
                      onSelect(item.id, product, product.supplier)
                      onClose()
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  )
}
```

**작업 내용**:
- [ ] @dnd-kit 라이브러리 설치
- [ ] 드래그 앤 드롭 기능 구현
- [ ] 상위 5개로 결과 제한
- [ ] [없음] 선택 버튼 추가
- [ ] [없음] 선택 시 needs_review 플래그 설정 로직 추가

---

### Phase 5: 엑셀 다운로드 기능 (우선순위: 중간)
**파일**: `src/lib/excel-export.ts` (새로 생성)

**라이브러리 추가**: `npm install xlsx`

```typescript
import * as XLSX from 'xlsx'
import type { ComparisonItem, SupplierScenario } from '@/types/audit'
import { formatCurrency } from './format'

// 거래명세서 엑셀 다운로드
export function exportInvoiceToExcel(
  items: ComparisonItem[],
  fileName: string
) {
  const worksheetData = [
    // 헤더
    ['품목명', '규격', '수량', '단가', '금액', '상태'],

    // 데이터 행
    ...items.map(item => [
      item.extracted_name,
      item.extracted_spec || '',
      item.extracted_quantity,
      item.extracted_unit_price,
      item.extracted_quantity * item.extracted_unit_price,
      item.is_confirmed ? '확정' : item.needs_review ? '점검필요' : '대기'
    ]),

    // 합계 행
    [],
    [
      '합계',
      '',
      items.reduce((sum, item) => sum + item.extracted_quantity, 0),
      '',
      items.reduce((sum, item) => sum + (item.extracted_quantity * item.extracted_unit_price), 0),
      ''
    ]
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '거래명세서')

  // 파일 다운로드
  XLSX.writeFile(workbook, `${fileName}_거래명세서.xlsx`)
}

// 비교표 엑셀 다운로드
export function exportComparisonToExcel(
  items: ComparisonItem[],
  scenarios: SupplierScenario[],
  fileName: string
) {
  const worksheetData = [
    // 헤더
    [
      '품목명',
      '규격',
      '수량',
      '현재 단가',
      'CJ 상품명',
      'CJ 단가',
      'CJ 절감',
      'SSG 상품명',
      'SSG 단가',
      'SSG 절감',
      '최대 절감',
      '상태'
    ],

    // 데이터 행
    ...items.map(item => {
      const row = [
        item.extracted_name,
        item.extracted_spec || '',
        item.extracted_quantity,
        item.extracted_unit_price,
        item.cj_match?.product_name || '견적불가',
        item.cj_match?.standard_price || 0,
        item.savings.cj,
        item.ssg_match?.product_name || '견적불가',
        item.ssg_match?.standard_price || 0,
        item.savings.ssg,
        item.savings.max,
        item.is_confirmed ? '확정' : item.needs_review ? '점검필요' : '대기'
      ]
      return row
    })
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

  // 스타일링: 견적불가 행 빨간색 (조건부 서식은 xlsx 라이브러리 제약으로 생략)
  // 대신 셀 배경색 설정
  items.forEach((item, index) => {
    const rowIndex = index + 1 // 헤더 다음 행부터
    if (!item.cj_match) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 4 }) // CJ 상품명 열
      if (!worksheet[cellRef]) worksheet[cellRef] = { t: 's', v: '견적불가' }
      worksheet[cellRef].s = { fill: { fgColor: { rgb: 'FFFF0000' } } }
    }
    if (!item.ssg_match) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 7 }) // SSG 상품명 열
      if (!worksheet[cellRef]) worksheet[cellRef] = { t: 's', v: '견적불가' }
      worksheet[cellRef].s = { fill: { fgColor: { rgb: 'FFFF0000' } } }
    }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '비교표')

  // 시나리오 시트 추가
  if (scenarios.length > 0) {
    const scenarioData = [
      ['공급사', '현재 총액', '전환 총액', '절감액', '절감률', '매칭 품목', '미매칭 품목'],
      ...scenarios.map(s => [
        s.supplier,
        s.totalOurCost,
        s.totalSupplierCost,
        s.totalSavings,
        `${s.savingsPercent.toFixed(2)}%`,
        s.matchedCount,
        s.unmatchedCount
      ])
    ]
    const scenarioSheet = XLSX.utils.aoa_to_sheet(scenarioData)
    XLSX.utils.book_append_sheet(workbook, scenarioSheet, '시나리오 분석')
  }

  // 파일 다운로드
  XLSX.writeFile(workbook, `${fileName}_비교표.xlsx`)
}
```

**파일**: `src/app/calc-food/components/ReportStep/ReportView.tsx`

```typescript
// 엑셀 다운로드 버튼 추가
import { Download, FileSpreadsheet } from 'lucide-react'
import { exportInvoiceToExcel, exportComparisonToExcel } from '@/lib/excel-export'

export function ReportView({
  items,
  scenarios,
  fileName,
  // ... 기타 props
}: ReportViewProps) {
  const handleExportInvoice = () => {
    exportInvoiceToExcel(items, fileName)
  }

  const handleExportComparison = () => {
    exportComparisonToExcel(items, scenarios, fileName)
  }

  return (
    <div className="space-y-6">
      {/* 헤더 영역 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">비교 리포트</h2>

        {/* 다운로드 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={handleExportInvoice}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            <FileSpreadsheet size={20} />
            거래명세서 다운로드
          </button>
          <button
            onClick={handleExportComparison}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          >
            <Download size={20} />
            비교표 다운로드
          </button>
        </div>
      </div>

      {/* ... 기존 리포트 컨텐츠 ... */}
    </div>
  )
}
```

**작업 내용**:
- [ ] xlsx 라이브러리 설치
- [ ] excel-export.ts 유틸리티 작성
- [ ] exportInvoiceToExcel 함수 구현
- [ ] exportComparisonToExcel 함수 구현
- [ ] ReportView에 다운로드 버튼 추가
- [ ] 견적불가 항목 빨간색 표시 (셀 스타일링)

---

### Phase 6: ML 학습 시스템 (우선순위: 낮음)
**파일**: `src/lib/golden-set.ts` (새로 생성)

```typescript
import { createClient } from '@/lib/supabase'
import type { ComparisonItem, Supplier, GoldenSetEntry } from '@/types/audit'

// 골든셋에 매칭 데이터 추가
export async function addToGoldenSet(
  item: ComparisonItem,
  supplier: Supplier,
  approvedBy?: string
): Promise<boolean> {
  const supabase = createClient()

  const match = supplier === 'CJ' ? item.cj_match : item.ssg_match
  if (!match) return false

  const { error } = await supabase.from('golden_set').insert({
    extracted_name: item.extracted_name,
    extracted_spec: item.extracted_spec,
    normalized_name: normalizeProductName(item.extracted_name),
    matched_product_id: match.id,
    supplier,
    confidence_score: match.match_score,
    match_metadata: {
      extracted_quantity: item.extracted_quantity,
      extracted_unit_price: item.extracted_unit_price,
      ppu: match.ppu,
      standard_unit: match.standard_unit
    },
    approved_by: approvedBy
  })

  return !error
}

// 확정 시 골든셋 자동 추가
export async function autoAddConfirmedToGoldenSet(
  items: ComparisonItem[],
  approvedBy?: string
): Promise<number> {
  let addedCount = 0

  for (const item of items) {
    if (!item.is_confirmed) continue

    // CJ 매칭이 있으면 추가
    if (item.cj_match) {
      const success = await addToGoldenSet(item, 'CJ', approvedBy)
      if (success) addedCount++
    }

    // SSG 매칭이 있으면 추가
    if (item.ssg_match) {
      const success = await addToGoldenSet(item, 'SHINSEGAE', approvedBy)
      if (success) addedCount++
    }
  }

  return addedCount
}

// 골든셋 기반 자동 매칭 (우선순위 높음)
export async function matchWithGoldenSet(
  itemName: string,
  itemSpec?: string
): Promise<GoldenSetEntry[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .rpc('match_with_golden_set', {
      p_item_name: itemName,
      p_item_spec: itemSpec
    })

  if (error || !data) return []

  return data.filter((match: any) => match.source === 'golden_set')
}

// 정규화 함수 (기존 로직 재사용)
function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\w가-힣]/g, '')
}
```

**파일**: `src/app/api/analyze/page/route.ts` (수정)

```typescript
// 기존 analyze/page API 수정
// 매칭 로직에 골든셋 우선 검색 추가

import { matchWithGoldenSet } from '@/lib/golden-set'

export async function POST(req: Request) {
  // ... 기존 OCR 및 초기 처리

  for (const item of extractedItems) {
    // 1. 골든셋 우선 검색
    const goldenMatches = await matchWithGoldenSet(item.name, item.spec)

    if (goldenMatches.length > 0) {
      // 골든셋에서 찾은 경우 높은 신뢰도로 처리
      item.match_status = 'auto_matched'
      item.match_score = goldenMatches[0].confidence_score
      // ... 골든셋 매칭 정보 할당
    } else {
      // 2. 기존 fuzzy matching
      const fuzzyMatches = await performFuzzySearch(item.name)
      // ... 기존 로직
    }
  }

  // ... 나머지 처리
}
```

**작업 내용**:
- [ ] golden-set.ts 유틸리티 작성
- [ ] addToGoldenSet 함수 구현
- [ ] autoAddConfirmedToGoldenSet 함수 구현
- [ ] matchWithGoldenSet 함수 구현
- [ ] analyze/page API에 골든셋 우선 검색 로직 추가
- [ ] 확정 버튼 클릭 시 골든셋 자동 추가 트리거

---

### Phase 7: 재리딩 기능 (우선순위: 낮음)
**파일**: `src/app/calc-food/components/MatchingStep/MatchingView.tsx`

```typescript
export function MatchingView({
  items,
  onConfirmItem,
  // ... 기타 props
}: MatchingViewProps) {
  const [confirmationMode, setConfirmationMode] = useState<'confirm' | 'edit'>('confirm')

  const handleToggleConfirm = (itemId: string) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return

    // 재리딩 모드: 확정 취소 가능
    if (confirmationMode === 'edit') {
      onConfirmItem(itemId, !item.is_confirmed)
    } else {
      // 일반 모드: 확정만 가능
      if (!item.is_confirmed) {
        onConfirmItem(itemId, true)
      }
    }
  }

  return (
    <div>
      {/* 모드 전환 버튼 */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setConfirmationMode('confirm')}
          className={cn(
            'px-4 py-2 rounded-lg',
            confirmationMode === 'confirm'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700'
          )}
        >
          확정 모드
        </button>
        <button
          onClick={() => setConfirmationMode('edit')}
          className={cn(
            'px-4 py-2 rounded-lg',
            confirmationMode === 'edit'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-200 text-gray-700'
          )}
        >
          재리딩 모드 (수정 가능)
        </button>
      </div>

      {/* 아이템 리스트 */}
      {items.map(item => (
        <MatchingRow
          key={item.id}
          item={item}
          isEditMode={confirmationMode === 'edit'}
          onConfirm={handleToggleConfirm}
          // ... 기타 props
        />
      ))}
    </div>
  )
}
```

**작업 내용**:
- [ ] MatchingView에 확정/재리딩 모드 전환 UI 추가
- [ ] 재리딩 모드에서 확정 취소 가능하도록 로직 수정
- [ ] 모드별 UI 스타일 차별화

---

### Phase 8: 총액 확인 기능 (우선순위: 중간)
**파일**: `src/app/calc-food/components/MatchingStep/MatchingHeader.tsx`

```typescript
export function MatchingHeader({
  items,
  fileName,
  confirmationStats
}: MatchingHeaderProps) {
  const totalAmount = items.reduce(
    (sum, item) => sum + (item.extracted_quantity * item.extracted_unit_price),
    0
  )

  const confirmedAmount = items
    .filter(item => item.is_confirmed)
    .reduce((sum, item) => sum + (item.extracted_quantity * item.extracted_unit_price), 0)

  const needsReviewCount = items.filter(item => item.needs_review).length

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="grid grid-cols-4 gap-4">
        {/* 파일명 */}
        <div>
          <div className="text-sm text-gray-500">파일명</div>
          <div className="font-semibold">{fileName}</div>
        </div>

        {/* 거래명세서 총액 */}
        <div>
          <div className="text-sm text-gray-500">거래명세서 총액</div>
          <div className="text-lg font-bold text-blue-600">
            {formatCurrency(totalAmount)}
          </div>
        </div>

        {/* 확정된 총액 */}
        <div>
          <div className="text-sm text-gray-500">확정된 총액</div>
          <div className="text-lg font-bold text-green-600">
            {formatCurrency(confirmedAmount)}
          </div>
          <div className="text-xs text-gray-500">
            ({((confirmedAmount / totalAmount) * 100).toFixed(1)}%)
          </div>
        </div>

        {/* 점검 필요 */}
        <div>
          <div className="text-sm text-gray-500">점검 필요</div>
          <div className="text-lg font-bold text-yellow-600">
            {needsReviewCount}개
          </div>
        </div>
      </div>

      {/* 진행 상태 바 */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
          <span>확정 진행률</span>
          <span>{confirmationStats.confirmed} / {confirmationStats.total}</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all"
            style={{
              width: `${(confirmationStats.confirmed / confirmationStats.total) * 100}%`
            }}
          />
        </div>
      </div>
    </div>
  )
}
```

**작업 내용**:
- [ ] MatchingHeader에 거래명세서 총액 표시
- [ ] 확정된 총액 및 비율 표시
- [ ] 점검 필요 개수 표시
- [ ] 진행 상태 바 개선

---

## 📊 작업 우선순위 매트릭스

| Phase | 작업명 | 우선순위 | 예상 소요 | 의존성 |
|-------|--------|----------|-----------|--------|
| 1 | 타입 시스템 확장 | 높음 | 2시간 | 없음 |
| 2 | DB 스키마 확장 | 높음 | 3시간 | Phase 1 |
| 3 | 카드 레이아웃 구현 | 높음 | 4시간 | Phase 1 |
| 8 | 총액 확인 기능 | 중간 | 2시간 | Phase 1 |
| 4 | 검색 팝업 개선 | 중간 | 4시간 | Phase 1 |
| 5 | 엑셀 다운로드 | 중간 | 3시간 | Phase 1 |
| 6 | ML 학습 시스템 | 낮음 | 6시간 | Phase 2 |
| 7 | 재리딩 기능 | 낮음 | 2시간 | Phase 3 |

**총 예상 소요 시간**: 26시간

---

## 🧪 테스트 계획

### Phase 3 테스트: 카드 레이아웃
- [ ] 3행 구조가 정확히 표시되는지 확인
- [ ] 공급사별 색상 구분이 명확한지 확인
- [ ] 점검 필요 플래그 토글 동작 확인
- [ ] 메모 추가/수정 기능 동작 확인
- [ ] 반응형 레이아웃 (모바일/태블릿) 확인

### Phase 4 테스트: 검색 팝업
- [ ] 드래그 앤 드롭이 정상 작동하는지 확인
- [ ] 상위 5개 제한이 적용되는지 확인
- [ ] [없음] 선택 시 needs_review 플래그 설정 확인
- [ ] 드래그 순서 변경이 선택에 영향을 주지 않는지 확인

### Phase 5 테스트: 엑셀 다운로드
- [ ] 거래명세서 엑셀 파일 정확성 확인
- [ ] 비교표 엑셀 파일 정확성 확인
- [ ] 견적불가 항목이 빨간색으로 표시되는지 확인
- [ ] 엑셀 파일 열림 및 포맷 확인

### Phase 6 테스트: ML 학습
- [ ] 골든셋에 데이터가 정확히 저장되는지 확인
- [ ] 골든셋 기반 매칭이 우선 적용되는지 확인
- [ ] 확정 시 자동 골든셋 추가 동작 확인
- [ ] 학습 데이터 품질 검증 (중복 제거, 정규화)

---

## 📝 구현 노트

### 중요 고려사항

1. **타입 안전성**: 모든 새 필드는 TypeScript 타입에 명시적으로 추가
2. **데이터베이스 마이그레이션**: 기존 데이터 호환성 유지
3. **성능**: 골든셋 검색은 인덱스 최적화 필수
4. **UX**: 드래그 앤 드롭은 터치 디바이스 호환성 고려
5. **엑셀 포맷**: 한글 깨짐 방지 (UTF-8 BOM)

### 기술 스택 추가
- **xlsx**: 엑셀 파일 생성 및 다운로드
- **@dnd-kit**: 드래그 앤 드롭 UI 구현
- **lucide-react**: 아이콘 시스템 (이미 사용 중)

### 후속 개선 아이디어
- [ ] 골든셋 품질 대시보드 (정확도, 사용 빈도)
- [ ] 사용자별 골든셋 승인 권한 관리
- [ ] 엑셀 업로드로 대량 골든셋 등록
- [ ] 매칭 정확도 시각화 차트
- [ ] 학습 데이터 기반 추천 알고리즘 개선

---

## ✅ 체크리스트

### Phase 1: 타입 시스템
- [ ] ComparisonItem 타입 확장
- [ ] SupplierMatch 타입 확장
- [ ] ExcelExportData 타입 정의
- [ ] GoldenSetEntry 타입 정의

### Phase 2: 데이터베이스
- [ ] audit_items 테이블 확장 마이그레이션
- [ ] golden_set 테이블 생성
- [ ] 인덱스 추가
- [ ] match_with_golden_set RPC 함수 작성

### Phase 3: 카드 레이아웃
- [ ] MatchingRow 컴포넌트 리팩토링
- [ ] 3행 구조 구현
- [ ] 점검 필요 토글 구현
- [ ] 메모 기능 구현

### Phase 4: 검색 팝업
- [ ] @dnd-kit 라이브러리 설치
- [ ] 드래그 앤 드롭 구현
- [ ] [없음] 선택 버튼 추가
- [ ] needs_review 플래그 로직 추가

### Phase 5: 엑셀 다운로드
- [ ] xlsx 라이브러리 설치
- [ ] excel-export.ts 작성
- [ ] exportInvoiceToExcel 구현
- [ ] exportComparisonToExcel 구현
- [ ] ReportView에 다운로드 버튼 추가

### Phase 6: ML 학습
- [ ] golden-set.ts 작성
- [ ] addToGoldenSet 구현
- [ ] autoAddConfirmedToGoldenSet 구현
- [ ] analyze/page API 수정
- [ ] 확정 시 골든셋 추가 트리거

### Phase 7: 재리딩
- [ ] MatchingView에 모드 전환 UI 추가
- [ ] 확정 취소 로직 구현

### Phase 8: 총액 확인
- [ ] MatchingHeader에 총액 표시
- [ ] 확정 총액 및 비율 표시
- [ ] 점검 필요 개수 표시

---

## 📚 참고 자료

- [xlsx 라이브러리 문서](https://docs.sheetjs.com/)
- [@dnd-kit 문서](https://docs.dndkit.com/)
- [Supabase RPC 함수 가이드](https://supabase.com/docs/guides/database/functions)
- [Next.js 14 API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

---

**작성일**: 2026-02-07
**버전**: 1.0
**작성자**: Claude (Sonnet 4.5)
