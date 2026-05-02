'use client'

/**
 * 매칭 단계 메인 화면 — 단일 품목 정밀 검수 페이지 (2026-05-04 / r2 2026-05-04)
 *
 * v2 개선 (스티치 가이드 + ProcureShield AI 참조):
 *  - 좌(col-3): 정보 카드 그리드 (Spec / Inventory / Unit Price / Total Amount 분리)
 *  - 중앙(col-4): 매칭 제품 상세 메타 (제품코드 / 카테고리 / 원산지 / 세금구분) + 환산 + 절감액
 *  - 우(col-5): AI 후보 Top 10 (정규화된 일치율 + 풍부 메타) + 검정 강조 검색 카드 (분리)
 *  - 일치율 정규화: 후보 중 1등 = 100%, 나머지는 비례
 *  - 매칭 제품 상세 lazy fetch: /api/products/[id]
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ArrowLeft, ArrowRight, ChevronDown, Search, Package, Loader2,
  AlertTriangle, FileImage, CheckCircle2, CheckCircle, Tag, MapPin, Snowflake, Boxes,
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
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [sortMode, setSortMode] = useState<SortMode>('match')
  const [showItemDropdown, setShowItemDropdown] = useState(false)
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)

  const currentItem = items[selectedIndex] ?? null

  const progressStatus = useMemo(
    () => ({
      total: items.length,
      completed: items.filter((i) => i.is_confirmed).length,
      autoConfirmed: items.filter((i) => i.is_confirmed && i.match_status === 'auto_matched').length,
      manualReview: items.filter((i) => !i.is_confirmed && i.match_status === 'pending').length,
    }),
    [items],
  )

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
          <span className="ml-2 text-xs text-gray-500">({visibleIndices.length}개)</span>
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
    <div className="flex h-full items-center justify-center text-gray-400">품목이 없습니다.</div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 본문: 좌(기존) + 중앙(신세계) + 우(후보 + 검색)                */
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
  const [matchDetail, setMatchDetail] = useState<ProductDetail | null>(null)
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

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SupplierMatch[]>([])
  const [searching, setSearching] = useState(false)

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

  // 매칭 제품 상세 lazy fetch (제품코드/원산지/카테고리/세금구분)
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
        }
      })
      .catch((e) => console.warn('매칭 제품 상세 fetch 실패:', e))
    return () => {
      cancelled = true
    }
  }, [ssgMatch?.id])

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

  // ── 일치율 정규화: 1등 = 100%, 나머지는 비례 ──
  const maxScore = useMemo(() => {
    return Math.max(...candidates.map((c) => c.match_score ?? 0), 0.0001)
  }, [candidates])

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
    <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden p-3">
      {/* ── 좌(col-3): 기존 업체 정보 카드 ── */}
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
          {/* 이미지 + 품목명 */}
          <div className="mb-3 flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gray-100 text-gray-300">
            <Package size={48} />
          </div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">Product Name</div>
          <div className="mb-3 break-words text-base font-bold text-gray-900">{item.extracted_name}</div>

          {/* SPECIFICATION (전체 폭) */}
          <div className="mb-3 rounded-lg border bg-gray-50 p-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">Specification</div>
            <div className="break-words text-sm text-gray-800">{item.extracted_spec || '-'}</div>
          </div>

          {/* INVENTORY (단위중량 / 발주수량) — 2열 카드 */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-gray-50 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">단위 중량</div>
              <div className="mt-1 text-base font-semibold text-gray-900">
                {existingWeightG ? `${formatNumber(existingWeightG)}g` : '-'}
              </div>
            </div>
            <div className="rounded-lg border bg-gray-50 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">발주 수량</div>
              <div className="mt-1 text-base font-semibold text-gray-900">
                {formatNumber(item.extracted_quantity)} {item.extracted_unit ?? 'EA'}
              </div>
            </div>
          </div>

          {/* UNIT PRICE / TOTAL — 2열 카드 (강조) */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-blue-50 p-3 ring-1 ring-blue-100">
              <div className="text-[10px] font-medium uppercase tracking-wider text-blue-700">Unit Price</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {formatCurrency(item.extracted_unit_price)}
              </div>
              <div className="text-[10px] text-gray-500">
                {existingPerKg ? `₩${formatNumber(existingPerKg)}/kg` : `${item.extracted_unit ?? 'EA'}당`}
              </div>
            </div>
            <div className="rounded-lg border bg-blue-100 p-3 ring-1 ring-blue-200">
              <div className="text-[10px] font-medium uppercase tracking-wider text-blue-800">Total Amount</div>
              <div className="mt-1 text-lg font-bold text-gray-900">{formatCurrency(existingTotal)}</div>
              <div className="text-[10px] text-gray-500">총 합계</div>
            </div>
          </div>

          {/* 출처 */}
          {(item.source_file_name || item.page_number) && (
            <div className="space-y-1 border-t pt-2 text-[11px] text-gray-500">
              {item.source_file_name && <div className="flex items-center gap-1"><FileImage size={11} /> {item.source_file_name}</div>}
              {item.page_number != null && <div>페이지: {item.page_number}</div>}
            </div>
          )}
        </div>
      </section>

      {/* ── 중앙(col-4): 신세계 매칭 + 조정 ── */}
      <section className="col-span-4 flex flex-col rounded-xl border-2 border-gray-900 bg-white shadow-md">
        <div className="flex items-center justify-between border-b bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white">
          <span>🛒 신세계 매칭 및 수량 조정</span>
          {ssgMatch && (
            <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">✓ Matched</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {!ssgMatch ? (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">
              매칭된 신세계 상품이 없습니다. 우측 후보에서 선택하세요.
            </div>
          ) : (
            <>
              {/* MATCHING PRODUCT */}
              <div className="mb-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">Matching Product</div>
                <div className="break-words text-base font-bold text-gray-900">
                  [신세계] {ssgMatch.product_name || (loadingCandidates ? '로딩 중…' : item.extracted_name)}
                </div>
                {/* 메타 chip 행 */}
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

              {/* 조정 인풋 */}
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
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

              {/* 환산 단가 */}
              <div className="mt-4 rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">환산 단가 (₩/kg)</span>
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Conversion</span>
                </div>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {ssgPerKg ? formatCurrency(ssgPerKg) : '-'} <span className="text-sm font-normal text-gray-500">/ kg</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {unitWeightG ? `${unitWeightG}g당 ` : ''}
                  {formatCurrency(ssgPricePerPack)}
                </div>
              </div>

              {/* 총 비교 + 절감 */}
              <div
                className={cn(
                  'mt-3 rounded-lg p-4',
                  savings.isSaving ? 'bg-green-50 ring-1 ring-green-200' : 'bg-red-50 ring-1 ring-red-200',
                )}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">총 비교 금액</span>
                  <span className="text-xs text-gray-500">기존 {formatCurrency(existingTotal)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className={cn('text-3xl font-bold', savings.isSaving ? 'text-green-700' : 'text-red-700')}>
                    {formatCurrency(ssgTotal)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs font-semibold',
                      savings.isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
                    )}
                  >
                    {savings.isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(savings.amount))} ({savings.percent.toFixed(1)}%)
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

      {/* ── 우(col-5): 후보 + 검색 (검정 카드 분리) ── */}
      <section className="col-span-5 flex flex-col gap-3 overflow-hidden">
        {/* 후보 리스트 (위 70%) */}
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

        {/* 검정 강조 검색 카드 (아래 30%) */}
        <div className="flex max-h-[44%] flex-col overflow-hidden rounded-xl bg-gray-900 shadow-md">
          <div className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-white">
            <span className="flex items-center gap-1.5">
              <Search size={14} /> 신세계 DB 직접 검색
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Manual DB Search</span>
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
                placeholder="품목명, 코드, 규격으로 신세계 DB 검색…"
                className="flex-1 border-none bg-transparent text-sm focus:outline-none"
              />
              <button
                onClick={() => runSearch(searchQuery)}
                disabled={!searchQuery.trim() || searching}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : 'SEARCH'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              AI 추천에서 원하는 제품을 찾을 수 없을 때 신세계 DB에서 직접 검색합니다.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto border-t border-gray-700 p-3">
            {searching && (
              <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-gray-400">
                <Loader2 size={12} className="animate-spin" /> 검색 중…
              </div>
            )}
            {!searching && searchResults.length === 0 && searchQuery && (
              <div className="py-2 text-center text-xs text-gray-500">검색 결과가 없습니다.</div>
            )}
            <div className="space-y-1.5">
              {searchResults.slice(0, 10).map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelectCandidate(r)
                    setSearchResults([])
                    setSearchQuery('')
                  }}
                  className="flex w-full items-stretch gap-2 rounded-lg bg-white/5 p-2 text-left ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/10 text-gray-400">
                    <Package size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-white" title={r.product_name}>
                      {r.product_name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-gray-300">
                      <span className="font-semibold text-emerald-400">{formatCurrency(r.standard_price)}</span>
                      {r.spec_quantity && r.spec_unit && <span>· {r.spec_quantity}{r.spec_unit}</span>}
                      {(() => {
                        const pk = computeShinsegaePerKg(r.standard_price, { quantity: r.spec_quantity, unit: r.spec_unit }, r.ppu)
                        return pk ? <span>· ₩{formatNumber(pk)}/kg</span> : null
                      })()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center text-[11px] font-medium text-blue-300 underline">
                    선택
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ────────────────────────────────────────────────────────── */
/* 후보 카드 — 정규화된 일치율 + 풍부 메타 + 절감액              */
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

function CandidateCard({
  index,
  candidate,
  isSelected,
  item,
  existingTotal,
  maxScore,
  onSelect,
}: CandidateCardProps) {
  // 정규화된 일치율 (1등 = 100%)
  const matchPct = Math.min(100, Math.round(((candidate.match_score ?? 0) / maxScore) * 100))
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
        'flex w-full items-stretch gap-3 rounded-lg border p-3 text-left transition',
        isSelected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40',
      )}
    >
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
        <Package size={24} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-400">#{index}</span>
              {isSelected && (
                <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">현재 매칭</span>
              )}
            </div>
            <div
              className="mt-0.5 break-words text-sm font-semibold text-gray-900"
              title={candidate.product_name}
            >
              {candidate.product_name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-600">
              <span className="font-semibold text-gray-900">{formatCurrency(candidate.standard_price)}</span>
              {candidate.spec_quantity && candidate.spec_unit && (
                <span>· 규격 {candidate.spec_quantity}{candidate.spec_unit}</span>
              )}
              {perKg && <span>· ₩{formatNumber(perKg)}/kg</span>}
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
              {candidate.category && (
                <span className="rounded bg-purple-100 px-1 py-0 text-[10px] text-purple-700">
                  {candidate.category}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                'rounded-md px-2 py-1 text-xs font-bold',
                matchPct >= 80
                  ? 'bg-green-100 text-green-700'
                  : matchPct >= 50
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-800',
              )}
            >
              {matchPct}%
            </span>
            <span className="text-[10px] text-gray-400">일치율</span>
          </div>
        </div>
        {sav !== 0 && (
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
                isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
              )}
            >
              {isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(sav))} {isSaving ? '절감' : '추가비용'}
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
function candidateSavings(
  candidate: SupplierMatch,
  item: ComparisonItem,
  existingTotal: number,
): number {
  const candTotal = candidate.standard_price * (item.adjusted_quantity ?? item.extracted_quantity)
  return existingTotal - candTotal
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
