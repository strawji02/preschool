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
  ExternalLink, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { PdfModal } from '../SplitView/PdfModal'
import { formatCurrency, formatNumber } from '@/lib/format'
import {
  parseSpecToGrams, pricePerKg, computeShinsegaePerKg, computeSavings, estimateSsgTotal,
} from '@/lib/unit-conversion'
import {
  getCommonTokens, getMatchConfidence, type MatchConfidence,
  normalizeOrigin, originMatchScore,
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
  return normalizeOrigin(`${item.extracted_name ?? ''} ${item.extracted_spec ?? ''}`)
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
}: PrecisionMatchingViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
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
                  onConfirmItem(currentItem.id, 'SHINSEGAE', adjustments)
                  moveToNext()
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
        </div>

        {/* 금액 5분할 한 줄 */}
        <div className="mt-1.5 grid grid-cols-5 gap-1">
          <FinanceCardCompact label="단위중량" value={existingWeightG ? `${formatNumber(existingWeightG)}g` : '-'} />
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
              {formatNumber(existingWeightG)}g × {formatNumber(item.extracted_quantity)} {item.extracted_unit ?? 'EA'}
            </span>
            <span className="text-xs text-gray-400">=</span>
            <span className="text-sm font-bold text-amber-900">
              {formatNumber(existingWeightG * item.extracted_quantity)}g
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

  // 검수자가 직접 조정한 값을 추적 (true면 자동 갱신 막음)
  const [unitWeightG, setUnitWeightG] = useState<number>(0)
  const [packUnit, setPackUnit] = useState<string>('EA')
  const [quantity, setQuantity] = useState<number>(item.adjusted_quantity ?? item.extracted_quantity)

  // 매칭 변경 시 unitWeightG/packUnit 자동 갱신 (P0 버그 fix — 후보 선택 반영)
  useEffect(() => {
    if (!ssgMatch) {
      if (!item.adjusted_unit_weight_g) setUnitWeightG(0)
      if (!item.adjusted_pack_unit) setPackUnit('EA')
      return
    }
    // 검수자 조정값 우선
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
    }
    setPackUnit(item.adjusted_pack_unit ?? ssgMatch.spec_unit?.toUpperCase() ?? 'EA')
  }, [ssgMatch?.id, ssgMatch?.spec_quantity, ssgMatch?.spec_unit, item.adjusted_unit_weight_g, item.adjusted_pack_unit])

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
      list.push({ label: '단위 중량', existing: `${existingWeightG}g`, ssg: `${unitWeightG}g` })
    }
    return list
  }, [existingWeightG, unitWeightG])

  // 검수자 의견 (DB 컬럼 추가 전 — localStorage로 임시 보존, item.id 기준)
  // TODO: audit_items.reviewer_note 컬럼 추가 후 PATCH /api/audit-items/[id] 로 전환
  const noteKey = `reviewer_note_${item.id}`
  const [reviewerNote, setReviewerNote] = useState<string>('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    setReviewerNote(window.localStorage.getItem(noteKey) ?? '')
  }, [noteKey])
  const onNoteChange = (v: string) => {
    setReviewerNote(v)
    if (typeof window !== 'undefined') {
      if (v) window.localStorage.setItem(noteKey, v)
      else window.localStorage.removeItem(noteKey)
    }
  }

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
                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
                  <Tag size={14} /> {matchDetail.product_code}
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
            </div>

            {/* 금액 5분할 한 줄 */}
            <div className="mt-1.5 grid grid-cols-5 gap-1">
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
                    {formatNumber(unitWeightG)}g × {formatNumber(quantity)} {packUnit}
                  </span>
                  <span className="text-xs text-gray-400">=</span>
                  <span className={cn('text-sm font-bold', matched ? 'text-emerald-900' : 'text-amber-900')}>
                    {formatNumber(ssgTotalG)}g
                  </span>
                  {existingTotalG > 0 && (
                    <span className={cn('ml-auto text-[11px]', matched ? 'text-emerald-700' : 'text-amber-700')}>
                      {matched ? '✓ 기존과 일치' : `기존 ${formatNumber(existingTotalG)}g 대비 ${ssgTotalG > existingTotalG ? '+' : ''}${formatNumber(ssgTotalG - existingTotalG)}g`}
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
                  placeholder="검수자 의견 (AI 학습용) — 예: '실제로는 차수수 국내산이 맞음'"
                  rows={2}
                  className="w-full resize-none bg-transparent text-xs text-gray-800 placeholder-gray-400 focus:outline-none"
                />
              </label>
              <button
                onClick={() =>
                  onConfirm({
                    adjusted_quantity: quantity,
                    adjusted_unit_weight_g: unitWeightG || undefined,
                    adjusted_pack_unit: packUnit,
                  })
                }
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
  const [liveCandidates, setLiveCandidates] = useState<SupplierMatch[]>(() => item.ssg_candidates ?? [])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SupplierMatch[]>([])
  const [searching, setSearching] = useState(false)
  const candidates = liveCandidates
  const ssgMatch = item.ssg_match
  const existingTotal = getExistingTotal(item)

  // 후보 자동 채움 — 항목 변경 시 1회 lazy fetch + DB 후보와 merge (2026-05-04)
  // 매칭 시점의 후보가 잘못된 경우 (예: 느타리버섯 → 유리창닦이) 실시간 검색으로 보충
  useEffect(() => {
    const q = item.extracted_name?.trim()
    if (!q) return
    let cancelled = false
    setLoadingCandidates(true)
    // closure로 item 캡처 (의존성 안정화 — 부모 리렌더로 인한 무한 fetch 방지)
    const dbCandsAtMount = item.ssg_candidates ?? []
    fetch(`/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=30`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && Array.isArray(data.products)) {
          const dbIds = new Set(dbCandsAtMount.map((c) => c.id))
          const fresh = data.products as SupplierMatch[]
          // DB 후보 + 신선한 검색 결과 (중복 제거) → 토큰 정렬 시 정확한 매칭이 위로
          const merged = [...dbCandsAtMount, ...fresh.filter((p) => !dbIds.has(p.id))]
          setLiveCandidates(merged)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.extracted_name])

  // 토큰 매칭 비율 캐시 (정렬용 + UI 표시용)
  const candidateConfidences = useMemo(() => {
    const map = new Map<string, MatchConfidence>()
    for (const c of candidates) {
      map.set(c.id, getMatchConfidence(item.extracted_name, c.product_name))
    }
    return map
  }, [candidates, item.extracted_name])

  // 기존 업체 품목 원산지 (정렬 가중치용)
  const itemOrigin = useMemo(() => getItemOrigin(item), [item])

  const sortedCandidates = useMemo(() => {
    const list = [...candidates]
    list.sort((a, b) => {
      if (sortMode === 'match') {
        // 1) 토큰 매칭 비율 우선 → "참고" 항목은 자동으로 맨 아래
        const aR = candidateConfidences.get(a.id)?.matchRatio ?? 0
        const bR = candidateConfidences.get(b.id)?.matchRatio ?? 0
        if (aR !== bR) return bR - aR

        // 2) 토큰 동률 → 원산지 일치 우선 (기존 "국내산"이면 후보 "국내산"이 위로)
        if (itemOrigin !== 'UNKNOWN') {
          // origin 컬럼 누락 시 product_name에서 추출 (예: "세척당근 중국 실온" → CN)
          const aOriginMatch = normalizeOrigin(a.origin || a.product_name) === itemOrigin
          const bOriginMatch = normalizeOrigin(b.origin || b.product_name) === itemOrigin
          if (aOriginMatch !== bOriginMatch) return aOriginMatch ? -1 : 1
        }

        // 3) 마지막 tiebreak — score
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
  }, [candidates, sortMode, item, existingTotal, candidateConfidences, itemOrigin])

  // 검색 결과도 토큰 + origin 가중치로 정렬 (사용자 요청 — 매칭/후보/검색 모두 일관성)
  const sortedSearchResults = useMemo(() => {
    if (searchResults.length === 0) return [] as SupplierMatch[]
    return [...searchResults].sort((a, b) => {
      const aR = getMatchConfidence(item.extracted_name, a.product_name).matchRatio
      const bR = getMatchConfidence(item.extracted_name, b.product_name).matchRatio
      if (aR !== bR) return bR - aR
      if (itemOrigin !== 'UNKNOWN') {
        // origin 컬럼 누락 시 product_name에서 추출 (예: "세척당근 중국 실온" → CN)
        const aOriginMatch = normalizeOrigin(a.origin || a.product_name) === itemOrigin
        const bOriginMatch = normalizeOrigin(b.origin || b.product_name) === itemOrigin
        if (aOriginMatch !== bOriginMatch) return aOriginMatch ? -1 : 1
      }
      return (b.match_score ?? 0) - (a.match_score ?? 0)
    })
  }, [searchResults, item.extracted_name, itemOrigin])

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
                confidence={candidateConfidences.get(c.id) ?? getMatchConfidence(item.extracted_name, c.product_name)}
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
            <div className="space-y-1.5">
              {sortedSearchResults.slice(0, 8).map((r) => {
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
  if (candidate.product_code) specParts.push(`· #${candidate.product_code}`)
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
