'use client'

/**
 * 단일 품목 정밀 검수 페이지 (2026-05-04)
 *
 * 스티치 디자인 가이드 기반 — 가로 3분할 뷰:
 *  좌: 기존 업체 품목 (read-only)
 *  중앙: 신세계 매칭 + 단위 조정 (editable, 환산 단가/총액 실시간)
 *  우: AI 후보 (Top 5) + Manual DB 검색
 *
 * 진입: SplitView 행 [🔍] 버튼 또는 행 더블클릭
 * 종료: Confirm Match / Exclude / 닫기 → SplitView 복귀
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  X, Search, CheckCircle2, AlertTriangle, RefreshCw, Loader2, Package,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  parseSpecToGrams,
  pricePerKg,
  computeShinsegaePerKg,
  computeSavings,
} from '@/lib/unit-conversion'
import type { ComparisonItem, SupplierMatch } from '@/types/audit'

interface PrecisionViewProps {
  item: ComparisonItem
  onClose: () => void
  onConfirm: (adjustments: {
    adjusted_quantity?: number
    adjusted_unit_weight_g?: number
    adjusted_pack_unit?: string
    selected_match?: SupplierMatch
  }) => void
  onExclude: () => void
  onSelectCandidate: (candidate: SupplierMatch) => void
  /** AI 후보 Top 5 재검색 (선택적) */
  onResearch?: () => Promise<void>
}

const PACK_UNITS = ['EA', 'BAG', 'BOX', 'PAC', '봉', 'KG', 'L'] as const

