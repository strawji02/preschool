'use client'

/**
 * 매칭 단계 메인 화면 — 단일 품목 정밀 검수 페이지 (2026-05-04)
 *
 * SplitView를 대체. 한 화면에 한 품목만 표시하고 좌→중앙→우 3분할로 비교/조정/선택.
 *  - 좌 (col-3): 기존 업체 품목 정보 (read-only) + 거래명세서 보기
 *  - 중앙 (col-4): 신세계 매칭 + 단위/포장/수량 조정 + 환산 단가 + 절감액
 *  - 우 (col-5): AI 후보 Top 10 (정렬 가능, 절감액 표시) + 수동 DB 검색
 *
 * 네비게이션: ◀ 이전 / 품목 드롭다운 / 다음 ▶ + 키보드 단축키
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ArrowLeft, ArrowRight, ChevronDown, Search, Package, Loader2,
  AlertTriangle, X, RefreshCw, FileImage, CheckCircle2, CheckCircle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { ProgressBar } from '../SplitView/ProgressBar'
import { PdfModal } from '../SplitView/PdfModal'
import { formatCurrency, formatNumber } from '@/lib/format'
import {
  parseSpecToGrams,
  pricePerKg,
  computeShinsegaePerKg,
  computeSavings,
} from '@/lib/unit-conversion'

interface PrecisionMatchingViewProps {
  items: ComparisonItem[]
  pages?: PageImage[]
  supplierName?: string
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string, supplier?: Supplier) => void
  onConfirmAllAutoMatched: () => void
  onAutoExcludeUnmatched?: () => void
  onProceedToReport: () => void
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

export function PrecisionMatchingView({
  items,
  pages = [],
  supplierName = '업체',
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onAutoExcludeUnmatched,
  onProceedToReport,
}: PrecisionMatchingViewProps) {
  // 선택된 품목 (전체 items 기준 인덱스)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('match')
  const [showItemDropdown, setShowItemDropdown] = useState(false)
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)

  const currentItem = items[selectedIndex] ?? null

  // 진행 상태
  const progressStatus = useMemo(
    () => ({
      total: items.length,
      completed: items.filter((i) => i.is_confirmed).length,
      autoConfirmed: items.filter((i) => i.is_confirmed && i.match_status === 'auto_matched').length,
      manualReview: items.filter((i) => !i.is_confirmed && i.match_status === 'pending').length,
    }),
    [items],
  )

  // 필터에 맞는 인덱스 목록 (네비게이션용)
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

  // 현재 위치 (필터 기준)
  const visiblePos = visibleIndices.indexOf(selectedIndex)

  const moveToNext = useCallback(() => {
    if (visibleIndices.length === 0) return
    if (visiblePos === -1) {
      // 필터에서 벗어남: 첫 번째 보이는 항목으로
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

  // ── 신세계 매칭 / 후보 / 검색 상태 (현재 품목 기준) ──
  // currentItem이 바뀌면 다시 초기화되어야 하므로 key로 관리
  return currentItem ? (
    <div className="flex h-full flex-col bg-gray-50">
      <ProgressBar status={progressStatus} />

      {/* 네비게이션 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={moveToPrev}
            disabled={visiblePos <= 0}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <ArrowLeft size={14} /> 이전 <kbd className="ml-1 rounded bg-gray-100 px-1 text-[10px]">P</kbd>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowItemDropdown((v) => !v)}
              className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              #{selectedIndex + 1} {currentItem.extracted_name}
              <ChevronDown size={14} />
            </button>
            {showItemDropdown && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border bg-white shadow-lg">
                {items.map((it, idx) => {
                  const isCurrent = idx === selectedIndex
                  return (
                    <button
                      key={it.id}
                      onClick={() => {
                        setSelectedIndex(idx)
                        setShowItemDropdown(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs hover:bg-gray-50',
                        isCurrent && 'bg-blue-50',
                      )}
                    >
                      <span className="w-8 text-gray-400">#{idx + 1}</span>
                      <span className="flex-1 truncate">{it.extracted_name}</span>
                      {it.is_confirmed ? (
                        <CheckCircle size={14} className="shrink-0 text-green-500" />
                      ) : (
                        <span className="shrink-0 text-amber-500">●</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <button
            onClick={moveToNext}
            disabled={visiblePos === -1 || visiblePos >= visibleIndices.length - 1}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            다음 <kbd className="ml-1 rounded bg-gray-100 px-1 text-[10px]">N</kbd>
            <ArrowRight size={14} />
          </button>
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
          <span className="ml-2 text-xs text-gray-500">
            ({visibleIndices.length}개)
          </span>
        </div>
      </div>

      {/* 3분할 본문 */}
      <PrecisionMatchBody
        key={currentItem.id}
        item={currentItem}
        sortMode={sortMode}
        onSortChange={setSortMode}
        onSelectCandidate={(c) => onSelectCandidate(currentItem.id, 'SHINSEGAE', c)}
        onConfirm={() => {
          onConfirmItem(currentItem.id, 'SHINSEGAE')
          moveToNext()
        }}
        onOpenImage={pages.length > 0 ? () => setIsPdfModalOpen(true) : undefined}
      />

      {/* 하단 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-6 py-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <kbd className="rounded bg-gray-100 px-1.5 py-0.5">P</kbd>이전
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">N</kbd>다음
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">Enter</kbd>확정
          <kbd className="ml-2 rounded bg-gray-100 px-1.5 py-0.5">1-9</kbd>후보 선택
        </div>
        <div className="flex items-center gap-2">
          {items.some((i) => !i.is_confirmed && (i.cj_match || i.ssg_match)) && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-700 hover:bg-green-100"
            >
              <CheckCircle size={14} /> 자동매칭 일괄 확정
            </button>
          )}
          {(() => {
            const cnt = items.filter(
              (i) => !i.is_confirmed && !i.cj_match && !i.ssg_match,
            ).length
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
              : `${progressStatus.total - progressStatus.completed}개 미확정`}
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

      {/* 키보드 핸들러 */}
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
  ) : (
    <div className="flex h-full items-center justify-center text-gray-400">
      품목이 없습니다.
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 본문: 3분할 (좌: 기존 / 중앙: 신세계 / 우: 후보 + 검색)         */
/* ────────────────────────────────────────────────────────── */

interface BodyProps {
  item: ComparisonItem
  sortMode: SortMode
  onSortChange: (mode: SortMode) => void
  onSelectCandidate: (c: SupplierMatch) => void
  onConfirm: () => void
  onOpenImage?: () => void
}

function PrecisionMatchBody({
  item,
  sortMode,
  onSortChange,
  onSelectCandidate,
  onConfirm,
  onOpenImage,
}: BodyProps) {
  const [liveCandidates, setLiveCandidates] = useState<SupplierMatch[]>(() => item.ssg_candidates ?? [])
  const [enrichedMatch, setEnrichedMatch] = useState<SupplierMatch | undefined>(item.ssg_match)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const ssgMatch = enrichedMatch
  const candidates = liveCandidates

  // 기존 업체
  const existingWeightG = parseSpecToGrams(item.extracted_spec)
  const existingTotal =
    item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
  const existingPerKg =
    existingWeightG && item.extracted_quantity > 0
      ? pricePerKg(item.extracted_unit_price, existingWeightG)
      : null

  // 조정값 (state)
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

  // 검색
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SupplierMatch[]>([])
  const [searching, setSearching] = useState(false)

  // 후보 자동 채움 (세션 복원으로 ssg_candidates가 비었을 때)
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
          const products = data.products as SupplierMatch[]
          setLiveCandidates(products)
          if (item.ssg_match && !item.ssg_match.product_name) {
            const found = products.find((p) => p.id === item.ssg_match!.id)
            if (found) setEnrichedMatch({ ...item.ssg_match, ...found })
          }
        }
      })
      .catch((e) => console.warn('candidates 자동 검색 실패:', e))
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.extracted_name, item.ssg_match, liveCandidates.length])

  // 매칭 정보 enrich 후 단위/포장 자동 채움
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

  // 신세계 환산 단가
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
      existingWeightG > unitWeightG
        ? existingWeightG / unitWeightG
        : unitWeightG / existingWeightG
    return ratio > 4
  }, [existingWeightG, unitWeightG])

  // 후보 정렬
  const sortedCandidates = useMemo(() => {
    const list = [...candidates]
    list.sort((a, b) => {
      if (sortMode === 'match') return (b.match_score ?? 0) - (a.match_score ?? 0)
      if (sortMode === 'price') return (a.standard_price ?? 0) - (b.standard_price ?? 0)
      if (sortMode === 'per_kg') {
        const aPk =
          computeShinsegaePerKg(
            a.standard_price,
            { quantity: a.spec_quantity, unit: a.spec_unit },
            a.ppu,
          ) ?? Number.MAX_SAFE_INTEGER
        const bPk =
          computeShinsegaePerKg(
            b.standard_price,
            { quantity: b.spec_quantity, unit: b.spec_unit },
            b.ppu,
          ) ?? Number.MAX_SAFE_INTEGER
        return aPk - bPk
      }
      if (sortMode === 'savings') {
        const aSav = candidateSavings(a, item, existingTotal)
        const bSav = candidateSavings(b, item, existingTotal)
        return bSav - aSav
      }
      return 0
    })
    return list.slice(0, 10)
  }, [candidates, sortMode, item, existingTotal])

  // 수동 검색
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
    <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden p-3">
      {/* ── 좌: 기존 업체 ── */}
      <section className="col-span-3 flex flex-col rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
          <span>🗄️ 기존 업체 품목 <span className="ml-1 text-xs text-gray-400">Read-only</span></span>
          {onOpenImage && (
            <button
              onClick={onOpenImage}
              className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              <FileImage size={12} /> 명세서
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex aspect-square w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400">
            <Package size={48} />
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Product Name</div>
              <div className="mt-0.5 font-semibold text-gray-900">{item.extracted_name}</div>
            </div>
            {item.extracted_spec && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Specification</div>
                <div className="mt-0.5 break-all text-gray-700">{item.extracted_spec}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 border-t pt-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">단위 중량</div>
                <div className="mt-0.5 text-gray-700">
                  {existingWeightG ? `${formatNumber(existingWeightG)} g` : '-'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">발주 수량</div>
                <div className="mt-0.5 text-gray-700">
                  {formatNumber(item.extracted_quantity)} {item.extracted_unit ?? 'EA'}
                </div>
              </div>
            </div>
            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">단가 / kg</span>
                <span className="font-medium text-gray-700">
                  {existingPerKg ? formatCurrency(existingPerKg) : '-'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-gray-500">단가 / EA</span>
                <span className="font-medium text-gray-700">{formatCurrency(item.extracted_unit_price)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t pt-2 text-base">
                <span className="font-semibold text-gray-900">총 금액</span>
                <span className="font-bold text-gray-900">{formatCurrency(existingTotal)}</span>
              </div>
            </div>
            {item.source_file_name && (
              <div className="border-t pt-2 text-[10px] text-gray-400">
                📄 {item.source_file_name}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 중앙: 신세계 매칭 + 조정 ── */}
      <section className="col-span-4 flex flex-col rounded-xl border-2 border-gray-900 bg-white shadow-md">
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
            <div className="flex h-40 items-center justify-center text-gray-400">
              매칭된 신세계 상품이 없습니다. 우측 후보에서 선택하세요.
            </div>
          ) : (
            <>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">Matching Product</div>
              <div className="mb-4 break-all text-base font-semibold text-gray-900">
                [신세계] {ssgMatch.product_name || (loadingCandidates ? '로딩 중…' : item.extracted_name)}
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 text-sm">
                  <span className="text-xs text-gray-500">수량</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      value={quantity || ''}
                      onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                      className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-base focus:border-blue-500 focus:outline-none"
                    />
                    <span className="text-sm text-gray-500">{packUnit}</span>
                  </div>
                </label>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">환산 단가 (₩/kg)</span>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    Conversion
                  </span>
                </div>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {ssgPerKg ? formatCurrency(ssgPerKg) : '-'}{' '}
                  <span className="text-sm font-normal text-gray-500">/ kg</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {unitWeightG ? `${unitWeightG}g당 ` : ''}
                  {formatCurrency(ssgPricePerPack)}
                </div>
              </div>

              <div
                className={cn(
                  'mt-3 rounded-lg p-4',
                  savings.isSaving ? 'bg-green-50 ring-1 ring-green-200' : 'bg-red-50 ring-1 ring-red-200',
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">총 비교 금액</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span
                    className={cn(
                      'text-3xl font-bold',
                      savings.isSaving ? 'text-green-700' : 'text-red-700',
                    )}
                  >
                    {formatCurrency(ssgTotal)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs font-semibold',
                      savings.isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
                    )}
                  >
                    {savings.isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(savings.amount))} (
                    {savings.percent.toFixed(1)}%)
                  </span>
                </div>
              </div>

              {hasDiscrepancy && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertTriangle size={14} className="shrink-0" />
                  규격 차이가 큽니다 ({existingWeightG}g vs {unitWeightG}g). 환산 결과를 다시 확인하세요.
                </div>
              )}

              <div className="mt-4 flex justify-end">
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

      {/* ── 우: 후보 + 검색 ── */}
      <section className="col-span-5 flex flex-col rounded-xl border bg-white shadow-sm">
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
                'AI 추천 후보가 없습니다. 아래 검색을 사용하세요.'
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
                onSelect={() => onSelectCandidate(c)}
              />
            ))}
          </div>

          {/* 수동 검색 */}
          <div className="mt-5 border-t pt-4">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">수동 DB 검색</div>
            <div className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1">
              <Search size={14} className="text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(searchQuery)
                }}
                placeholder="품목명, 코드 또는 규격 검색…"
                className="flex-1 border-none bg-transparent text-sm focus:outline-none"
              />
              <button
                onClick={() => runSearch(searchQuery)}
                disabled={!searchQuery.trim() || searching}
                className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : '검색'}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1">
                {searchResults.slice(0, 8).map((r) => (
                  <CandidateCard
                    key={r.id}
                    index={0}
                    candidate={r}
                    isSelected={ssgMatch?.id === r.id}
                    item={item}
                    existingTotal={existingTotal}
                    onSelect={() => {
                      onSelectCandidate(r)
                      setSearchResults([])
                      setSearchQuery('')
                    }}
                    isSearchResult
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 후보 카드 — 풍부한 정보 (절감액, kg당 단가, 일치율)             */
/* ────────────────────────────────────────────────────────── */

interface CandidateCardProps {
  index: number
  candidate: SupplierMatch
  isSelected: boolean
  item: ComparisonItem
  existingTotal: number
  onSelect: () => void
  isSearchResult?: boolean
}

function CandidateCard({
  index,
  candidate,
  isSelected,
  item,
  existingTotal,
  onSelect,
  isSearchResult,
}: CandidateCardProps) {
  const matchPct = Math.round((candidate.match_score ?? 0) * 100) / 1
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
        'flex w-full items-stretch gap-3 rounded-lg border p-2.5 text-left transition',
        isSelected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40',
      )}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400">
        <Package size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900" title={candidate.product_name}>
              {!isSearchResult && index > 0 && <span className="mr-1 text-gray-400">#{index}</span>}
              {candidate.product_name}
              {isSelected && <span className="ml-1 text-blue-600">✓</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
              <span>{formatCurrency(candidate.standard_price)}</span>
              {candidate.spec_quantity && candidate.spec_unit && (
                <span>· {candidate.spec_quantity}{candidate.spec_unit}</span>
              )}
              {perKg && <span>· ₩{formatNumber(perKg)}/kg</span>}
              {candidate.tax_type && <span>· {candidate.tax_type}</span>}
            </div>
          </div>
          {!isSearchResult && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                matchPct >= 80
                  ? 'bg-green-100 text-green-700'
                  : matchPct >= 60
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-800',
              )}
            >
              {matchPct.toFixed(0)}%
            </span>
          )}
        </div>
        {sav !== 0 && (
          <div
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold',
              isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
            )}
          >
            {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))} {isSaving ? '절감' : '추가비용'}
          </div>
        )}
      </div>
    </button>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 후보 절감액 (단순 계산: 후보 표준가 × 발주 수량 vs 기존 총액)     */
/* 정밀 환산은 매칭 후 중앙 패널에서 처리.                         */
/* ────────────────────────────────────────────────────────── */
function candidateSavings(
  candidate: SupplierMatch,
  item: ComparisonItem,
  existingTotal: number,
): number {
  const candTotal = candidate.standard_price * (item.adjusted_quantity ?? item.extracted_quantity)
  return existingTotal - candTotal
}

/* ────────────────────────────────────────────────────────── */
/* 키보드 단축키 핸들러                                          */
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
