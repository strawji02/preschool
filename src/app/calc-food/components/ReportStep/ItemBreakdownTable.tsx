'use client'

import { useState, useCallback } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronUp } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import { VolumeAdjuster } from '@/components/ui/VolumeAdjuster'
import type { ComparisonItem } from '@/types/audit'
import { FEATURE_FLAGS } from '../../config'
import { EyeOff, Eye } from 'lucide-react'

interface ItemBreakdownTableProps {
  items: ComparisonItem[]
  onAdjustedSavingsChange?: (adjustedSavings: { cj: number; ssg: number }) => void
  onToggleExclude?: (itemId: string, reason?: string) => void  // 2026-04-21 비교 제외 토글
  /** 공급율 — 신세계 견적에 일괄 적용되는 배율 (2026-05-16, 기본 1.0)
   *  변경 절감액 = 기존 - (신세계 × supplyRate) */
  supplyRate?: number
}

type SortField = 'name' | 'our_price' | 'cj_price' | 'ssg_price' | 'max_savings'
type SortDirection = 'asc' | 'desc'

interface AdjustedPrices {
  [itemId: string]: {
    cjMultiplier: number
    cjAdjustedPrice: number
    ssgMultiplier: number
    ssgAdjustedPrice: number
  }
}

export function ItemBreakdownTable({ items, onAdjustedSavingsChange, onToggleExclude, supplyRate = 1 }: ItemBreakdownTableProps) {
  const [sortField, setSortField] = useState<SortField>('max_savings')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [adjustedPrices, setAdjustedPrices] = useState<AdjustedPrices>({})

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const handleCjAdjustment = useCallback((itemId: string, adjustedPrice: number, multiplier: number) => {
    setAdjustedPrices(prev => {
      const next = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          cjMultiplier: multiplier,
          cjAdjustedPrice: adjustedPrice,
          ssgMultiplier: prev[itemId]?.ssgMultiplier ?? 1,
          ssgAdjustedPrice: prev[itemId]?.ssgAdjustedPrice ?? 0,
        },
      }
      return next
    })
  }, [])

  const handleSsgAdjustment = useCallback((itemId: string, adjustedPrice: number, multiplier: number) => {
    setAdjustedPrices(prev => {
      const next = {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          cjMultiplier: prev[itemId]?.cjMultiplier ?? 1,
          cjAdjustedPrice: prev[itemId]?.cjAdjustedPrice ?? 0,
          ssgMultiplier: multiplier,
          ssgAdjustedPrice: adjustedPrice,
        },
      }
      return next
    })
  }, [])

  // Get effective price (adjusted if available, original otherwise)
  const getEffectiveCjPrice = (item: ComparisonItem): number | undefined => {
    if (!item.cj_match) return undefined
    const adj = adjustedPrices[item.id]
    if (adj && adj.cjMultiplier !== 1) return adj.cjAdjustedPrice
    return item.cj_match.standard_price
  }

  const getEffectiveSsgPrice = (item: ComparisonItem): number | undefined => {
    if (!item.ssg_match) return undefined
    const adj = adjustedPrices[item.id]
    // (2026-05-16) supplyRate 적용 — 신세계 견적에 일괄 배율 (보고서 단계 사용자 입력)
    const base = adj && adj.ssgMultiplier !== 1 ? adj.ssgAdjustedPrice : item.ssg_match.standard_price
    return base * supplyRate
  }

  // Calculate adjusted savings for an item
  const getAdjustedSavings = (item: ComparisonItem) => {
    const cjPrice = getEffectiveCjPrice(item)
    const ssgPrice = getEffectiveSsgPrice(item)
    const unitPrice = item.extracted_unit_price
    const qty = item.extracted_quantity

    const cjSavings = cjPrice !== undefined ? Math.max(0, (unitPrice - cjPrice) * qty) : 0
    const ssgSavings = ssgPrice !== undefined ? Math.max(0, (unitPrice - ssgPrice) * qty) : 0
    const maxSavings = Math.max(cjSavings, ssgSavings)

    let bestSupplier: 'CJ' | 'SHINSEGAE' | undefined
    if (maxSavings > 0) {
      if (cjSavings >= ssgSavings && cjSavings > 0) bestSupplier = 'CJ'
      else if (ssgSavings > 0) bestSupplier = 'SHINSEGAE'
    }

    return { cj: cjSavings, ssg: ssgSavings, max: maxSavings, bestSupplier }
  }

  const sortedItems = [...items].sort((a, b) => {
    let aValue: number | string
    let bValue: number | string

    switch (sortField) {
      case 'name':
        aValue = a.extracted_name
        bValue = b.extracted_name
        break
      case 'our_price':
        aValue = a.extracted_unit_price
        bValue = b.extracted_unit_price
        break
      case 'cj_price':
        aValue = getEffectiveCjPrice(a) ?? Infinity
        bValue = getEffectiveCjPrice(b) ?? Infinity
        break
      case 'ssg_price':
        aValue = getEffectiveSsgPrice(a) ?? Infinity
        bValue = getEffectiveSsgPrice(b) ?? Infinity
        break
      case 'max_savings':
        aValue = getAdjustedSavings(a).max
        bValue = getAdjustedSavings(b).max
        break
      default:
        return 0
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }

    return sortDirection === 'asc'
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number)
  })

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={14} className="text-gray-400" />
    return sortDirection === 'asc'
      ? <ArrowUp size={14} className="text-blue-600" />
      : <ArrowDown size={14} className="text-blue-600" />
  }

  // Check if any item has a non-1 multiplier
  const hasAnyAdjustment = Object.values(adjustedPrices).some(
    adj => adj.cjMultiplier !== 1 || adj.ssgMultiplier !== 1
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-white">
      {/* Info banner when adjustments are active */}
      {hasAnyAdjustment && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-xs text-blue-700">
          수량 보정이 적용된 품목이 있습니다. 보정된 단가 기준으로 절감액이 재계산됩니다.
        </div>
      )}

      {/* 테이블 헤더 (CJ 숨김 시 컬럼 축소) */}
      <div
        className={cn(
          'grid border-b bg-gray-50',
          FEATURE_FLAGS.SHOW_CJ
            ? 'grid-cols-[1fr_100px_100px_100px_100px_32px]'
            : 'grid-cols-[1fr_100px_100px_100px_32px]'
        )}
      >
        <button
          onClick={() => handleSort('name')}
          className="flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          품목명
          <SortIcon field="name" />
        </button>
        <button
          onClick={() => handleSort('our_price')}
          className="flex items-center justify-end gap-2 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          내 단가
          <SortIcon field="our_price" />
        </button>
        {FEATURE_FLAGS.SHOW_CJ && (
          <button
            onClick={() => handleSort('cj_price')}
            className="flex items-center justify-end gap-2 px-4 py-3 text-sm font-medium hover:bg-gray-100"
          >
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
              CJ
            </span>
            <SortIcon field="cj_price" />
          </button>
        )}
        <button
          onClick={() => handleSort('ssg_price')}
          className="flex items-center justify-end gap-2 px-4 py-3 text-sm font-medium hover:bg-gray-100"
        >
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
            신세계
          </span>
          <SortIcon field="ssg_price" />
        </button>
        <button
          onClick={() => handleSort('max_savings')}
          className="flex items-center justify-end gap-2 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          절감액
          <SortIcon field="max_savings" />
        </button>
        <div /> {/* expand button column */}
      </div>

      {/* 테이블 바디 */}
      <div className="max-h-[600px] overflow-y-auto">
        {sortedItems.map((item) => {
          const savings = getAdjustedSavings(item)
          const hasSavings = savings.max > 0
          const bestSupplier = savings.bestSupplier
          const isExpanded = expandedItems.has(item.id)

          const cjAdj = adjustedPrices[item.id]
          const ssgAdj = adjustedPrices[item.id]
          const hasCjAdjustment = cjAdj && cjAdj.cjMultiplier !== 1
          const hasSsgAdjustment = ssgAdj && ssgAdj.ssgMultiplier !== 1

          return (
            <div key={item.id}>
              {/* Main row (CJ 숨김 시 컬럼 축소) */}
              <div
                className={cn(
                  'grid border-b py-3 transition-colors cursor-pointer',
                  FEATURE_FLAGS.SHOW_CJ
                    ? 'grid-cols-[1fr_100px_100px_100px_100px_32px]'
                    : 'grid-cols-[1fr_100px_100px_100px_32px]',
                  item.is_excluded ? 'opacity-60 bg-gray-100' : hasSavings ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
                )}
                onClick={() => toggleExpand(item.id)}
              >
                {/* 품목명 */}
                <div className="flex items-center gap-2 px-4">
                  <span className="truncate text-sm" title={item.extracted_name}>
                    {item.extracted_name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    x{item.extracted_quantity}
                  </span>
                  {item.extracted_spec && (
                    <span className="shrink-0 text-xs text-gray-400">
                      ({item.extracted_spec})
                    </span>
                  )}
                </div>

                {/* 내 단가 */}
                <div className="px-4 text-right text-sm">
                  {formatCurrency(item.extracted_unit_price)}
                </div>

                {/* CJ 단가 (feature flag로 숨김) */}
                {FEATURE_FLAGS.SHOW_CJ && (
                  <div className="px-4 text-right text-sm">
                    {item.cj_match ? (
                      <div>
                        <span className={cn(
                          'font-medium',
                          bestSupplier === 'CJ' && 'text-orange-600'
                        )}>
                          {hasCjAdjustment ? (
                            <>
                              {formatCurrency(cjAdj.cjAdjustedPrice)}
                              <span className="block text-xs text-gray-400 line-through">
                                {formatCurrency(item.cj_match.standard_price)}
                              </span>
                            </>
                          ) : (
                            formatCurrency(item.cj_match.standard_price)
                          )}
                        </span>
                        {item.cj_match.unit_normalized && !hasCjAdjustment && (
                          <span className="text-gray-500 font-normal">/{item.cj_match.unit_normalized}</span>
                        )}
                        {hasCjAdjustment && (
                          <span className="block text-xs text-orange-500">x{cjAdj.cjMultiplier}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>
                )}

                {/* 신세계 단가 — supplyRate 적용 (2026-05-16) */}
                <div className="px-4 text-right text-sm">
                  {item.ssg_match ? (
                    <div>
                      <span className={cn(
                        'font-medium',
                        bestSupplier === 'SHINSEGAE' && 'text-purple-600'
                      )}>
                        {(hasSsgAdjustment || supplyRate !== 1) ? (
                          <>
                            {formatCurrency(getEffectiveSsgPrice(item) ?? 0)}
                            <span className="block text-xs text-gray-400 line-through">
                              {formatCurrency(item.ssg_match.standard_price)}
                            </span>
                          </>
                        ) : (
                          formatCurrency(item.ssg_match.standard_price)
                        )}
                      </span>
                      {item.ssg_match.unit_normalized && !hasSsgAdjustment && supplyRate === 1 && (
                        <span className="text-gray-500 font-normal">/{item.ssg_match.unit_normalized}</span>
                      )}
                      {hasSsgAdjustment && (
                        <span className="block text-xs text-purple-500">x{ssgAdj.ssgMultiplier}</span>
                      )}
                      {supplyRate !== 1 && !hasSsgAdjustment && (
                        <span className="block text-xs text-blue-500">공급율 ×{supplyRate}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </div>

                {/* 최대 절감액 */}
                <div className="px-4 text-right text-sm">
                  {hasSavings ? (
                    <div className="flex flex-col items-end">
                      <span className="font-bold text-red-600">
                        {formatCurrency(savings.max)}
                      </span>
                      {bestSupplier && (
                        <span
                          className={cn(
                            'text-xs',
                            bestSupplier === 'CJ' ? 'text-orange-600' : 'text-purple-600'
                          )}
                        >
                          {bestSupplier === 'CJ' ? 'CJ' : '신세계'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </div>

                {/* Expand button + 비교 제외 토글 (2026-04-21) */}
                <div className="flex items-center justify-center gap-1">
                  {onToggleExclude && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleExclude(item.id, item.is_excluded ? undefined : '담당자 제외')
                      }}
                      className={cn(
                        'rounded p-1 transition-colors',
                        item.is_excluded
                          ? 'text-yellow-600 hover:bg-yellow-100'
                          : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600',
                      )}
                      title={item.is_excluded ? '비교 포함 (제외 해제)' : '보고서에서 비교 제외'}
                    >
                      {item.is_excluded ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  {(item.cj_match || item.ssg_match) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(item.id)
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded volume adjustment area */}
              {isExpanded && (
                <div className="border-b bg-gray-50 px-4 py-3">
                  <div className="grid grid-cols-2 gap-4">
                    {/* CJ Volume Adjuster */}
                    {item.cj_match && (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
                            CJ
                          </span>
                          <span className="text-xs text-gray-500 truncate">
                            {item.cj_match.product_name}
                          </span>
                          {item.cj_match.unit_normalized && (
                            <span className="text-xs text-gray-400">
                              ({item.cj_match.unit_normalized})
                            </span>
                          )}
                        </div>
                        <VolumeAdjuster
                          invoiceSpec={item.extracted_spec}
                          supplierSpec={item.cj_match.unit_normalized}
                          supplierUnitPrice={item.cj_match.standard_price}
                          invoiceUnitPrice={item.extracted_unit_price}
                          onChange={(adjustedPrice, multiplier) =>
                            handleCjAdjustment(item.id, adjustedPrice, multiplier)
                          }
                          colorTheme="orange"
                        />
                      </div>
                    )}

                    {/* SSG Volume Adjuster */}
                    {item.ssg_match && (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
                            신세계
                          </span>
                          <span className="text-xs text-gray-500 truncate">
                            {item.ssg_match.product_name}
                          </span>
                          {item.ssg_match.unit_normalized && (
                            <span className="text-xs text-gray-400">
                              ({item.ssg_match.unit_normalized})
                            </span>
                          )}
                        </div>
                        <VolumeAdjuster
                          invoiceSpec={item.extracted_spec}
                          supplierSpec={item.ssg_match.unit_normalized}
                          supplierUnitPrice={item.ssg_match.standard_price}
                          invoiceUnitPrice={item.extracted_unit_price}
                          onChange={(adjustedPrice, multiplier) =>
                            handleSsgAdjustment(item.id, adjustedPrice, multiplier)
                          }
                          colorTheme="purple"
                        />
                      </div>
                    )}
                  </div>

                  {/* No match info */}
                  {!item.cj_match && !item.ssg_match && (
                    <div className="text-sm text-gray-500">
                      매칭된 공급사 상품이 없어 수량 보정을 적용할 수 없습니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