export function PrecisionView({
  item,
  onClose,
  onConfirm,
  onExclude,
  onSelectCandidate,
  onResearch,
}: PrecisionViewProps) {
  const ssgMatch = item.ssg_match
  const candidates = item.ssg_candidates ?? []

  // 기존 업체 환산 단가 (1kg당)
  const existingWeightG = parseSpecToGrams(item.extracted_spec)
  const existingTotalPerUnit =
    item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
  const existingPerKg = existingWeightG && item.extracted_quantity > 0
    ? pricePerKg(item.extracted_unit_price, existingWeightG)
    : null

  // 신세계 매칭 — 검수자 조정값 또는 매칭 기본값
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
  const [researching, setResearching] = useState(false)

  // 신세계 환산 단가 (1kg당)
  const ssgPerKg = useMemo(() => {
    if (!ssgMatch) return null
    return computeShinsegaePerKg(
      ssgMatch.standard_price,
      { quantity: ssgMatch.spec_quantity, unit: ssgMatch.spec_unit },
      ssgMatch.ppu,
    )
  }, [ssgMatch])

  // 봉당 가격 (검수자가 조정한 unit_weight_g 기준)
  const ssgPricePerPack = useMemo(() => {
    if (!ssgPerKg || !unitWeightG) return ssgMatch?.standard_price ?? 0
    return Math.round((ssgPerKg / 1000) * unitWeightG)
  }, [ssgPerKg, unitWeightG, ssgMatch])

  // 총 비교 금액
  const ssgTotal = useMemo(() => ssgPricePerPack * quantity, [ssgPricePerPack, quantity])
  const existingTotal = existingTotalPerUnit  // 기존 업체 총 금액 (extracted_total_price)

  // 절감액
  const savings = computeSavings(existingTotal, ssgTotal)

  // 규격 차이 경고
  const hasDiscrepancy = useMemo(() => {
    if (!existingWeightG || !unitWeightG) return false
    const ratio = existingWeightG > unitWeightG
      ? existingWeightG / unitWeightG
      : unitWeightG / existingWeightG
    return ratio > 4  // 4배 이상 차이
  }, [existingWeightG, unitWeightG])

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Manual DB 검색
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&supplier=SHINSEGAE&limit=10`)
      const data = await res.json()
      if (data.success && Array.isArray(data.results)) {
        setSearchResults(data.results)
      }
    } catch (e) {
      console.warn('manual search 실패:', e)
    } finally {
      setSearching(false)
    }
  }, [])

  const handleResearch = async () => {
    if (!onResearch) return
    setResearching(true)
    try {
      await onResearch()
    } finally {
      setResearching(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
      {/* 상단 헤더 (사이트 톤) */}
      <header className="flex items-center justify-between border-b bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            ← 리스트로
          </button>
          <h1 className="text-base font-semibold text-gray-900">단일 품목 정밀 검수</h1>
        </div>
        <div className="flex items-center gap-2">
          {onResearch && (
            <button
              onClick={handleResearch}
              disabled={researching}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {researching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              AI Re-search
            </button>
          )}
          <button
            onClick={onExclude}
            className="flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
          >
            <X size={14} /> 비교 제외
          </button>
          <button
            onClick={() =>
              onConfirm({
                adjusted_quantity: quantity,
                adjusted_unit_weight_g: unitWeightG || undefined,
                adjusted_pack_unit: packUnit,
              })
            }
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            <CheckCircle2 size={14} /> Confirm Match
          </button>
        </div>
      </header>

      {/* 3분할 본문 */}
      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden p-3">
        {/* 좌: 기존 업체 품목 */}
        <section className="col-span-3 flex flex-col rounded-xl border bg-white shadow-sm">
          <div className="border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
            🗄️ 기존 업체 품목 <span className="ml-1 text-xs text-gray-400">Read-only</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* 이미지 자리 (placeholder) */}
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
                  <div className="mt-0.5 text-gray-700">{item.extracted_spec}</div>
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
                  <span className="font-medium text-gray-700">
                    {formatCurrency(item.extracted_unit_price)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-2 text-base">
                  <span className="font-semibold text-gray-900">총 금액</span>
                  <span className="font-bold text-gray-900">{formatCurrency(existingTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 중앙: 신세계 매칭 + 조정 */}
        <section className="col-span-5 flex flex-col rounded-xl border-2 border-gray-900 bg-white shadow-md">
          <div className="flex items-center justify-between border-b bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white">
            <span>🛒 신세계 매칭 및 수량 조정</span>
            <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
              ✓ Matched
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!ssgMatch ? (
              <div className="flex h-40 items-center justify-center text-gray-400">
                매칭된 신세계 상품이 없습니다. 우측 후보에서 선택하세요.
              </div>
            ) : (
              <>
                {/* 매칭 제품 정보 */}
                <div className="mb-4 flex aspect-video w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                  <Package size={48} />
                </div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">Matching Product</div>
                <div className="mb-4 text-base font-semibold text-gray-900">
                  [신세계] {ssgMatch.product_name}
                </div>

                {/* 조정 인풋 그리드 */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-xs text-gray-500">단위 중량 (Unit Weight g)</span>
                    <input
                      type="number"
                      value={unitWeightG || ''}
                      onChange={(e) => setUnitWeightG(Number(e.target.value) || 0)}
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-base focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-xs text-gray-500">포장 단위 (Package Unit)</span>
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
                  <label className="col-span-2 text-sm">
                    <span className="text-xs text-gray-500">수량 (Quantity)</span>
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
                    <span className="text-gray-600">환산 단가 (Converted Unit Price)</span>
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                      Conversion
                    </span>
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {ssgPerKg ? formatCurrency(ssgPerKg) : '-'} <span className="text-sm font-normal text-gray-500">/ kg</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {unitWeightG ? `${unitWeightG}g당 ` : ''}
                    {formatCurrency(ssgPricePerPack)}
                  </div>
                </div>

                {/* 총 비교 금액 + 절감액 */}
                <div className={cn(
                  'mt-3 rounded-lg p-4',
                  savings.isSaving ? 'bg-green-50 ring-1 ring-green-200' : 'bg-red-50 ring-1 ring-red-200',
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">총 비교 금액 (Total Comparison)</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className={cn(
                      'text-3xl font-bold',
                      savings.isSaving ? 'text-green-700' : 'text-red-700',
                    )}>
                      {formatCurrency(ssgTotal)}
                    </span>
                    <span className={cn(
                      'rounded-full px-2 py-1 text-xs font-semibold',
                      savings.isSaving ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
                    )}>
                      {savings.isSaving ? '▼' : '▲'} {formatCurrency(Math.abs(savings.amount))} ({savings.percent.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                {hasDiscrepancy && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="shrink-0" />
                    규격 차이가 큽니다 ({existingWeightG}g vs {unitWeightG}g). 단위 환산 결과를 다시 확인하세요.
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* 우: AI 후보 + 검색 */}
        <section className="col-span-4 flex flex-col rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold text-gray-700">
            <span>🤖 AI 추천 및 검색</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 text-[10px] uppercase tracking-wider text-gray-500">Candidate Products</div>
            <div className="space-y-2">
              {candidates.length === 0 && (
                <div className="rounded-lg border border-dashed bg-gray-50 p-4 text-center text-xs text-gray-400">
                  AI 추천 후보가 없습니다.
                </div>
              )}
              {candidates.slice(0, 5).map((c, i) => {
                const matchPct = Math.round((c.match_score || 0) * 10) / 10
                const isSelected = ssgMatch?.id === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelectCandidate(c)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border p-2 text-left transition',
                      isSelected
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40',
                    )}
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400">
                      <Package size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-gray-900" title={c.product_name}>
                        {c.product_name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                        <span>{formatCurrency(c.standard_price)}</span>
                        {c.spec_quantity && c.spec_unit && (
                          <span>· {c.spec_quantity}{c.spec_unit}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        matchPct >= 90 ? 'bg-green-100 text-green-700' :
                        matchPct >= 70 ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-800',
                      )}>
                        {matchPct}% Match
                      </div>
                      <div className="mt-1 text-[10px] text-blue-600 underline">
                        {isSelected ? 'Selected' : 'Select'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Manual DB 검색 */}
            <div className="mt-5">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">Manual DB Search</div>
              <div className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1">
                <Search size={14} className="text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(searchQuery) }}
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
                    <button
                      key={r.id}
                      onClick={() => {
                        onSelectCandidate(r)
                        setSearchResults([])
                        setSearchQuery('')
                      }}
                      className="flex w-full items-center gap-2 rounded border bg-white p-1.5 text-left hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-900" title={r.product_name}>
                          {r.product_name}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {formatCurrency(r.standard_price)}
                          {r.spec_quantity && r.spec_unit && ` · ${r.spec_quantity}${r.spec_unit}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
