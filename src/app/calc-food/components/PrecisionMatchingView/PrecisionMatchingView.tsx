'use client'

/**
 * 매칭 단계 메인 화면 — 정밀 검수 페이지 (v3, 2026-05-04)
 *
 * 사용자 피드백 반영:
 *  - 상단 KPI 대시보드 (거래명세표 합계 / 품목 수 / 예상 견적 / 총 절감액)
 *  - 좌(col-3): 품목 리스트 — 빠른 작업 전환
 *  - 중앙(col-5): 상하 분할 — 위(기존 업체 품목 상세) / 아래(신세계 매칭 + 조정)
 *  - 우(col-4): 후보 리스트 (상시) + 검정 검색 카드 (하단 고정, 항상 보임)
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  ArrowLeft, ArrowRight, ChevronDown, Search, Package, Loader2, AlertTriangle,
  FileImage, CheckCircle2, CheckCircle, Tag, MapPin, Snowflake, Boxes, X, RefreshCw,
  ExternalLink, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { PdfModal } from '../SplitView/PdfModal'
import { formatCurrency, formatNumber, formatWeight } from '@/lib/format'
import {
  parseSpecToGrams, pricePerKg, computeShinsegaePerKg, computeSavings, estimateSsgTotal,
} from '@/lib/unit-conversion'
import {
  getCommonTokens, getMatchConfidence, type MatchConfidence,
  normalizeOrigin, originMatchScore, isProcessedProduct, cleanProductQuery, recoverOrigin,
} from '@/lib/token-match'

interface PrecisionMatchingViewProps {
  items: ComparisonItem[]
  pages?: PageImage[]
  supplierName?: string
  sessionId?: string
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (
    itemId: string,
    supplier?: Supplier,
    adjustments?: { adjusted_quantity?: number; adjusted_unit_weight_g?: number; adjusted_pack_unit?: string },
  ) => void
  onConfirmAllAutoMatched: () => void
  onAutoExcludeUnmatched?: () => void
  onProceedToReport: () => void
  onReload?: () => void
  /** 거래명세표 재확인/수정 모달 트리거 (2026-05-10) */
  onOpenInvoiceReview?: () => void
}

interface ProductDetail {
  id: string
  product_code?: string
  product_name?: string
  category?: string
  subcategory?: string
  origin?: string
  origin_detail?: string
  tax_type?: '과세' | '면세'
  storage_temp?: string
  supply_status?: string
  spec_raw?: string
  unit_raw?: string
  // 단가 변경 추적 (2026-05-09 migration 042)
  previous_price?: number
  price_changed_at?: string
  supplier_partner?: string
}

const PACK_UNITS = ['EA', 'BAG', 'BOX', 'PAC', '봉', 'KG', 'L'] as const
type SortMode = 'match' | 'price' | 'per_kg' | 'savings'
type FilterMode = 'all' | 'unconfirmed' | 'unmatched'

const SORT_LABEL: Record<SortMode, string> = {
  match: '일치율 높은 순',
  price: '가격 낮은 순',
  per_kg: 'kg당 단가 낮은 순',
  savings: '절감액 높은 순',
}

const FILTER_LABEL: Record<FilterMode, string> = {
  all: '전체',
  unconfirmed: '미확정만',
  unmatched: '매칭 없는 것만',
}

/* ────────────────────────────────────────────────────────── */
/* 텍스트 내 공통 토큰 강조 표시 (녹색 굵게)                      */
/* ────────────────────────────────────────────────────────── */
function HighlightedText({
  text,
  commonTokens,
  baseClassName = '',
  highlightClassName = 'font-bold text-emerald-600',
}: {
  text: string | undefined | null
  commonTokens: Set<string>
  baseClassName?: string
  highlightClassName?: string
}) {
  if (!text) return null
  // 공백/구두점 단위로 분할 (구두점도 보존)
  const parts = text.split(/(\s+|[,.()/])/)
  return (
    <span className={baseClassName}>
      {parts.map((p, i) => {
        const lower = p.toLowerCase()
        const isCommon = lower.length >= 2 && commonTokens.has(lower)
        return (
          <span key={i} className={isCommon ? highlightClassName : undefined}>
            {p}
          </span>
        )
      })}
    </span>
  )
}

/**
 * 단위가 무게/부피 단위 자체일 때 1 단위 = N 그램으로 환산.
 * spec/품목명에 단위중량이 없어도 단위가 KG/G/L/ML이면 발주수량 자체가 총량.
 * (예: "청피망 단위 KG 발주 1" → 1KG = 1,000g)
 */
function unitToGrams(unit: string | undefined): number | null {
  if (!unit) return null
  const u = unit.toUpperCase().trim()
  if (u === 'KG') return 1000
  if (u === 'G') return 1
  if (u === 'L') return 1000
  if (u === 'ML') return 1
  return null
}

/**
 * spec/품목명에 무게/부피 단위 키워드가 단독으로 있을 때 1 단위 환산.
 * parseSpecToGrams는 "1KG" 같이 숫자가 붙은 패턴을 잡지만, "상품 KG" 같이
 * 단독 키워드만 있는 경우는 못 잡음 → 이 함수로 fallback.
 *
 * 예: spec="상품 KG, 한국Wn※국내산" + unit=EA  → 1000g (1KG짜리 봉지로 간주)
 */
function specToUnitFallback(text: string | undefined | null): number | null {
  if (!text) return null
  const t = text.toUpperCase()
  if (/\bKG\b/.test(t)) return 1000
  if (/\bML\b/.test(t)) return 1
  if (/\bL\b/.test(t)) return 1000
  if (/\bG\b/.test(t)) return 1
  return null
}

/* ────────────────────────────────────────────────────────── */
/* 단순 환산 절감액 (후보별) — 표준가 × 수량                     */
/* ────────────────────────────────────────────────────────── */
function candidateSavings(c: SupplierMatch, item: ComparisonItem, existingTotal: number): number {
  const candTotal = c.standard_price * (item.adjusted_quantity ?? item.extracted_quantity)
  return existingTotal - candTotal
}

/** 기존 업체 품목의 원산지 추출 (extracted_name + extracted_spec 둘 다 검사) */
function getItemOrigin(item: ComparisonItem): string {
  // (2026-05-11) 우선순위 — extracted_origin > recoverOrigin > legacy 통합 텍스트
  if (item.extracted_origin) {
    const norm = normalizeOrigin(item.extracted_origin)
    if (norm !== 'UNKNOWN') return norm
  }
  const recovered = recoverOrigin(item.extracted_name, item.extracted_spec)
  if (recovered) {
    const norm = normalizeOrigin(recovered)
    if (norm !== 'UNKNOWN') return norm
  }
  return normalizeOrigin(`${item.extracted_name ?? ''} ${item.extracted_spec ?? ''}`)
}


/**
 * 원산지 편집 chip (2026-05-11)
 * - 표시: 현재 값 또는 '원산지 미확인'
 * - 클릭 시 빠른 선택 dropdown (자주 사용되는 8개 옵션) + 직접 입력
 * - onSave는 PATCH 호출 (extracted_origin)
 */
const ORIGIN_QUICK_OPTIONS = [
  '국내산', '외국산', '중국', '호주산', '미국', '캐나다', '베트남', '태국', '뉴질랜드',
]
function OriginEditor({ itemId, initialValue }: { itemId: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialValue)
  useEffect(() => {
    setValue(initialValue)
    setDraft(initialValue)
  }, [itemId, initialValue])
  const normalized = value ? normalizeOrigin(value) : 'UNKNOWN'
  const labelColor =
    normalized === 'UNKNOWN'
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:opacity-80 ${labelColor}`}
        title="클릭하여 원산지 수정"
      >
        🌍 {value || '원산지 미확인'}
      </button>
    )
  }
  const commit = (next: string) => {
    const trimmed = next.trim()
    setValue(trimmed)
    setDraft(trimmed)
    setEditing(false)
    if (trimmed === initialValue) return
    void fetch(`/api/audit-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extracted_origin: trimmed || null }),
    }).catch((e) => console.warn('extracted_origin 저장 실패:', e))
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1">
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft)
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        placeholder="예: 국내산, 캐나다, 호주산"
        className="rounded border border-gray-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
        size={18}
      />
      <span className="text-xs text-gray-500">빠른 선택:</span>
      {ORIGIN_QUICK_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            commit(opt)
          }}
          className="rounded bg-white px-1.5 py-0.5 text-xs text-gray-700 hover:bg-blue-100"
        >
          {opt}
        </button>
      ))}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          commit('')
        }}
        className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
        title="원산지 정보 제거"
      >
        ✕
      </button>
    </span>
  )
}

function getExistingTotal(item: ComparisonItem): number {
  return item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
}

/* 항목별 예상 신세계 견적은 src/lib/unit-conversion.ts의 estimateSsgTotal 사용
   (리포트·엑셀 다운로드와 통일 — 2026-05-04) */

