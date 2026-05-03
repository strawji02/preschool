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
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ArrowLeft, ArrowRight, ChevronDown, Search, Package, Loader2, AlertTriangle,
  FileImage, CheckCircle2, CheckCircle, Tag, MapPin, Snowflake, Boxes, X, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { PdfModal } from '../SplitView/PdfModal'
import { formatCurrency, formatNumber } from '@/lib/format'
import {
  parseSpecToGrams, pricePerKg, computeShinsegaePerKg, computeSavings,
} from '@/lib/unit-conversion'

interface PrecisionMatchingViewProps {
  items: ComparisonItem[]
  pages?: PageImage[]
  supplierName?: string
  sessionId?: string
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string, supplier?: Supplier) => void
  onConfirmAllAutoMatched: () => void
  onAutoExcludeUnmatched?: () => void
  onProceedToReport: () => void
  onReload?: () => void
}

interface ProductDetail {
  id: string
  product_code?: string
  product_name?: string
  category?: string
  subcategory?: string
  origin?: string
  tax_type?: '과세' | '면세'
  storage_temp?: string
  supply_status?: string
  spec_raw?: string
  unit_raw?: string
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
/* 단순 환산 절감액 (후보별) — 표준가 × 수량                     */
/* ────────────────────────────────────────────────────────── */
function candidateSavings(c: SupplierMatch, item: ComparisonItem, existingTotal: number): number {
  const candTotal = c.standard_price * (item.adjusted_quantity ?? item.extracted_quantity)
  return existingTotal - candTotal
}

function getExistingTotal(item: ComparisonItem): number {
  return item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
}

/* 항목별 예상 신세계 견적 (정밀 환산이 가능하면 ppk × 단위중량 × 수량, 아니면 표준가 × 수량) */
function estimateSsgTotal(item: ComparisonItem): number {
  const m = item.ssg_match
  if (!m) return 0
  const ppk = computeShinsegaePerKg(m.standard_price, { quantity: m.spec_quantity, unit: m.spec_unit }, m.ppu)
  const qty = item.adjusted_quantity ?? item.extracted_quantity
  if (ppk && item.adjusted_unit_weight_g) {
    return Math.round((ppk / 1000) * item.adjusted_unit_weight_g) * qty
  }
  if (ppk && m.spec_quantity && m.spec_unit) {
    const u = m.spec_unit.toUpperCase()
    let g = 0
    if (u === 'KG') g = m.spec_quantity * 1000
    else if (u === 'G') g = m.spec_quantity
    else if (u === 'L') g = m.spec_quantity * 1000
    else if (u === 'ML') g = m.spec_quantity
    if (g > 0) return Math.round((ppk / 1000) * g) * qty
  }
  return m.standard_price * qty
}

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
}: PrecisionMatchingViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('match')
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)
  const [rematching, setRematching] = useState(false)
  const [rematchResult, setRematchResult] = useState<{ rematched: number; stillUnmatched: number; total: number } | null>(null)

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

  const moveToNext = useCallback(() => {
    if (visibleIndices.length === 0) return
    if (visiblePos === -1) {
      setSelectedIndex(visibleIndices[0])
      return
    }
    const next = visibleIndices[visiblePos + 1]
    if (next != null) setSelectedIndex(next)
  }, [visibleIndices, visiblePos])

  const moveToPrev = useCallback(() => {
    if (visibleIndices.length === 0) return
    if (visiblePos === -1) {
      setSelectedIndex(visibleIndices[0])
      return
    }
    const prev = visibleIndices[visiblePos - 1]
    if (prev != null) setSelectedIndex(prev)
  }, [visibleIndices, visiblePos])

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
        />

        {/* 중앙(col-5): 상하 분할 */}
        <section className="col-span-5 flex min-h-0 flex-col gap-3">
          <ExistingItemDetail
            item={currentItem}
            onOpenImage={pages.length > 0 ? () => setIsPdfModalOpen(true) : undefined}
          />
          <ShinsegaeMatching
            key={currentItem.id}
            item={currentItem}
            onSelectCandidate={(c) => onSelectCandidate(currentItem.id, 'SHINSEGAE', c)}
            onConfirm={() => {
              onConfirmItem(currentItem.id, 'SHINSEGAE')
              moveToNext()
            }}
          />
        </section>

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
          onConfirmItem(currentItem.id, 'SHINSEGAE')
          moveToNext()
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
}: {
  items: ComparisonItem[]
  selectedIndex: number
  onSelect: (idx: number) => void
  filterMode: FilterMode
}) {
  const filtered = useMemo(() => {
    return items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => {
        if (filterMode === 'unconfirmed') return !it.is_confirmed
        if (filterMode === 'unmatched') return !it.cj_match && !it.ssg_match
        return true
      })
  }, [items, filterMode])

  return (
    <section className="col-span-3 flex min-h-0 flex-col rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
        <span>📋 거래명세표 품목</span>
        <span className="text-xs text-gray-500">{filtered.length}개</span>
      </div>
      <div className="flex-1 overflow-y-auto">
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
                {hasMatch && sav !== 0 && (
                  <div className="mt-0.5 flex items-center justify-between text-[10px]">
                    <span className="text-gray-500 truncate">
                      {it.ssg_match?.product_name?.slice(0, 18) || '신세계 매칭'}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1 py-0.5 font-semibold',
                        isSaving ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                      )}
                    >
                      {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))}
                    </span>
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
}: {
  item: ComparisonItem
  onOpenImage?: () => void
}) {
  const existingWeightG = parseSpecToGrams(item.extracted_spec)
  const total = getExistingTotal(item)
  const perKg =
    existingWeightG && item.extracted_quantity > 0
      ? pricePerKg(item.extracted_unit_price, existingWeightG)
      : null

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
        <span>🗄️ 기존 업체 품목 <span className="ml-1 text-xs text-gray-400">Read-only</span></span>
        {onOpenImage && (
          <button
            onClick={onOpenImage}
            className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            <FileImage size={12} /> 명세서 보기
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">Product Name</div>
        <div className="mb-3 break-words text-lg font-bold text-gray-900">{item.extracted_name}</div>

        {/* 4분할 정보 그리드 */}
        <div className="grid grid-cols-4 gap-2">
          {/* SPEC (col 2) */}
          <div className="col-span-2 rounded-lg border bg-gray-50 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Specification</div>
            <div className="mt-1 break-words text-xs font-semibold text-gray-800">
              {item.extracted_spec || '-'}
            </div>
          </div>
          <div className="rounded-lg border bg-gray-50 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">단위 중량</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {existingWeightG ? `${formatNumber(existingWeightG)}g` : '-'}
            </div>
          </div>
          <div className="rounded-lg border bg-gray-50 p-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">발주 수량</div>
            <div className="mt-1 text-sm font-semibold text-gray-900">
              {formatNumber(item.extracted_quantity)} {item.extracted_unit ?? 'EA'}
            </div>
          </div>

          {/* UNIT PRICE / TOTAL (col 4 두 줄) */}
          <div className="col-span-2 rounded-lg border bg-blue-50 p-2.5 ring-1 ring-blue-100">
            <div className="text-[10px] font-medium uppercase tracking-wider text-blue-700">Unit Price</div>
            <div className="mt-1 text-base font-bold text-gray-900">
              {formatCurrency(item.extracted_unit_price)}
              <span className="ml-1 text-[10px] font-normal text-gray-500">/{item.extracted_unit ?? 'EA'}</span>
            </div>
            {perKg && (
              <div className="text-[10px] text-gray-500">₩{formatNumber(perKg)} / kg</div>
            )}
          </div>
          <div className="col-span-2 rounded-lg border bg-blue-100 p-2.5 ring-1 ring-blue-200">
            <div className="text-[10px] font-medium uppercase tracking-wider text-blue-800">Total Amount</div>
            <div className="mt-1 text-base font-bold text-gray-900">{formatCurrency(total)}</div>
            <div className="text-[10px] text-gray-500">총 합계</div>
          </div>
        </div>

        {(item.source_file_name || item.page_number) && (
          <div className="mt-3 flex flex-wrap gap-x-3 border-t pt-2 text-[11px] text-gray-500">
            {item.source_file_name && (
              <span className="flex items-center gap-1"><FileImage size={11} /> {item.source_file_name}</span>
            )}
            {item.page_number != null && <span>페이지 {item.page_number}</span>}
          </div>
        )}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 중앙 하단: 신세계 매칭 + 조정                                 */
/* ────────────────────────────────────────────────────────── */
function ShinsegaeMatching({
  item,
  onSelectCandidate,
  onConfirm,
}: {
  item: ComparisonItem
  onSelectCandidate: (c: SupplierMatch) => void
  onConfirm: () => void
}) {
  const [enrichedMatch, setEnrichedMatch] = useState<SupplierMatch | undefined>(item.ssg_match)
  const [matchDetail, setMatchDetail] = useState<ProductDetail | null>(null)
  const ssgMatch = enrichedMatch

  const existingWeightG = parseSpecToGrams(item.extracted_spec)
  const existingTotal = getExistingTotal(item)

  const [unitWeightG, setUnitWeightG] = useState<number>(() => {
    if (item.adjusted_unit_weight_g) return item.adjusted_unit_weight_g
    if (ssgMatch?.spec_quantity && ssgMatch?.spec_unit) {
      const u = ssgMatch.spec_unit.toUpperCase()
      if (u === 'KG') return ssgMatch.spec_quantity * 1000
      if (u === 'G') return ssgMatch.spec_quantity
      if (u === 'L') return ssgMatch.spec_quantity * 1000
      if (u === 'ML') return ssgMatch.spec_quantity
    }
    return 0
  })
  const [packUnit, setPackUnit] = useState<string>(item.adjusted_pack_unit ?? ssgMatch?.spec_unit ?? 'EA')
  const [quantity, setQuantity] = useState<number>(item.adjusted_quantity ?? item.extracted_quantity)

  // 매칭 상세 lazy fetch
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
          // 매칭 제품명 enrich
          if (!ssgMatch.product_name && data.product.product_name) {
            setEnrichedMatch({ ...ssgMatch, product_name: data.product.product_name })
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ssgMatch?.id])

  // ssg_candidates에서 enrich (product_name이 비어있을 때)
  useEffect(() => {
    if (!ssgMatch || ssgMatch.product_name) return
    const found = (item.ssg_candidates ?? []).find((c) => c.id === ssgMatch.id)
    if (found && found.product_name) setEnrichedMatch({ ...ssgMatch, ...found })
  }, [item.ssg_candidates, ssgMatch])

  // 단위/포장 자동 채우기
  useEffect(() => {
    if (!enrichedMatch) return
    if (item.adjusted_unit_weight_g) return
    if (unitWeightG > 0) return
    if (enrichedMatch.spec_quantity && enrichedMatch.spec_unit) {
      const u = enrichedMatch.spec_unit.toUpperCase()
      let g = 0
      if (u === 'KG') g = enrichedMatch.spec_quantity * 1000
      else if (u === 'G') g = enrichedMatch.spec_quantity
      else if (u === 'L') g = enrichedMatch.spec_quantity * 1000
      else if (u === 'ML') g = enrichedMatch.spec_quantity
      if (g > 0) setUnitWeightG(g)
    }
    if (!item.adjusted_pack_unit && enrichedMatch.spec_unit && packUnit === 'EA') {
      setPackUnit(enrichedMatch.spec_unit.toUpperCase())
    }
  }, [enrichedMatch, item.adjusted_unit_weight_g, item.adjusted_pack_unit, unitWeightG, packUnit])

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

  const ssgTotal = ssgPricePerPack * quantity
  const savings = computeSavings(existingTotal, ssgTotal)
  const hasDiscrepancy = useMemo(() => {
    if (!existingWeightG || !unitWeightG) return false
    const ratio =
      existingWeightG > unitWeightG ? existingWeightG / unitWeightG : unitWeightG / existingWeightG
    return ratio > 4
  }, [existingWeightG, unitWeightG])

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border-2 border-gray-900 bg-white shadow-md">
      <div className="flex items-center justify-between border-b bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white">
        <span>🛒 신세계 매칭 및 수량 조정</span>
        {ssgMatch && (
          <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
            ✓ Matched
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!ssgMatch ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">
            매칭된 신세계 상품이 없습니다. 우측 후보에서 선택하세요.
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                Matching Product
              </div>
              <div className="break-words text-base font-bold text-gray-900">
                [신세계] {ssgMatch.product_name || item.extracted_name}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {matchDetail?.product_code && (
                  <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                    <Tag size={11} /> {matchDetail.product_code}
                  </span>
                )}
                {matchDetail?.category && (
                  <span className="inline-flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-purple-700">
                    <Boxes size={11} /> {matchDetail.category}
                    {matchDetail.subcategory && ` · ${matchDetail.subcategory}`}
                  </span>
                )}
                {matchDetail?.origin && (
                  <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-green-700">
                    <MapPin size={11} /> {matchDetail.origin}
                  </span>
                )}
                {matchDetail?.tax_type && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-2 py-0.5',
                      matchDetail.tax_type === '면세'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    {matchDetail.tax_type}
                  </span>
                )}
                {matchDetail?.storage_temp && (
                  <span className="inline-flex items-center gap-1 rounded bg-cyan-100 px-2 py-0.5 text-cyan-700">
                    <Snowflake size={11} /> {matchDetail.storage_temp}
                  </span>
                )}
                {ssgMatch.spec_quantity != null && ssgMatch.spec_unit && (
                  <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                    규격 {ssgMatch.spec_quantity}{ssgMatch.spec_unit}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                  표준가 {formatCurrency(ssgMatch.standard_price)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t pt-3">
              <label className="text-sm">
                <span className="text-xs text-gray-500">단위 중량 (g)</span>
                <input
                  type="number"
                  value={unitWeightG || ''}
                  onChange={(e) => setUnitWeightG(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-base focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="text-sm">
                <span className="text-xs text-gray-500">포장 단위</span>
                <select
                  value={packUnit}
                  onChange={(e) => setPackUnit(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-base focus:border-blue-500 focus:outline-none"
                >
                  {PACK_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-xs text-gray-500">수량</span>
                <input
                  type="number"
                  value={quantity || ''}
                  onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-base focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">환산 단가</span>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    Conversion
                  </span>
                </div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {ssgPerKg ? formatCurrency(ssgPerKg) : '-'}
                  <span className="ml-1 text-xs font-normal text-gray-500">/ kg</span>
                </div>
                <div className="text-[10px] text-gray-500">
                  {unitWeightG ? `${unitWeightG}g당 ` : ''}
                  {formatCurrency(ssgPricePerPack)}
                </div>
              </div>
              <div
                className={cn(
                  'rounded-lg p-3',
                  savings.isSaving ? 'bg-green-50 ring-1 ring-green-200' : 'bg-red-50 ring-1 ring-red-200',
                )}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-700">총 비교 금액</span>
                  <span className="text-gray-500">기존 {formatCurrency(existingTotal)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-1">
                  <span className={cn('text-xl font-bold', savings.isSaving ? 'text-green-700' : 'text-red-700')}>
                    {formatCurrency(ssgTotal)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      savings.isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
                    )}
                  >
                    {savings.isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(savings.amount))}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-gray-500">{savings.percent.toFixed(1)}% {savings.isSaving ? '절감' : '추가비용'}</div>
              </div>
            </div>

            {hasDiscrepancy && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="shrink-0" />
                규격 차이가 큽니다 ({existingWeightG}g vs {unitWeightG}g). 환산 결과를 다시 확인하세요.
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                onClick={onConfirm}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                <CheckCircle2 size={14} /> Confirm Match
              </button>
            </div>
          </>
        )}
      </div>
    </section>
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
  const [liveCandidates, setLiveCandidates] = useState<SupplierMatch[]>(() => item.ssg_candidates ?? [])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SupplierMatch[]>([])
  const [searching, setSearching] = useState(false)
  const candidates = liveCandidates
  const ssgMatch = item.ssg_match
  const existingTotal = getExistingTotal(item)

  // 후보 자동 채움
  useEffect(() => {
    if (liveCandidates.length > 0) return
    const q = item.extracted_name?.trim()
    if (!q) return
    let cancelled = false
    setLoadingCandidates(true)
    fetch(`/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=10`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && Array.isArray(data.products)) {
          setLiveCandidates(data.products as SupplierMatch[])
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.extracted_name, liveCandidates.length])

  const maxScore = useMemo(
    () => Math.max(...candidates.map((c) => c.match_score ?? 0), 0.0001),
    [candidates],
  )

  const sortedCandidates = useMemo(() => {
    const list = [...candidates]
    list.sort((a, b) => {
      if (sortMode === 'match') return (b.match_score ?? 0) - (a.match_score ?? 0)
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
  }, [candidates, sortMode, item, existingTotal])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=10`)
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
            {sortedCandidates.map((c, i) => (
              <CandidateCard
                key={c.id}
                index={i + 1}
                candidate={c}
                isSelected={ssgMatch?.id === c.id}
                item={item}
                existingTotal={existingTotal}
                maxScore={maxScore}
                onSelect={() => onSelectCandidate(c)}
              />
            ))}
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
          <div className="max-h-48 overflow-y-auto border-t border-gray-700 p-2">
            {searching && (
              <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> 검색 중…
              </div>
            )}
            <div className="space-y-1">
              {searchResults.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelectCandidate(r)
                    setSearchResults([])
                    setSearchQuery('')
                  }}
                  className="flex w-full items-stretch gap-2 rounded-lg bg-white/5 p-1.5 text-left ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-white" title={r.product_name}>
                      {r.product_name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-gray-300">
                      <span className="font-semibold text-emerald-400">{formatCurrency(r.standard_price)}</span>
                      {r.spec_quantity && r.spec_unit && <span>· {r.spec_quantity}{r.spec_unit}</span>}
                      {(() => {
                        const pk = computeShinsegaePerKg(
                          r.standard_price,
                          { quantity: r.spec_quantity, unit: r.spec_unit },
                          r.ppu,
                        )
                        return pk ? <span>· ₩{formatNumber(pk)}/kg</span> : null
                      })()}
                    </div>
                  </div>
                  <span className="self-center text-[11px] font-medium text-blue-300 underline">선택</span>
                </button>
              ))}
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
  maxScore: number
  onSelect: () => void
}

/**
 * 절대 점수 기반 신뢰도 4단계 (정규화 % 표시는 거짓 정보 — 0.008과 0.0082가 99% vs 100%로 보이는 문제)
 *  - >= 0.05: 강함 (녹색) — 키워드 다수 일치
 *  - >= 0.02: 보통 (파란) — 부분 일치
 *  - >= 0.01: 약함 (노랑) — trigram 중첩 정도
 *  - <  0.01: 매우 약함 (회색) — 사실상 무관, "참고" 표시
 */
function getMatchConfidence(score: number): {
  label: string
  bgColor: string
  textColor: string
  showAsReference: boolean
} {
  if (score >= 0.05) return { label: '강함', bgColor: 'bg-green-100', textColor: 'text-green-700', showAsReference: false }
  if (score >= 0.02) return { label: '보통', bgColor: 'bg-blue-100', textColor: 'text-blue-700', showAsReference: false }
  if (score >= 0.01) return { label: '약함', bgColor: 'bg-amber-100', textColor: 'text-amber-700', showAsReference: false }
  return { label: '참고', bgColor: 'bg-gray-100', textColor: 'text-gray-500', showAsReference: true }
}

function CandidateCard({
  index,
  candidate,
  isSelected,
  item,
  existingTotal,
  maxScore: _maxScore,
  onSelect,
}: CandidateCardProps) {
  const score = candidate.match_score ?? 0
  const conf = getMatchConfidence(score)
  const perKg = computeShinsegaePerKg(
    candidate.standard_price,
    { quantity: candidate.spec_quantity, unit: candidate.spec_unit },
    candidate.ppu,
  )
  const sav = candidateSavings(candidate, item, existingTotal)
  const isSaving = sav > 0

  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-stretch gap-2 rounded-lg border p-2.5 text-left transition',
        isSelected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40',
      )}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <Package size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400">#{index}</span>
              {isSelected && (
                <span className="rounded bg-blue-600 px-1 py-0 text-[9px] font-semibold text-white">현재 매칭</span>
              )}
            </div>
            <div className="mt-0.5 break-words text-xs font-semibold text-gray-900" title={candidate.product_name}>
              {candidate.product_name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-gray-600">
              <span className="font-semibold text-gray-900">{formatCurrency(candidate.standard_price)}</span>
              {candidate.spec_quantity && candidate.spec_unit && (
                <span>· {candidate.spec_quantity}{candidate.spec_unit}</span>
              )}
              {perKg && <span>· ₩{formatNumber(perKg)}/kg</span>}
              {candidate.tax_type && (
                <span
                  className={cn(
                    'rounded px-1 py-0',
                    candidate.tax_type === '면세'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700',
                  )}
                >
                  {candidate.tax_type}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span
              className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold', conf.bgColor, conf.textColor)}
              title={`매칭 점수: ${score.toFixed(4)}`}
            >
              {conf.label}
            </span>
            <span className="text-[9px] text-gray-400" title={`hybrid score = ${score.toFixed(4)}`}>
              점수 {(score * 1000).toFixed(1)}
            </span>
          </div>
        </div>
        {sav !== 0 && (
          <div className="mt-1 flex items-center justify-between border-t pt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-bold',
                isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
              )}
            >
              {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))} {isSaving ? '절감' : '추가'}
            </span>
            <span className="text-[10px] font-medium text-blue-600 underline">
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