/* ────────────────────────────────────────────────────────── */
/* 메인 — KPI 대시보드 + 3분할 레이아웃                          */
/* ────────────────────────────────────────────────────────── */
export function PrecisionMatchingView({
  items,
  pages = [],
  supplierName = '업체',
  sessionId,
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onAutoExcludeUnmatched,
  onProceedToReport,
  onReload,
  onOpenInvoiceReview,
}: PrecisionMatchingViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  // (2026-05-11) 좌측 패널의 정렬된 visible idx 동기화 (가나다/금액순 정렬 반영)
  // ItemListPanel이 자체 sort 후 이 ref를 업데이트 → Confirm 시 부모가 정렬 순서대로 다음 idx 결정
  const sortedVisibleIndicesRef = useRef<number[]>([])
  const onSortedVisibleChange = useCallback((idxs: number[]) => {
    sortedVisibleIndicesRef.current = idxs
  }, [])
  const [sortMode, setSortMode] = useState<SortMode>('match')
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)
  const [rematching, setRematching] = useState(false)
  const [rematchResult, setRematchResult] = useState<{ rematched: number; stillUnmatched: number; total: number } | null>(null)
  // 매칭 제품 상세 (부모로 끌어올려 양쪽 패널의 commonTokens 계산용)
  const [matchDetail, setMatchDetail] = useState<ProductDetail | null>(null)

  const runRematch = useCallback(async () => {
    if (!sessionId || rematching) return
    if (!confirm('CJ로 잘못 매칭된 항목 + 미매칭 항목을 SHINSEGAE 카탈로그에서 자동 재매칭합니다. 진행하시겠습니까?')) return
    setRematching(true)
    setRematchResult(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/rematch-cj`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setRematchResult({
          rematched: data.rematched,
          stillUnmatched: data.stillUnmatched,
          total: data.total,
        })
        // 데이터 다시 로드
        if (onReload) onReload()
      } else {
        alert(`재매칭 실패: ${data.error ?? 'unknown'}`)
      }
    } catch (e) {
      alert(`재매칭 오류: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setRematching(false)
    }
  }, [sessionId, rematching, onReload])

  const currentItem = items[selectedIndex] ?? null

  // KPI 계산
  const kpi = useMemo(() => {
    const existingTotal = items.reduce((sum, i) => sum + getExistingTotal(i), 0)
    const ssgEstimate = items.reduce((sum, i) => sum + estimateSsgTotal(i), 0)
    const totalSavings = existingTotal - ssgEstimate
    const savingPercent = existingTotal > 0 ? (totalSavings / existingTotal) * 100 : 0
    const confirmed = items.filter((i) => i.is_confirmed).length
    return {
      existingTotal,
      ssgEstimate,
      totalSavings,
      savingPercent,
      total: items.length,
      confirmed,
    }
  }, [items])

  const visibleIndices = useMemo(() => {
    return items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => {
        if (filterMode === 'unconfirmed') return !it.is_confirmed
        if (filterMode === 'unmatched') return !it.cj_match && !it.ssg_match
        return true
      })
      .map(({ idx }) => idx)
  }, [items, filterMode])

  const visiblePos = visibleIndices.indexOf(selectedIndex)

  // (2026-05-11) 정렬된 visible idx 우선 (좌측 패널 가나다/금액 정렬 반영), 비어있으면 단조 idx fallback
  const moveToNext = useCallback(() => {
    const sortedList =
      sortedVisibleIndicesRef.current.length > 0
        ? sortedVisibleIndicesRef.current
        : visibleIndices
    if (sortedList.length === 0) return
    const currentPos = sortedList.indexOf(selectedIndex)
    if (currentPos === -1) {
      setSelectedIndex(sortedList[0])
      return
    }
    const next = sortedList[currentPos + 1]
    if (next != null) setSelectedIndex(next)
  }, [visibleIndices, selectedIndex])

  const moveToPrev = useCallback(() => {
    const sortedList =
      sortedVisibleIndicesRef.current.length > 0
        ? sortedVisibleIndicesRef.current
        : visibleIndices
    if (sortedList.length === 0) return
    const currentPos = sortedList.indexOf(selectedIndex)
    if (currentPos === -1) {
      setSelectedIndex(sortedList[0])
      return
    }
    const prev = sortedList[currentPos - 1]
    if (prev != null) setSelectedIndex(prev)
  }, [visibleIndices, selectedIndex])

  if (!currentItem) {
    return <div className="flex h-full items-center justify-center text-gray-400">품목이 없습니다.</div>
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* ── 상단 KPI 대시보드 ── */}
      <KpiDashboard kpi={kpi} supplierName={supplierName} />

      {/* ── 네비게이션 헤더 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={moveToPrev}
            disabled={visiblePos <= 0}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <ArrowLeft size={14} /> 이전 <kbd className="ml-1 rounded bg-gray-100 px-1 text-[10px]">P</kbd>
          </button>
          <button
            onClick={moveToNext}
            disabled={visiblePos === -1 || visiblePos >= visibleIndices.length - 1}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            다음 <kbd className="ml-1 rounded bg-gray-100 px-1 text-[10px]">N</kbd> <ArrowRight size={14} />
          </button>
          <span className="ml-2 text-xs text-gray-500">
            {selectedIndex + 1} / {items.length}
          </span>
          {onOpenInvoiceReview && (
            <button
              onClick={onOpenInvoiceReview}
              className="ml-2 flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
              title="거래명세표 재확인 또는 수정 (매칭에 영향)"
            >
              📄 명세표 재확인
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">필터:</span>
          {(['all', 'unconfirmed', 'unmatched'] as FilterMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setFilterMode(m)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs',
                filterMode === m
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {FILTER_LABEL[m]}
            </button>
          ))}
          <span className="ml-2 text-xs text-gray-500">({visibleIndices.length}개)</span>
        </div>
      </div>

      {/* ── 3분할 본문 ── */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-hidden p-3">
        {/* 좌(col-3): 품목 리스트 */}
        <ItemListPanel
          items={items}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          filterMode={filterMode}
          onSortedVisibleChange={onSortedVisibleChange}
        />

        {/* 중앙(col-5): 상하 분할 — commonTokens로 동일 텍스트 색상 매칭 */}
        {(() => {
          const existingText = [
            currentItem.extracted_name,
            currentItem.extracted_spec,
            currentItem.extracted_unit,
          ].filter(Boolean).join(' ')
          const ssgText = [
            currentItem.ssg_match?.product_name,
            matchDetail?.origin,
            matchDetail?.category,
            matchDetail?.subcategory,
            currentItem.ssg_match?.spec_quantity != null && currentItem.ssg_match?.spec_unit
              ? `${currentItem.ssg_match.spec_quantity}${currentItem.ssg_match.spec_unit}`
              : undefined,
          ].filter(Boolean).join(' ')
          const commonTokens = getCommonTokens(existingText, ssgText)
          return (
            <section className="col-span-5 flex min-h-0 flex-col gap-3">
              <ExistingItemDetail
                item={currentItem}
                onOpenImage={pages.length > 0 ? () => setIsPdfModalOpen(true) : undefined}
                commonTokens={commonTokens}
              />
              <ShinsegaeMatching
                key={currentItem.id}
                item={currentItem}
                onSelectCandidate={(c) => onSelectCandidate(currentItem.id, 'SHINSEGAE', c)}
                onConfirm={(adjustments) => {
                  // (2026-05-11) 컨펌 후 다음 품목 자동 이동
                  // 좌측 패널의 정렬 순서(가나다/금액/기본) 그대로 다음 idx 사용
                  const sortedList =
                    sortedVisibleIndicesRef.current.length > 0
                      ? sortedVisibleIndicesRef.current
                      : visibleIndices
                  const currentPos = sortedList.indexOf(selectedIndex)
                  const nextVisibleIdx = currentPos !== -1 ? sortedList[currentPos + 1] : undefined
                  onConfirmItem(currentItem.id, 'SHINSEGAE', adjustments)
                  if (nextVisibleIdx != null) {
                    setSelectedIndex(nextVisibleIdx)
                  } else {
                    moveToNext()
                  }
                }}
                commonTokens={commonTokens}
                matchDetail={matchDetail}
                setMatchDetail={setMatchDetail}
              />
            </section>
          )
        })()}

        {/* 우(col-4): 후보 + 검색 (검색은 하단 고정) */}
        <CandidatesAndSearchPanel
          key={`right-${currentItem.id}`}
          item={currentItem}
          sortMode={sortMode}
          onSortChange={setSortMode}
          onSelectCandidate={(c) => onSelectCandidate(currentItem.id, 'SHINSEGAE', c)}
        />
      </div>

      {/* 하단 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-6 py-2.5">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <kbd className="rounded bg-gray-100 px-1.5 py-0.5">P</kbd>이전
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">N</kbd>다음
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">Enter</kbd>확정
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">1-9</kbd>후보 선택
        </div>
        <div className="flex items-center gap-2">
          {sessionId && (
            <button
              onClick={runRematch}
              disabled={rematching}
              className="flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              title="CJ로 잘못 매칭된 항목 + 미매칭 항목을 신세계 카탈로그에서 자동 재매칭"
            >
              {rematching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {rematchResult
                ? `재매칭 완료 (${rematchResult.rematched}건)`
                : '신세계 자동 재매칭'}
            </button>
          )}
          {items.some((i) => !i.is_confirmed && (i.cj_match || i.ssg_match)) && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-700 hover:bg-green-100"
            >
              <CheckCircle size={14} /> 자동매칭 일괄 확정
            </button>
          )}
          {(() => {
            const cnt = items.filter((i) => !i.is_confirmed && !i.cj_match && !i.ssg_match).length
            return cnt > 0 && onAutoExcludeUnmatched ? (
              <button
                onClick={onAutoExcludeUnmatched}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100"
              >
                비교 불가 {cnt}개 자동 제외
              </button>
            ) : null
          })()}
          <button
            onClick={onProceedToReport}
            disabled={!items.every((i) => i.is_confirmed)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium',
              items.every((i) => i.is_confirmed)
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'cursor-not-allowed bg-gray-200 text-gray-500',
            )}
          >
            {items.every((i) => i.is_confirmed)
              ? '리포트 생성'
              : `${kpi.total - kpi.confirmed}개 미확정`}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <PdfModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        pages={pages}
        currentPage={pdfCurrentPage}
        onPageChange={setPdfCurrentPage}
        highlightRowIndex={selectedIndex}
      />

      <KeyboardHandler
        onPrev={moveToPrev}
        onNext={moveToNext}
        onConfirm={() => {
          // (2026-05-11) 좌측 패널 정렬 순서(가나다/금액/기본) 기준 다음 idx
          const sortedList =
            sortedVisibleIndicesRef.current.length > 0
              ? sortedVisibleIndicesRef.current
              : visibleIndices
          const currentPos = sortedList.indexOf(selectedIndex)
          const nextVisibleIdx = currentPos !== -1 ? sortedList[currentPos + 1] : undefined
          onConfirmItem(currentItem.id, 'SHINSEGAE')
          if (nextVisibleIdx != null) {
            setSelectedIndex(nextVisibleIdx)
          } else {
            moveToNext()
          }
        }}
        onSelectCandidate={(idx) => {
          const c = (currentItem.ssg_candidates ?? [])[idx]
          if (c) onSelectCandidate(currentItem.id, 'SHINSEGAE', c)
        }}
      />
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 상단 KPI 대시보드 (4 카드)                                  */
/* ────────────────────────────────────────────────────────── */
function KpiDashboard({
  kpi,
  supplierName,
}: {
  kpi: {
    existingTotal: number
    ssgEstimate: number
    totalSavings: number
    savingPercent: number
    total: number
    confirmed: number
  }
  supplierName: string
}) {
  const isSaving = kpi.totalSavings > 0
  return (
    <div className="grid grid-cols-4 gap-3 border-b bg-white px-4 py-3">
      <KpiCard label="거래명세표 합계" value={formatCurrency(kpi.existingTotal)} sub={supplierName} />
      <KpiCard
        label="비교 품목 수"
        value={`${kpi.total} EA`}
        sub={`${kpi.confirmed}개 확정 (${kpi.total > 0 ? Math.round((kpi.confirmed / kpi.total) * 100) : 0}%)`}
      />
      <KpiCard label="예상 신세계 견적" value={formatCurrency(kpi.ssgEstimate)} sub="환산 단가 기준" />
      <KpiCard
        label="총 절감액"
        value={formatCurrency(Math.abs(kpi.totalSavings))}
        sub={
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold',
              isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
            )}
          >
            {isSaving ? '▼' : '▲'} {kpi.savingPercent.toFixed(1)}%
          </span>
        }
        valueColor={isSaving ? 'text-green-700' : 'text-red-700'}
        ringColor={isSaving ? 'ring-green-200' : 'ring-red-200'}
      />
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  valueColor = 'text-gray-900',
  ringColor = 'ring-gray-100',
}: {
  label: string
  value: string
  sub: React.ReactNode
  valueColor?: string
  ringColor?: string
}) {
  return (
    <div className={cn('rounded-xl bg-white p-3 ring-1', ringColor)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className={cn('mt-1 text-xl font-bold', valueColor)}>{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{sub}</div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 좌(col-3): 품목 리스트                                       */
/* ────────────────────────────────────────────────────────── */
function ItemListPanel({
  items,
  selectedIndex,
  onSelect,
  filterMode,
  onSortedVisibleChange,
}: {
  items: ComparisonItem[]
  selectedIndex: number
  onSelect: (idx: number) => void
  filterMode: FilterMode
  onSortedVisibleChange?: (sortedIdxs: number[]) => void
}) {
  // (2026-05-11) selectedIndex 변경 시 좌측 패널 자동 스크롤 — Confirm 후 다음 품목으로 이동
  const listContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!listContainerRef.current) return
    const selectedBtn = listContainerRef.current.querySelector<HTMLElement>(
      `[data-item-idx="${selectedIndex}"]`,
    )
    selectedBtn?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  // 좌측 패널 자체 필터/정렬 (2026-05-10): 품목명 검색 + 금액순/가나다순
  const [searchQuery, setSearchQuery] = useState('')
  type LeftSort = 'default' | 'price_desc' | 'name_asc'
  const [leftSort, setLeftSort] = useState<LeftSort>('default')
  const toggleLeftSort = (mode: LeftSort) =>
    setLeftSort((prev) => (prev === mode ? 'default' : mode))

  const filtered = useMemo(() => {
    let list = items.map((it, idx) => ({ it, idx }))
    // 1) 상위 필터 (filterMode)
    list = list.filter(({ it }) => {
      if (filterMode === 'unconfirmed') return !it.is_confirmed
      if (filterMode === 'unmatched') return !it.cj_match && !it.ssg_match
      return true
    })
    // 2) 품목명 검색 (extracted_name + extracted_spec 부분 매칭)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(({ it }) =>
        (it.extracted_name?.toLowerCase().includes(q) ?? false) ||
        (it.extracted_spec?.toLowerCase().includes(q) ?? false),
      )
    }
    // 3) 정렬 (배타 — 한 모드만)
    if (leftSort === 'price_desc') {
      list = [...list].sort((a, b) => getExistingTotal(b.it) - getExistingTotal(a.it))
    } else if (leftSort === 'name_asc') {
      list = [...list].sort((a, b) =>
        (a.it.extracted_name ?? '').localeCompare(b.it.extracted_name ?? '', 'ko'),
      )
    }
    return list
  }, [items, filterMode, searchQuery, leftSort])

  // (2026-05-11) 부모에 정렬된 visible idx 배열 동기화 — Confirm 시 정렬 순서대로 다음 idx 사용
  useEffect(() => {
    onSortedVisibleChange?.(filtered.map(({ idx }) => idx))
  }, [filtered, onSortedVisibleChange])

  return (
    <section className="col-span-3 flex min-h-0 flex-col rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm font-semibold text-gray-700">
        <span>📋 거래명세표 품목</span>
        <span className="text-xs text-gray-500">{filtered.length}개</span>
      </div>

      {/* 검색 + 금액 정렬 */}
      <div className="flex items-center gap-2 border-b bg-gray-50/60 px-3 py-2">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="품목명 검색..."
            className="w-full rounded border border-gray-200 bg-white py-1 pl-7 pr-6 text-xs focus:border-blue-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              title="검색 지우기"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={() => toggleLeftSort('price_desc')}
          className={cn(
            'shrink-0 rounded border px-2 py-1 text-xs font-medium transition',
            leftSort === 'price_desc'
              ? 'border-blue-400 bg-blue-100 text-blue-800'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100',
          )}
          title="금액 높은 순"
        >
          💰 금액순
        </button>
        <button
          onClick={() => toggleLeftSort('name_asc')}
          className={cn(
            'shrink-0 rounded border px-2 py-1 text-xs font-medium transition',
            leftSort === 'name_asc'
              ? 'border-blue-400 bg-blue-100 text-blue-800'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100',
          )}
          title="품목명 가나다 순"
        >
          가 가나다
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" ref={listContainerRef}>
        {filtered.map(({ it, idx }) => {
          const isSelected = idx === selectedIndex
          const total = getExistingTotal(it)
          const ssgEst = estimateSsgTotal(it)
          const sav = total - ssgEst
          const isSaving = sav > 0
          const hasMatch = !!(it.cj_match || it.ssg_match)
          return (
            <button
              key={it.id}
              data-item-idx={idx}
              onClick={() => onSelect(idx)}
              className={cn(
                'flex w-full items-stretch gap-2 border-b border-gray-100 px-3 py-2.5 text-left transition',
                isSelected
                  ? 'border-l-4 border-l-blue-500 bg-blue-50'
                  : 'border-l-4 border-l-transparent hover:bg-gray-50',
              )}
            >
              <div className="flex w-7 shrink-0 flex-col items-center pt-1">
                <span
                  className={cn(
                    'text-[10px] font-bold',
                    isSelected ? 'text-blue-600' : 'text-gray-400',
                  )}
                >
                  #{idx + 1}
                </span>
                {it.is_confirmed ? (
                  <CheckCircle size={14} className="mt-1 text-green-500" />
                ) : hasMatch ? (
                  <span className="mt-1 text-[10px] text-amber-500">●</span>
                ) : (
                  <X size={12} className="mt-1 text-gray-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900" title={it.extracted_name}>
                  {it.extracted_name}
                </div>
                {it.extracted_spec && (
                  <div className="mt-0.5 truncate text-[11px] text-gray-500" title={it.extracted_spec}>
                    {it.extracted_spec}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-gray-600">
                    {formatNumber(it.extracted_quantity)} {it.extracted_unit ?? 'EA'} ·{' '}
                    {formatCurrency(it.extracted_unit_price)}
                  </span>
                  <span className="font-semibold text-gray-900">{formatCurrency(total)}</span>
                </div>
                {/* (2026-05-12) 매칭 배지 강조 — 신세계 코드+품목명 가독성 개선
                   - 확정/미확정 모두 표시 (이전: 확정만 코드 배지)
                   - 코드 배지: 진한 배경 + 흰색 텍스트로 대비 강화
                   - 품목명: 잘림 18자 → CSS truncate (반응형), 폰트 ↑ */}
                {hasMatch && it.ssg_match && (
                  <div className="mt-1 flex items-center gap-1.5 rounded border-l-2 border-blue-400 bg-blue-50/70 px-1.5 py-1">
                    {it.ssg_match.product_code && (
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-sm',
                          it.is_confirmed
                            ? 'bg-blue-600 text-white'
                            : 'bg-amber-500 text-white',
                        )}
                      >
                        #{it.ssg_match.product_code}
                      </span>
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-[12px] font-medium text-blue-900"
                      title={it.ssg_match.product_name || ''}
                    >
                      {it.ssg_match.product_name || '신세계 매칭'}
                    </span>
                    {sav !== 0 && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold',
                          isSaving ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                        )}
                      >
                        {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-gray-400">조건에 맞는 품목이 없습니다.</div>
        )}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 중앙 상단: 기존 업체 품목 상세                                */
/* ────────────────────────────────────────────────────────── */
function ExistingItemDetail({
  item,
  onOpenImage,
  commonTokens,
}: {
  item: ComparisonItem
  onOpenImage?: () => void
  commonTokens: Set<string>
}) {
  // 단위중량 결정 우선순위:
  // 1) 단위가 무게/부피 단위 (KG/G/L/ML) → 1 단위 = N g (가장 신뢰)
  //    이유: 단위가 KG이면 "1KG단위로 N번 발주" 의미. spec에 "8KG" 같은 메타가
  //         박혀있어도 그건 총량/이력번호이지 단위중량이 아님 (돈앞다리 케이스)
  // 2) spec/품목명에서 무게 추출 (단위가 EA/박스/봉인 경우 — "5KG/팩" 같은 패턴)
  // 3) spec/품목명에 무게 단위 키워드만 있는 경우 1 단위 가정 (청피망 EA + spec="상품 KG" 케이스)
  const existingWeightG =
    unitToGrams(item.extracted_unit) ??
    parseSpecToGrams(item.extracted_spec) ??
    parseSpecToGrams(item.extracted_name) ??
    specToUnitFallback(item.extracted_spec) ??
    specToUnitFallback(item.extracted_name)
  const total = getExistingTotal(item)
  const perKg =
    existingWeightG && item.extracted_quantity > 0
      ? pricePerKg(item.extracted_unit_price, existingWeightG)
      : null

  // 부가세 (extracted_tax_amount가 있으면 사용, 없으면 supply/total 차이로 추정)
  const taxAmount = item.extracted_tax_amount ?? (
    item.extracted_supply_amount && item.extracted_total_price
      ? Math.max(0, item.extracted_total_price - item.extracted_supply_amount)
      : null
  )
  const supplyAmount = item.extracted_supply_amount ?? (
    item.extracted_total_price && taxAmount != null
      ? item.extracted_total_price - taxAmount
      : null
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-white shadow-sm">
      {/* 헤더 — 타이틀 + 출처 클릭 버튼 (모달 트리거) */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-sm font-semibold text-gray-700">
        <span className="shrink-0">
          🗄️ 기존 업체 품목 <span className="ml-1 text-[11px] font-normal text-gray-400">Read-only</span>
        </span>
        {(item.source_file_name || item.page_number != null) && onOpenImage ? (
          <button
            onClick={onOpenImage}
            className="flex min-w-0 items-center gap-1 truncate rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-normal text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
            title={`${item.source_file_name ?? ''}${item.page_number != null ? ` p.${item.page_number}` : ''} 클릭하여 원본 보기`}
          >
            <FileImage size={12} className="shrink-0" />
            <span className="truncate">
              {item.source_file_name}
              {item.page_number != null && <span className="ml-1 text-gray-400">p.{item.page_number}</span>}
            </span>
            <ExternalLink size={11} className="shrink-0 text-gray-400" />
          </button>
        ) : (
          (item.source_file_name || item.page_number != null) && (
            <span className="truncate text-[11px] font-normal text-gray-400">
              <FileImage size={11} className="mr-1 inline" />
              {item.source_file_name}
              {item.page_number != null && <span className="ml-1">p.{item.page_number}</span>}
            </span>
          )
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* 제품명 + 규격/단위 chips (출처 제거 — 헤더로 이동) */}
        <h3 className="break-words text-2xl font-bold leading-tight text-gray-900">
          <HighlightedText text={item.extracted_name} commonTokens={commonTokens} />
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-base">
          {item.extracted_spec && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
              <Boxes size={14} />
              <HighlightedText text={item.extracted_spec} commonTokens={commonTokens} />
            </span>
          )}
          {item.extracted_unit && (
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
              단위 <HighlightedText text={item.extracted_unit} commonTokens={commonTokens} />
            </span>
          )}
          {/* 원산지 chip + 수정 (2026-05-11) — OCR 누락/오판정 시 검수자가 보강 */}
          <OriginEditor itemId={item.id} initialValue={item.extracted_origin ?? ''} />
        </div>

        {/* 금액 5분할 한 줄 */}
        <div className="mt-1.5 grid grid-cols-5 gap-1">
          <FinanceCardCompact label="단위중량" value={formatWeight(existingWeightG)} />
          <FinanceCardCompact
            label="발주"
            value={`${formatNumber(item.extracted_quantity)} ${item.extracted_unit ?? 'EA'}`}
          />
          <FinanceCardCompact
            label="단가"
            value={formatCurrency(item.extracted_unit_price)}
            sub={perKg ? `₩${formatNumber(perKg)}/kg` : undefined}
            highlight="blue"
          />
          <FinanceCardCompact
            label="부가세"
            value={taxAmount != null ? formatCurrency(taxAmount) : '-'}
            sub={taxAmount === 0 ? '면세' : undefined}
          />
          <FinanceCardCompact
            label="총액"
            value={formatCurrency(total)}
            sub={supplyAmount != null && supplyAmount !== total ? `공급 ${formatCurrency(supplyAmount)}` : undefined}
            highlight="indigo"
          />
        </div>

        {/* 총 발주량 — 신세계 카드와 비교 기준 (한 줄 압축) */}
        {existingWeightG && item.extracted_quantity > 0 && (
          <div className="mt-1.5 flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1 ring-1 ring-amber-200">
            <span className="text-[11px] font-semibold text-amber-700">총 발주량</span>
            <span className="font-mono text-xs text-gray-700">
              {formatWeight(existingWeightG)} × {formatNumber(item.extracted_quantity)} {item.extracted_unit ?? 'EA'}
            </span>
            <span className="text-xs text-gray-400">=</span>
            <span className="text-sm font-bold text-amber-900">
              {formatWeight(existingWeightG * item.extracted_quantity)}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

/* 금액 검증 카드 (양쪽 패널 공유) */
function FinanceCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: 'blue' | 'indigo' | 'green' | 'red'
}) {
  const colorMap = {
    blue: 'bg-blue-50 ring-blue-200',
    indigo: 'bg-indigo-50 ring-indigo-200',
    green: 'bg-green-50 ring-green-200',
    red: 'bg-red-50 ring-red-200',
  } as const
  return (
    <div
      className={cn(
        'rounded-lg border p-2 ring-1',
        highlight ? colorMap[highlight] : 'bg-gray-50 ring-gray-100',
      )}
    >
      <div className="text-[9px] font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold text-gray-900" title={value}>{value}</div>
      {sub && <div className="text-[9px] text-gray-500">{sub}</div>}
    </div>
  )
}


/* 컴팩트 금액 카드 (양쪽 패널 공유, 라벨 위에 작게) */
function FinanceCardCompact({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  highlight?: 'blue' | 'indigo' | 'green' | 'red'
}) {
  const colorMap = {
    blue: 'bg-blue-50 ring-blue-200',
    indigo: 'bg-indigo-50 ring-indigo-200',
    green: 'bg-green-50 ring-green-200',
    red: 'bg-red-50 ring-red-200',
  } as const
  return (
    <div
      className={cn(
        'rounded border px-1.5 py-1 ring-1',
        highlight ? colorMap[highlight] : 'bg-gray-50 ring-gray-100',
      )}
    >
      <div className="text-[9px] font-medium text-gray-500">{label}</div>
      <div className="truncate text-sm font-bold leading-tight text-gray-900" title={value}>{value}</div>
      {sub && <div className="text-[9px] leading-tight text-gray-500">{sub}</div>}
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 중앙 하단: 신세계 매칭 + 조정                                 */
/* ────────────────────────────────────────────────────────── */
function ShinsegaeMatching({
  item,
  onSelectCandidate: _onSelectCandidate,
  onConfirm,
  commonTokens,
  matchDetail,
  setMatchDetail,
}: {
  item: ComparisonItem
  onSelectCandidate: (c: SupplierMatch) => void
  onConfirm: (adjustments?: { adjusted_quantity?: number; adjusted_unit_weight_g?: number; adjusted_pack_unit?: string }) => void
  commonTokens: Set<string>
  matchDetail: ProductDetail | null
  setMatchDetail: (d: ProductDetail | null) => void
}) {
  // ssg_match가 부모에서 props로 변경되면 즉시 반영 (P0 버그 fix)
  const [enrichedMatch, setEnrichedMatch] = useState<SupplierMatch | undefined>(item.ssg_match)
  useEffect(() => {
    setEnrichedMatch(item.ssg_match)
  }, [item.ssg_match?.id, item.ssg_match])
  const ssgMatch = enrichedMatch

  // 단위중량 결정 우선순위:
  // 1) 단위가 무게/부피 단위 (KG/G/L/ML) → 1 단위 = N g (가장 신뢰)
  //    이유: 단위가 KG이면 "1KG단위로 N번 발주" 의미. spec에 "8KG" 같은 메타가
  //         박혀있어도 그건 총량/이력번호이지 단위중량이 아님 (돈앞다리 케이스)
  // 2) spec/품목명에서 무게 추출 (단위가 EA/박스/봉인 경우 — "5KG/팩" 같은 패턴)
  // 3) spec/품목명에 무게 단위 키워드만 있는 경우 1 단위 가정 (청피망 EA + spec="상품 KG" 케이스)
  const existingWeightG =
    unitToGrams(item.extracted_unit) ??
    parseSpecToGrams(item.extracted_spec) ??
    parseSpecToGrams(item.extracted_name) ??
    specToUnitFallback(item.extracted_spec) ??
    specToUnitFallback(item.extracted_name)
  const existingTotal = getExistingTotal(item)

  // 검수자 조정값 (mount 시 초기화 — useEffect로 ssgMatch 변경 시 자동 동기화)
  const [unitWeightG, setUnitWeightG] = useState<number>(0)
  const [packUnit, setPackUnit] = useState<string>('EA')
  const [quantity, setQuantity] = useState<number>(item.adjusted_quantity ?? item.extracted_quantity)
  // 후보 변경 시 시각 피드백 — 단위중량 칸 1초 노란색 깜빡임 (2026-05-10)
  const [highlightSpec, setHighlightSpec] = useState(false)

  // 발주수량 동기화 — item 변경 또는 후보 변경(adjusted_quantity reset 포함) 시
  useEffect(() => {
    setQuantity(item.adjusted_quantity ?? item.extracted_quantity)
  }, [item.adjusted_quantity, item.extracted_quantity, ssgMatch?.id])

  // 단위중량/포장단위 동기화 — 매칭 변경 시 새 후보 spec 우선 적용
  // 검수자 조정값(adjusted_*)은 reducer가 후보 변경 시 clear하므로 자동으로 새 spec 사용
  useEffect(() => {
    if (!ssgMatch) {
      if (!item.adjusted_unit_weight_g) setUnitWeightG(0)
      if (!item.adjusted_pack_unit) setPackUnit('EA')
      return
    }
    // 검수자 조정값이 명시적으로 있으면 우선 (Confirm 후 다시 진입한 케이스)
    if (item.adjusted_unit_weight_g) {
      setUnitWeightG(item.adjusted_unit_weight_g)
    } else if (ssgMatch.spec_quantity && ssgMatch.spec_unit) {
      const u = ssgMatch.spec_unit.toUpperCase()
      let g = 0
      if (u === 'KG') g = ssgMatch.spec_quantity * 1000
      else if (u === 'G') g = ssgMatch.spec_quantity
      else if (u === 'L') g = ssgMatch.spec_quantity * 1000
      else if (u === 'ML') g = ssgMatch.spec_quantity
      setUnitWeightG(g)
    } else {
      setUnitWeightG(0)
    }
    setPackUnit(item.adjusted_pack_unit ?? ssgMatch.spec_unit?.toUpperCase() ?? 'EA')
    // 후보 변경 시 깜빡임 (1초)
    setHighlightSpec(true)
    const t = setTimeout(() => setHighlightSpec(false), 1200)
    return () => clearTimeout(t)
  }, [ssgMatch?.id, ssgMatch?.spec_quantity, ssgMatch?.spec_unit, item.adjusted_unit_weight_g, item.adjusted_pack_unit])

  // 자동 환산 버튼 — 검수 총량 ÷ 신세계 단위중량 = 발주수량 자동 계산 (2026-05-10)
  const handleAutoQuantity = () => {
    if (!existingWeightG || !unitWeightG || existingWeightG <= 0 || unitWeightG <= 0) return
    const total = existingWeightG * item.extracted_quantity
    const auto = Math.max(1, Math.round(total / unitWeightG))
    setQuantity(auto)
  }
  const canAutoQuantity = !!(
    existingWeightG && existingWeightG > 0 && unitWeightG > 0 && item.extracted_quantity > 0
  )

  // (2026-05-11) 자동 환산 추천도 — 정수배 차이면 강한 추천, 현재 quantity와 다르면 prominent
  const autoQuantitySuggestion = useMemo(() => {
    if (!canAutoQuantity || !existingWeightG || !unitWeightG) return null
    const total = existingWeightG * item.extracted_quantity
    const exact = total / unitWeightG
    if (exact <= 0) return null
    const rounded = Math.round(exact)
    const isInteger = Math.abs(exact - rounded) / exact < 0.01
    const ratioCurrent = (unitWeightG * quantity) / total
    const fourTimesPlus = ratioCurrent < 0.25 || ratioCurrent > 4
    return {
      suggested: rounded,
      isInteger,
      fourTimesPlus,
      // strong = 정수배 + 현재 quantity와 다름 + 4배+ 차이 → 즉시 클릭 권장
      strong: isInteger && rounded !== quantity && fourTimesPlus,
    }
  }, [canAutoQuantity, existingWeightG, unitWeightG, item.extracted_quantity, quantity])

  // 단가 변경 배지 — previous_price 있으면 변동률 표시 (2026-05-10)
  const priceChange = useMemo(() => {
    const prev = matchDetail?.previous_price
    const curr = ssgMatch?.standard_price
    if (!prev || !curr || prev === curr) return null
    const diff = curr - prev
    const pct = (diff / prev) * 100
    return { diff, pct, increased: diff > 0 }
  }, [matchDetail?.previous_price, ssgMatch?.standard_price])

  // 매칭 상세 lazy fetch (부모로 끌어올림 — commonTokens 계산용)
  useEffect(() => {
    if (!ssgMatch?.id) {
      setMatchDetail(null)
      return
    }
    let cancelled = false
    fetch(`/api/products/${ssgMatch.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && data.product) {
          setMatchDetail(data.product as ProductDetail)
          if (!ssgMatch.product_name && data.product.product_name) {
            setEnrichedMatch({ ...ssgMatch, product_name: data.product.product_name })
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ssgMatch?.id, setMatchDetail])

  // ssg_candidates에서 enrich (product_name이 비어있을 때)
  useEffect(() => {
    if (!ssgMatch || ssgMatch.product_name) return
    const found = (item.ssg_candidates ?? []).find((c) => c.id === ssgMatch.id)
    if (found && found.product_name) setEnrichedMatch({ ...ssgMatch, ...found })
  }, [item.ssg_candidates, ssgMatch])

  const ssgPerKg = useMemo(() => {
    if (!ssgMatch) return null
    return computeShinsegaePerKg(
      ssgMatch.standard_price,
      { quantity: ssgMatch.spec_quantity, unit: ssgMatch.spec_unit },
      ssgMatch.ppu,
    )
  }, [ssgMatch])

  const ssgPricePerPack = useMemo(() => {
    if (!ssgPerKg || !unitWeightG) return ssgMatch?.standard_price ?? 0
    return Math.round((ssgPerKg / 1000) * unitWeightG)
  }, [ssgPerKg, unitWeightG, ssgMatch])

  const ssgSubtotal = ssgPricePerPack * quantity
  const ssgTaxAmount = matchDetail?.tax_type === '과세' ? Math.round(ssgSubtotal * 0.1) : 0
  const ssgTotal = ssgSubtotal + ssgTaxAmount
  const savings = computeSavings(existingTotal, ssgTotal)
  const hasDiscrepancy = useMemo(() => {
    if (!existingWeightG || !unitWeightG) return false
    const ratio = existingWeightG > unitWeightG ? existingWeightG / unitWeightG : unitWeightG / existingWeightG
    return ratio > 4
  }, [existingWeightG, unitWeightG])

  // 차이 항목 검사 (검수자 직관 보조)
  const diffs = useMemo(() => {
    const list: { label: string; existing: string; ssg: string }[] = []
    if (existingWeightG && unitWeightG && existingWeightG !== unitWeightG) {
      list.push({ label: '단위 중량', existing: formatWeight(existingWeightG), ssg: formatWeight(unitWeightG) })
    }
    return list
  }, [existingWeightG, unitWeightG])

  // 검수자 의견 — DB 저장 (audit_items.reviewer_note, migration 041)
  // 1) item 변경 시 DB 값으로 초기화 (localStorage fallback 호환: 이전에 저장된 로컬 값 1회 마이그레이션)
  // 2) 입력 변경 시 600ms debounce 후 PATCH
  const [reviewerNote, setReviewerNote] = useState<string>('')
  useEffect(() => {
    let initial = item.reviewer_note ?? ''
    // localStorage 마이그레이션 — 이전 버전에서 로컬에만 저장됐던 값이 있으면 끌어옴
    if (!initial && typeof window !== 'undefined') {
      const local = window.localStorage.getItem(`reviewer_note_${item.id}`)
      if (local) {
        initial = local
        // DB로 옮긴 후 localStorage 삭제 (PATCH는 다음 useEffect가 처리)
        window.localStorage.removeItem(`reviewer_note_${item.id}`)
      }
    }
    setReviewerNote(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // 디바운스 PATCH — DB의 현재값과 다를 때만
  useEffect(() => {
    if (reviewerNote === (item.reviewer_note ?? '')) return
    const t = setTimeout(() => {
      void fetch(`/api/audit-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_note: reviewerNote || null }),
      }).catch((e) => console.warn('reviewer_note 저장 실패:', e))
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewerNote, item.id])

  const onNoteChange = (v: string) => setReviewerNote(v)

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border-2 border-gray-900 bg-white shadow-md">
      <div className="flex items-center justify-between border-b bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white">
        <span>🛒 신세계 매칭 자료</span>
        <div className="flex items-center gap-1.5">
          {ssgMatch && (
            <>
              <span className="rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">환산 적용</span>
              <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">✓ Matched</span>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!ssgMatch ? (
          <div className="flex h-24 items-center justify-center text-sm text-gray-400">
            매칭된 신세계 상품이 없습니다. 우측 후보에서 선택하세요.
          </div>
        ) : (
          <>
            {/* 제품명 + 메타 chips */}
            <h3 className="break-words text-2xl font-bold leading-tight text-gray-900">
              <HighlightedText
                text={ssgMatch.product_name || item.extracted_name}
                commonTokens={commonTokens}
              />
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-base">
              {matchDetail?.product_code && (
                /* (2026-05-11) 신세계 코드 강조 — 검수자가 3곳(좌측 리스트/매칭 자료/AI 추천)에서 동일 코드 즉시 인지 */
                <span className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-100 px-2 py-0.5 font-mono text-base font-bold text-blue-700 shadow-sm">
                  <Tag size={14} /> #{matchDetail.product_code}
                </span>
              )}
              {/* 규격 — spec_raw 전체 우선 (예: "1KG, 1.5CM 슬라이스"), 없으면 spec_quantity+spec_unit fallback */}
              {(matchDetail?.spec_raw || (ssgMatch.spec_quantity != null && ssgMatch.spec_unit)) && (
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
                  <Boxes size={14} className="shrink-0" />
                  <HighlightedText
                    text={matchDetail?.spec_raw || `${ssgMatch.spec_quantity}${ssgMatch.spec_unit}`}
                    commonTokens={commonTokens}
                  />
                </span>
              )}
              {/* 포장 단위 — unit_raw가 spec_raw에 포함 안 된 추가 정보 (예: "/봉") */}
              {matchDetail?.unit_raw &&
                matchDetail.unit_raw.toLowerCase() !== (ssgMatch.spec_unit ?? '').toLowerCase() &&
                !(matchDetail.spec_raw ?? '').toLowerCase().includes(matchDetail.unit_raw.toLowerCase()) && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
                    <Package size={14} className="shrink-0" /> {matchDetail.unit_raw}
                  </span>
                )}
              {matchDetail?.origin && (
                <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-0.5 text-green-700">
                  <MapPin size={14} />
                  <HighlightedText text={matchDetail.origin} commonTokens={commonTokens} highlightClassName="font-bold" />
                  {matchDetail.origin_detail && (
                    <span className="ml-1 text-xs text-green-600">({matchDetail.origin_detail})</span>
                  )}
                </span>
              )}
              {matchDetail?.tax_type && (
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5',
                    matchDetail.tax_type === '면세' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                  )}
                >
                  {matchDetail.tax_type}
                </span>
              )}
              {matchDetail?.storage_temp && (
                <span className="inline-flex items-center gap-1 rounded-md bg-cyan-100 px-2 py-0.5 text-cyan-700">
                  <Snowflake size={14} /> {matchDetail.storage_temp}
                </span>
              )}
              {matchDetail?.category && (
                <span className="rounded-md bg-purple-100 px-2 py-0.5 text-purple-700">
                  {matchDetail.category}
                  {matchDetail.subcategory && `·${matchDetail.subcategory}`}
                </span>
              )}
              {/* 단가 변경 배지 — previous_price 있으면 변동률 (2026-05-10) */}
              {priceChange && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-xs font-semibold',
                    priceChange.increased
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700',
                  )}
                  title={`이전 단가 ${formatCurrency(matchDetail!.previous_price!)} → 현재 ${formatCurrency(ssgMatch.standard_price)}`}
                >
                  {priceChange.increased ? '▲' : '▼'} {Math.abs(priceChange.pct).toFixed(1)}%
                </span>
              )}
            </div>

            {/* 자동 환산 도우미 — 검수 총량 ÷ 신세계 단위중량 = 발주수량 (2026-05-10) */}
            {/* (2026-05-11) strong 추천 시 pulse 애니메이션 + 진한 색상 */}
            {canAutoQuantity && (
              <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-gray-500">
                <span>
                  총량 환산 시 발주수량:{' '}
                  <strong className="font-mono text-gray-800">
                    {autoQuantitySuggestion?.suggested ?? Math.max(
                      1,
                      Math.round((existingWeightG! * item.extracted_quantity) / unitWeightG),
                    )}{' '}
                    {packUnit}
                  </strong>
                  {autoQuantitySuggestion?.strong && (
                    <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-700">
                      ⚠ 4배+ 차이 — 환산 권장
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleAutoQuantity}
                  className={cn(
                    'rounded border px-2 py-0.5 text-[11px] font-semibold',
                    autoQuantitySuggestion?.strong
                      ? 'animate-pulse border-blue-500 bg-blue-600 text-white shadow ring-2 ring-blue-300 hover:bg-blue-700'
                      : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
                  )}
                  title={`검수 총량(${formatWeight(existingWeightG! * item.extracted_quantity)}) ÷ 신세계 단위중량(${formatWeight(unitWeightG)})`}
                >
                  📐 자동 환산
                </button>
              </div>
            )}

            {/* 금액 5분할 한 줄 */}
            <div
              className={cn(
                'mt-1.5 grid grid-cols-5 gap-1 rounded-md transition-all',
                highlightSpec && 'ring-2 ring-yellow-300 bg-yellow-50',
              )}
            >
              <FinanceInputCardCompact label="단위중량" value={unitWeightG} suffix="g" onChange={setUnitWeightG} />
              <FinanceInputCardCompact
                label="발주"
                value={quantity}
                suffix={packUnit}
                onChange={setQuantity}
                packUnit={packUnit}
                onPackUnitChange={setPackUnit}
              />
              <FinanceCardCompact
                label="환산단가"
                value={formatCurrency(ssgPricePerPack)}
                sub={ssgPerKg ? `₩${formatNumber(ssgPerKg)}/kg` : undefined}
                highlight="blue"
              />
              <FinanceCardCompact
                label="부가세"
                value={formatCurrency(ssgTaxAmount)}
                sub={matchDetail?.tax_type === '면세' ? '면세' : matchDetail?.tax_type === '과세' ? '10%' : undefined}
              />
              <FinanceCardCompact
                label="총액"
                value={formatCurrency(ssgTotal)}
                sub={ssgTaxAmount > 0 ? `공급 ${formatCurrency(ssgSubtotal)}` : undefined}
                highlight="indigo"
              />
            </div>

            {/* 총 발주량 (단위중량 × 발주수량 = 총 g) */}
            {unitWeightG > 0 && quantity > 0 && (() => {
              const ssgTotalG = unitWeightG * quantity
              const existingTotalG = existingWeightG ? existingWeightG * item.extracted_quantity : 0
              const matched = existingTotalG > 0 && Math.abs(ssgTotalG - existingTotalG) < existingTotalG * 0.05
              return (
                <div
                  className={cn(
                    'mt-1.5 flex items-center gap-2 rounded-md px-2.5 py-1 ring-1',
                    matched ? 'bg-emerald-50 ring-emerald-200' : 'bg-amber-50 ring-amber-200',
                  )}
                >
                  <span className={cn('text-[11px] font-semibold', matched ? 'text-emerald-700' : 'text-amber-700')}>
                    총 발주량
                  </span>
                  <span className="font-mono text-xs text-gray-700">
                    {formatWeight(unitWeightG)} × {formatNumber(quantity)} {packUnit}
                  </span>
                  <span className="text-xs text-gray-400">=</span>
                  <span className={cn('text-sm font-bold', matched ? 'text-emerald-900' : 'text-amber-900')}>
                    {formatWeight(ssgTotalG)}
                  </span>
                  {existingTotalG > 0 && (
                    <span className={cn('ml-auto text-[11px]', matched ? 'text-emerald-700' : 'text-amber-700')}>
                      {matched ? '✓ 기존과 일치' : `기존 ${formatWeight(existingTotalG)} 대비 ${ssgTotalG > existingTotalG ? '+' : ''}${formatWeight(ssgTotalG - existingTotalG)}`}
                    </span>
                  )}
                </div>
              )
            })()}

            {/* 절감 한 줄 (Confirm은 아래 검수자 의견 줄로 이동) */}
            <div
              className={cn(
                'mt-1.5 flex items-baseline justify-between rounded-md px-2.5 py-1 ring-1',
                savings.isSaving ? 'bg-green-50 ring-green-200' : 'bg-red-50 ring-red-200',
              )}
            >
              <span className="text-[11px] text-gray-600">기존 {formatCurrency(existingTotal)}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  savings.isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
                )}
              >
                {savings.isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(savings.amount))} ({savings.percent.toFixed(1)}%)
              </span>
            </div>

            {/* 차이/규격 경고 — 컴팩트, 한 줄 */}
            {(diffs.length > 0 || hasDiscrepancy) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle size={12} className="shrink-0" />
                {diffs.map((d, i) => (
                  <span key={i}>
                    {d.label}: <strong>{d.existing}</strong> ≠ <strong>{d.ssg}</strong>
                  </span>
                ))}
                {hasDiscrepancy && <span className="font-semibold text-red-700">⚠️ 규격 4배+ 차이</span>}
              </div>
            )}

            {/* 검수자 의견 + Confirm — 한 줄 (textarea 좌, 버튼 우) */}
            <div className="mt-1.5 flex items-stretch gap-2">
              <label className="flex flex-1 items-start gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 focus-within:border-blue-400 focus-within:bg-white">
                <MessageSquare size={14} className="mt-1 shrink-0 text-gray-400" />
                <textarea
                  value={reviewerNote}
                  onChange={(e) => onNoteChange(e.target.value)}
                  onBlur={() => {
                    // textarea blur 즉시 PATCH (다른 품목 이동/Confirm 클릭 시 debounce 손실 방지)
                    if (reviewerNote !== (item.reviewer_note ?? '')) {
                      void fetch(`/api/audit-items/${item.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reviewer_note: reviewerNote || null }),
                      }).catch((e) => console.warn('reviewer_note onBlur 저장 실패:', e))
                    }
                  }}
                  placeholder="검수자 의견 (AI 학습용) — 예: '실제로는 차수수 국내산이 맞음'"
                  rows={2}
                  className="w-full resize-none bg-transparent text-xs text-gray-800 placeholder-gray-400 focus:outline-none"
                />
              </label>
              <button
                onClick={() => {
                  // 검수자 의견 즉시 PATCH (debounce 우회) — Confirm 직후 unmount 시 600ms 타이머 취소되어 손실 방지
                  if (reviewerNote !== (item.reviewer_note ?? '')) {
                    void fetch(`/api/audit-items/${item.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ reviewer_note: reviewerNote || null }),
                    }).catch((e) => console.warn('reviewer_note 저장 실패:', e))
                  }
                  onConfirm({
                    adjusted_quantity: quantity,
                    adjusted_unit_weight_g: unitWeightG || undefined,
                    adjusted_pack_unit: packUnit,
                  })
                }}
                className="flex shrink-0 items-center gap-1 self-stretch rounded-md bg-blue-600 px-3 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                <CheckCircle2 size={14} /> Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/* 금액 입력 카드 (수정 가능) */
function FinanceInputCard({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="rounded-lg border bg-gray-50 p-2">
      <div className="text-[9px] font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full rounded border border-gray-300 bg-white px-1 py-0.5 text-sm font-bold focus:border-blue-500 focus:outline-none"
        />
        {suffix && <span className="text-[10px] text-gray-500">{suffix}</span>}
      </div>
    </label>
  )
}


/* 컴팩트 금액 입력 카드 (단위중량/발주수량 — 한 줄 5분할 안에 들어감) */
function FinanceInputCardCompact({
  label,
  value,
  suffix,
  onChange,
  packUnit,
  onPackUnitChange,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (v: number) => void
  /** 발주 카드일 때 포장 단위도 함께 표시/변경 */
  packUnit?: string
  onPackUnitChange?: (u: string) => void
}) {
  return (
    <div className="rounded border bg-gray-50 px-1.5 py-1 ring-1 ring-gray-100">
      <div className="text-[9px] font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-0.5">
        <input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1 py-0 text-sm font-bold leading-tight focus:border-blue-500 focus:outline-none"
        />
        {onPackUnitChange && packUnit ? (
          <select
            value={packUnit}
            onChange={(e) => onPackUnitChange(e.target.value)}
            className="shrink-0 rounded border border-gray-300 bg-white px-0.5 py-0 text-[10px] focus:border-blue-500 focus:outline-none"
          >
            {PACK_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        ) : suffix ? (
          <span className="shrink-0 text-[10px] text-gray-500">{suffix}</span>
        ) : null}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 우(col-4): 후보 + 검색 (검색 카드 하단 고정)                   */
/* ────────────────────────────────────────────────────────── */
function CandidatesAndSearchPanel({
  item,
  sortMode,
  onSortChange,
  onSelectCandidate,
}: {
  item: ComparisonItem
  sortMode: SortMode
  onSortChange: (m: SortMode) => void
  onSelectCandidate: (c: SupplierMatch) => void
}) {
  // (2026-05-11) 옵션 A: flicker 방지 — 마운트 시 빈 배열로 시작, fetch 완료 후 단일 setState로 merge.
  // 이전: useState init에서 ssg_candidates 즉시 표시 → fetch 후 merged로 재정렬 → #1이 #5로 밀리는 깜빡임
  // 변경: 빈 배열 + 로딩 스켈레톤 → fetch 완료 시 한 번에 표시 → sort 1회만 발생
  // fetch 실패/timeout fallback: dbCandsAtMount로 set
  const [liveCandidates, setLiveCandidates] = useState<SupplierMatch[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SupplierMatch[]>([])
  const [searching, setSearching] = useState(false)
  const candidates = liveCandidates
  const ssgMatch = item.ssg_match
  const existingTotal = getExistingTotal(item)

  // 후보 자동 채움 — 항목 변경 시 1회 lazy fetch + DB 후보와 merge (2026-05-04, 2026-05-11 flicker fix)
  // 매칭 시점의 후보가 잘못된 경우 (예: 느타리버섯 → 유리창닦이) 실시간 검색으로 보충
  useEffect(() => {
    const q = item.extracted_name?.trim()
    const dbCandsAtMount = item.ssg_candidates ?? []
    if (!q) {
      // query 없으면 fetch 생략하고 DB 후보만 표시
      setLiveCandidates(dbCandsAtMount)
      setLoadingCandidates(false)
      return
    }
    let cancelled = false
    setLoadingCandidates(true)
    setLiveCandidates([]) // 항목 전환 시 이전 후보 즉시 비움 (잘못된 정렬 표시 방지)
    fetch(`/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=30`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && Array.isArray(data.products)) {
          const fresh = data.products as SupplierMatch[]
          const freshMap = new Map(fresh.map((p) => [p.id, p]))
          // (2026-05-12) DB 저장 후보를 fresh 결과로 enrich
          // DB 저장 ssg_candidates는 이전 매칭 시점 — tax_type/origin/spec_raw 등 누락 가능
          // fresh가 같은 id 후보를 갖고 있으면 fresh 데이터로 덮어써 누락 필드 보충
          const dbIds = new Set(dbCandsAtMount.map((c) => c.id))
          const enrichedDb = dbCandsAtMount.map((c) => {
            const f = freshMap.get(c.id)
            return f ? { ...c, ...f } : c
          })
          const newFresh = fresh.filter((p) => !dbIds.has(p.id))
          const merged = [...enrichedDb, ...newFresh]
          setLiveCandidates(merged)
        } else {
          // API 실패 fallback — DB 후보라도 표시
          setLiveCandidates(dbCandsAtMount)
        }
      })
      .catch(() => {
        if (!cancelled) setLiveCandidates(dbCandsAtMount)
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.extracted_name])

  // (2026-05-11) 정렬용 query 정제 — extracted_name이 OCR 그대로면 spec/원산지가 토큰 분해를 깨뜨림
  // 예: "세척무우(특품 1.5KG/EA)" → tokens 4개 → 세척무 ratio 0.25, 가공품도 0.33으로 위로
  // cleanProductQuery 적용 시 "세척무우" → 세척무 0.75, 가공품 0.00 (정상)
  const cleanedItemName = useMemo(
    () => cleanProductQuery(item.extracted_name ?? ''),
    [item.extracted_name],
  )

  // 토큰 매칭 비율 캐시 (정렬용 + UI 표시용)
  // 표시용은 원본 extracted_name 사용 (사용자가 본 OCR 텍스트와 동일), 정렬용은 cleaned
  // (2026-05-12) spec_raw 통합 — 가공정보(다짐육/컷팅/슬라이스 등)가 spec_raw에만 있는 경우
  //   '돈민찌' vs '돈앞다리 국내산 냉동 + spec=1KG, 다짐육' → name 단독 매칭 0이지만
  //   name+spec 합치면 합성어 suffix matching으로 다짐육 후보 발굴 → ratio 1.0
  const candidateConfidences = useMemo(() => {
    const map = new Map<string, MatchConfidence>()
    for (const c of candidates) {
      const name = c.product_name ?? ''
      const spec = c.spec_raw ?? ''
      const c1 = getMatchConfidence(cleanedItemName, name)
      if (!spec) {
        map.set(c.id, c1)
        continue
      }
      const c2 = getMatchConfidence(cleanedItemName, `${name} ${spec}`)
      // ratio 큰 쪽 우선
      map.set(c.id, c2.matchRatio > c1.matchRatio ? c2 : c1)
    }
    return map
  }, [candidates, cleanedItemName])

  // 기존 업체 품목 원산지 (정렬 가중치용)
  const itemOrigin = useMemo(() => getItemOrigin(item), [item])

  // (2026-05-11) 검수 품목 tax_type — 면세 검수면 면세 후보 우선
  // 농/축/수산 면세 품목 (쌀/소고기/생선 등)이 과세 가공품과 동일 선상 경쟁하던 문제 해결
  const itemTaxType: '면세' | '과세' = (item.extracted_tax_amount ?? 0) === 0 ? '면세' : '과세'

  // (2026-05-11) 검수 단위중량 — 단위중량 가까운 후보 우선 정렬용
  // 예: '쌀 20kg' 검수 → 신세계 20kg 양곡 후보 우선, 1kg 가공품 후순위
  const itemWeightG =
    unitToGrams(item.extracted_unit) ??
    parseSpecToGrams(item.extracted_spec) ??
    parseSpecToGrams(item.extracted_name) ??
    specToUnitFallback(item.extracted_spec) ??
    specToUnitFallback(item.extracted_name) ??
    0
  const candWeightOf = (c: SupplierMatch): number => {
    if (c.spec_quantity == null || !c.spec_unit) return 0
    const u = c.spec_unit.toUpperCase()
    if (u === 'KG' || u === 'L') return c.spec_quantity * 1000
    if (u === 'G' || u === 'ML') return c.spec_quantity
    return 0
  }
  const weightCloseness = (cw: number): number => {
    if (!itemWeightG || itemWeightG <= 0 || cw <= 0) return 0
    return Math.min(itemWeightG, cw) / Math.max(itemWeightG, cw)
  }

  const itemIsProcessedRef = isProcessedProduct(cleanedItemName)
  const sortedCandidates = useMemo(() => {
    const list = [...candidates]
    // 가공품 페널티: ratio - 0.3 → 가공품 0.6 < 식자재 0.4가 안 되도록 (식자재 0.4 > 가공품 0.3)
    const PROC_PENALTY = 0.3
    const adjusted = (name: string, baseRatio: number) =>
      !itemIsProcessedRef && isProcessedProduct(name) ? baseRatio - PROC_PENALTY : baseRatio
    list.sort((a, b) => {
      if (sortMode === 'match') {
        // 1) 토큰 매칭 비율 (가공품 페널티 차감) — "참고" 항목 자동 맨 아래
        const aR = adjusted(a.product_name, candidateConfidences.get(a.id)?.matchRatio ?? 0)
        const bR = adjusted(b.product_name, candidateConfidences.get(b.id)?.matchRatio ?? 0)
        if (aR !== bR) return bR - aR

        // 2) 원산지 일치 우선
        if (itemOrigin !== 'UNKNOWN') {
          const aOriginMatch = normalizeOrigin(a.origin || a.product_name) === itemOrigin
          const bOriginMatch = normalizeOrigin(b.origin || b.product_name) === itemOrigin
          if (aOriginMatch !== bOriginMatch) return aOriginMatch ? -1 : 1
        }

        // 3) tax_type 일치 우선 (면세 검수 → 면세 후보 우선, 2026-05-11)
        if (a.tax_type && b.tax_type && a.tax_type !== b.tax_type) {
          if (a.tax_type === itemTaxType) return -1
          if (b.tax_type === itemTaxType) return 1
        }

        // 4) 단위중량 가까움 (2026-05-11) — '쌀 20kg' 검수 → 신세계 20kg 양곡 후보 우선
        // 검수 단위중량과 후보 단위중량 비율(0~1)이 큰 후보가 위
        if (itemWeightG > 0) {
          const aw = weightCloseness(candWeightOf(a))
          const bw = weightCloseness(candWeightOf(b))
          if (Math.abs(aw - bw) > 0.1) return bw - aw
        }

        // 5) 마지막 tiebreak — score
        return (b.match_score ?? 0) - (a.match_score ?? 0)
      }
      if (sortMode === 'price') return (a.standard_price ?? 0) - (b.standard_price ?? 0)
      if (sortMode === 'per_kg') {
        const aPk =
          computeShinsegaePerKg(a.standard_price, { quantity: a.spec_quantity, unit: a.spec_unit }, a.ppu) ??
          Number.MAX_SAFE_INTEGER
        const bPk =
          computeShinsegaePerKg(b.standard_price, { quantity: b.spec_quantity, unit: b.spec_unit }, b.ppu) ??
          Number.MAX_SAFE_INTEGER
        return aPk - bPk
      }
      if (sortMode === 'savings') {
        return candidateSavings(b, item, existingTotal) - candidateSavings(a, item, existingTotal)
      }
      return 0
    })
    return list.slice(0, 10)
  }, [candidates, sortMode, item, existingTotal, candidateConfidences, itemOrigin, itemIsProcessedRef, itemTaxType, itemWeightG])

  // 검색 결과도 토큰 + origin 가중치로 정렬 (사용자 요청 — 매칭/후보/검색 모두 일관성)
  const sortedSearchResults = useMemo(() => {
    if (searchResults.length === 0) return [] as SupplierMatch[]
    // 가공품 페널티 (-0.3) — 검수가 가공품이 아닐 때만, ratio 차이가 있어도 식자재 우선
    // (2026-05-11) cleaned query 사용 — OCR 노이즈 토큰 제거
    const PROC_PENALTY = 0.3
    const adjusted = (name: string, baseRatio: number) =>
      !itemIsProcessedRef && isProcessedProduct(name) ? baseRatio - PROC_PENALTY : baseRatio
    return [...searchResults].sort((a, b) => {
      const aR = adjusted(a.product_name, getMatchConfidence(cleanedItemName, a.product_name).matchRatio)
      const bR = adjusted(b.product_name, getMatchConfidence(cleanedItemName, b.product_name).matchRatio)
      if (aR !== bR) return bR - aR
      if (itemOrigin !== 'UNKNOWN') {
        const aOriginMatch = normalizeOrigin(a.origin || a.product_name) === itemOrigin
        const bOriginMatch = normalizeOrigin(b.origin || b.product_name) === itemOrigin
        if (aOriginMatch !== bOriginMatch) return aOriginMatch ? -1 : 1
      }
      // tax_type 일치 우선 (2026-05-11)
      if (a.tax_type && b.tax_type && a.tax_type !== b.tax_type) {
        if (a.tax_type === itemTaxType) return -1
        if (b.tax_type === itemTaxType) return 1
      }
      return (b.match_score ?? 0) - (a.match_score ?? 0)
    })
  }, [searchResults, cleanedItemName, itemIsProcessedRef, itemOrigin, itemTaxType])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearching(true)
    try {
      // broad=true: 다중 필드 검색 (spec/origin/category/subcategory/협력사) — limit 50 (사용자가 모두 보기 위함)
      // limit=30: 다양한 결과 수집 후 토큰 정렬에서 best 위로
      const res = await fetch(
        `/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=50&broad=true`,
      )
      const data = await res.json()
      if (data.success && Array.isArray(data.products)) {
        setSearchResults(data.products as SupplierMatch[])
      }
    } catch (e) {
      console.warn('manual search 실패:', e)
    } finally {
      setSearching(false)
    }
  }, [])

  return (
    <section className="col-span-4 flex min-h-0 flex-col gap-3">
      {/* 후보 리스트 (flex-1) */}
      <div className="flex flex-1 min-h-0 flex-col rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
          <span>🤖 AI 추천 후보 (Top 10)</span>
          <select
            value={sortMode}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs"
          >
            {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
              <option key={m} value={m}>
                {SORT_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {sortedCandidates.length === 0 && (
            <div className="rounded-lg border border-dashed bg-gray-50 p-4 text-center text-xs text-gray-400">
              {loadingCandidates ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> 후보 검색 중…
                </span>
              ) : (
                '아래 검색 카드에서 직접 검색하세요.'
              )}
            </div>
          )}
          <div className="space-y-2">
            {sortedCandidates.map((c, i) => {
              const conf = candidateConfidences.get(c.id) ?? getMatchConfidence(cleanedItemName, c.product_name)
              return (
                <CandidateCard
                  key={c.id}
                  index={i + 1}
                  candidate={c}
                  isSelected={ssgMatch?.id === c.id}
                  item={item}
                  existingTotal={existingTotal}
                  confidence={conf}
                  onSelect={() => {
                    // 참고(ratio < MIN_VALID_MATCH_RATIO=0.3) 후보는 확인 후 선택 (실수 방지, 2026-05-10)
                    if (conf.matchRatio < 0.3) {
                      const ok = window.confirm(
                        `매칭 신뢰도가 낮습니다 (${conf.label}, ratio ${conf.matchRatio.toFixed(2)}).\n\n` +
                          `검수 품목: ${item.extracted_name}\n후보: ${c.product_name}\n\n` +
                          `정말 선택하시겠습니까?`,
                      )
                      if (!ok) return
                    }
                    onSelectCandidate(c)
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* 검정 검색 카드 (h-fit, 항상 보임) */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-gray-900 shadow-md">
        <div className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-white">
          <span className="flex items-center gap-1.5">
            <Search size={14} /> 신세계 DB 직접 검색
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-400">Manual Search</span>
        </div>
        <div className="border-t border-gray-700 p-3">
          <div className="flex items-center gap-2 rounded-lg bg-white px-2 py-1">
            <Search size={14} className="text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(searchQuery)
              }}
              placeholder="품목명, 코드, 규격…"
              className="flex-1 border-none bg-transparent text-sm focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setSearchResults([])
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
            <button
              onClick={() => runSearch(searchQuery)}
              disabled={!searchQuery.trim() || searching}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {searching ? <Loader2 size={12} className="animate-spin" /> : 'SEARCH'}
            </button>
          </div>
        </div>
        {(searching || searchResults.length > 0) && (
          <div className="max-h-[480px] overflow-y-auto border-t border-gray-700 p-2">
            {searching && (
              <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> 검색 중…
              </div>
            )}
            {!searching && searchResults.length > 0 && (
              <div className="px-1 pb-1.5 text-[11px] text-gray-400">
                총 {sortedSearchResults.length}개 결과 (스크롤하여 모두 보기)
              </div>
            )}
            <div className="space-y-1.5">
              {sortedSearchResults.map((r) => {
                const pk = computeShinsegaePerKg(
                  r.standard_price,
                  { quantity: r.spec_quantity, unit: r.spec_unit },
                  r.ppu,
                )
                // 자세한 규격 텍스트 (검색 결과)
                const parts: string[] = []
                if (r.spec_raw) parts.push(r.spec_raw)
                else if (r.spec_quantity != null && r.spec_unit) parts.push(`${r.spec_quantity}${r.spec_unit}`)
                if (r.unit_raw && !parts.some((s) => s.toLowerCase().includes(r.unit_raw!.toLowerCase()))) parts.push(`/${r.unit_raw}`)
                if (r.origin) {
                  parts.push(`· ${r.origin}${r.origin_detail ? ` (${r.origin_detail})` : ''}`)
                }
                if (r.storage_temp) parts.push(`· ${r.storage_temp}`)
                if (r.category) parts.push(`· ${r.category}${r.subcategory ? ` / ${r.subcategory}` : ''}`)
                if (r.product_code) parts.push(`· #${r.product_code}`)
                const specText = parts.join(' ')
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      onSelectCandidate(r)
                      setSearchResults([])
                      setSearchQuery('')
                    }}
                    className="flex w-full items-stretch gap-2 rounded-lg bg-white/5 p-2 text-left ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-bold text-white" title={r.product_name}>
                        {r.product_name}
                      </div>
                      {specText && (
                        <div className="mt-0.5 break-words text-[10px] text-gray-400">{specText}</div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-300">
                        <span className="font-bold text-emerald-400">{formatCurrency(r.standard_price)}</span>
                        {pk ? <span>· ₩{formatNumber(pk)}/kg</span> : null}
                        {r.tax_type && (
                          <span
                            className={cn(
                              'rounded px-1 py-0 text-[10px]',
                              r.tax_type === '면세' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-amber-500/30 text-amber-200',
                            )}
                          >
                            {r.tax_type}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="self-center text-[11px] font-medium text-blue-300 underline">선택</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 후보 카드                                                     */
/* ────────────────────────────────────────────────────────── */
interface CandidateCardProps {
  index: number
  candidate: SupplierMatch
  isSelected: boolean
  item: ComparisonItem
  existingTotal: number
  confidence: MatchConfidence  // 토큰 기반 신뢰도 (부모에서 계산)
  onSelect: () => void
}

function CandidateCard({
  index,
  candidate,
  isSelected,
  item,
  existingTotal,
  confidence: conf,
  onSelect,
}: CandidateCardProps) {
  const score = candidate.match_score ?? 0
  const perKg = computeShinsegaePerKg(
    candidate.standard_price,
    { quantity: candidate.spec_quantity, unit: candidate.spec_unit },
    candidate.ppu,
  )
  const sav = candidateSavings(candidate, item, existingTotal)
  const isSaving = sav > 0

  // 원산지 일치 여부 (검수자 직관 — 국내산 vs 중국 등)
  const itemOriginCard = getItemOrigin(item)
  // origin 컬럼 누락 시 product_name에서 추출 (예: "세척당근 중국" → CN)
  const candOriginCard = normalizeOrigin(candidate.origin || candidate.product_name)
  const originMismatch =
    itemOriginCard !== 'UNKNOWN' && candOriginCard !== 'UNKNOWN' && itemOriginCard !== candOriginCard

  // 자세한 규격 텍스트 조립 (사용자 요청 #2/#3): 시각적으로 분리된 회색 라인
  const specParts: string[] = []
  if (candidate.spec_raw) specParts.push(candidate.spec_raw)
  else if (candidate.spec_quantity != null && candidate.spec_unit) {
    specParts.push(`${candidate.spec_quantity}${candidate.spec_unit}`)
  }
  if (candidate.unit_raw && !specParts.some((s) => s.toLowerCase().includes(candidate.unit_raw!.toLowerCase()))) {
    specParts.push(`/${candidate.unit_raw}`)
  }
  if (candidate.origin) {
    // 원산지상세가 있으면 함께 표시 (예: "외국산 (호주 등)")
    specParts.push(
      `· ${candidate.origin}${candidate.origin_detail ? ` (${candidate.origin_detail})` : ''}`,
    )
  }
  if (candidate.storage_temp) specParts.push(`· ${candidate.storage_temp}`)
  if (candidate.category) {
    specParts.push(`· ${candidate.category}${candidate.subcategory ? ` / ${candidate.subcategory}` : ''}`)
  }
  // (2026-05-11) product_code는 chip 배지로 별도 표시 (specParts에서 제외)
  const specText = specParts.join(' ')

  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-stretch gap-3 rounded-lg border p-3 text-left transition',
        isSelected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40',
      )}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <Package size={22} />
      </div>
      <div className="min-w-0 flex-1">
        {/* 상단: #N + 제품명 (큰 볼드) + 우측 신뢰도 라벨 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-sm font-bold text-gray-400">#{index}</span>
              <h4 className="break-words text-base font-bold leading-tight text-gray-900" title={candidate.product_name}>
                {candidate.product_name}
              </h4>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {/* (2026-05-11) 신세계 코드 강조 chip — 현재 매칭된 후보만 표시 (사용자 피드백 반영) */}
              {/* 일반 후보는 코드 숨김 — 검수자가 매칭/컨펌 시점에만 코드 인지 */}
              {candidate.product_code && isSelected && (
                <span className="inline-flex items-center rounded bg-blue-600 px-1.5 py-0 font-mono text-[11px] font-bold text-white ring-1 ring-blue-700">
                  #{candidate.product_code}
                </span>
              )}
              {isSelected && (
                <span className="inline-flex rounded bg-blue-600 px-1.5 py-0 text-[10px] font-semibold text-white">
                  현재 매칭
                </span>
              )}
              {originMismatch && (
                <span
                  className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0 text-[10px] font-semibold text-red-700"
                  title={`원산지 다름 — 기존: ${itemOriginCard}, 후보: ${candOriginCard}`}
                >
                  ⚠️ 원산지 다름 ({candidate.origin})
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span
              className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold', conf.bgColor, conf.textColor)}
              title={`토큰 매칭 ${(conf.matchRatio * 100).toFixed(0)}% · score ${score.toFixed(4)}`}
            >
              {conf.label} {conf.matchRatio > 0 && conf.matchRatio < 1.5 ? `${Math.round(conf.matchRatio * 100)}%` : ''}
            </span>
            <span className="text-[9px] text-gray-400">점수 {(score * 1000).toFixed(1)}</span>
          </div>
        </div>

        {/* 자세한 규격 라인 (시각적 분리 — 회색 작은 텍스트, 원산지 mismatch면 빨간 강조) */}
        {specText && (
          <div className={cn('mt-1 break-words text-[11px]', originMismatch ? 'text-red-600' : 'text-gray-500')}>
            {specText}
          </div>
        )}

        {/* 가격 / 환산단가 / 면세 */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-bold text-gray-900">{formatCurrency(candidate.standard_price)}</span>
          {perKg && <span className="text-gray-600">· ₩{formatNumber(perKg)}/kg</span>}
          {candidate.tax_type && (
            <span
              className={cn(
                'rounded px-1 py-0 text-[10px]',
                candidate.tax_type === '면세' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
              )}
            >
              {candidate.tax_type}
            </span>
          )}
        </div>

        {/* 절감액 + 선택 */}
        {sav !== 0 && (
          <div className="mt-2 flex items-center justify-between border-t pt-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
                isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
              )}
            >
              {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))} {isSaving ? '절감' : '추가'}
            </span>
            <span className="text-[11px] font-medium text-blue-600 underline">
              {isSelected ? '선택됨' : '선택'}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}

/* ────────────────────────────────────────────────────────── */
interface KeyHandlerProps {
  onPrev: () => void
  onNext: () => void
  onConfirm: () => void
  onSelectCandidate: (idx: number) => void
}

function KeyboardHandler({ onPrev, onNext, onConfirm, onSelectCandidate }: KeyHandlerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const isInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      if (isInput) return

      if (e.key === 'p' || e.key === 'P' || e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        onSelectCandidate(Number(e.key) - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext, onConfirm, onSelectCandidate])
  return null
}
