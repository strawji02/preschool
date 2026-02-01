'use client'

import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem } from '@/types/audit'

interface ItemBreakdownTableProps {
  items: ComparisonItem[]
}

type SortField = 'name' | 'our_price' | 'cj_price' | 'ssg_price' | 'max_savings'
type SortDirection = 'asc' | 'desc'

export function ItemBreakdownTable({ items }: ItemBreakdownTableProps) {
  const [sortField, setSortField] = useState<SortField>('max_savings')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
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
        aValue = a.cj_match?.standard_price ?? Infinity
        bValue = b.cj_match?.standard_price ?? Infinity
        break
      case 'ssg_price':
        aValue = a.ssg_match?.standard_price ?? Infinity
        bValue = b.ssg_match?.standard_price ?? Infinity
        break
      case 'max_savings':
        aValue = a.savings.max
        bValue = b.savings.max
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

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-white">
      {/* 테이블 헤더 */}
      <div className="grid grid-cols-[1fr_100px_100px_100px_100px] border-b bg-gray-50">
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
        <button
          onClick={() => handleSort('cj_price')}
          className="flex items-center justify-end gap-2 px-4 py-3 text-sm font-medium hover:bg-gray-100"
        >
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
            CJ
          </span>
          <SortIcon field="cj_price" />
        </button>
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
          최대 절감
          <SortIcon field="max_savings" />
        </button>
      </div>

      {/* 테이블 바디 */}
      <div className="max-h-96 overflow-y-auto">
        {sortedItems.map((item) => {
          const hasSavings = item.savings.max > 0
          const bestSupplier = item.savings.best_supplier

          return (
            <div
              key={item.id}
              className={cn(
                'grid grid-cols-[1fr_100px_100px_100px_100px] border-b py-3 transition-colors',
                hasSavings ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
              )}
            >
              {/* 품목명 */}
              <div className="flex items-center gap-2 px-4">
                <span className="truncate text-sm" title={item.extracted_name}>
                  {item.extracted_name}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  x{item.extracted_quantity}
                </span>
              </div>

              {/* 내 단가 */}
              <div className="px-4 text-right text-sm">
                {formatCurrency(item.extracted_unit_price)}
              </div>

              {/* CJ 단가 */}
              <div className="px-4 text-right text-sm">
                {item.cj_match ? (
                  <span className={cn(
                    'font-medium',
                    bestSupplier === 'CJ' && 'text-orange-600'
                  )}>
                    {formatCurrency(item.cj_match.standard_price)}
                    {item.cj_match.unit_normalized && (
                      <span className="text-gray-500 font-normal">/{item.cj_match.unit_normalized}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </div>

              {/* 신세계 단가 */}
              <div className="px-4 text-right text-sm">
                {item.ssg_match ? (
                  <span className={cn(
                    'font-medium',
                    bestSupplier === 'SHINSEGAE' && 'text-purple-600'
                  )}>
                    {formatCurrency(item.ssg_match.standard_price)}
                    {item.ssg_match.unit_normalized && (
                      <span className="text-gray-500 font-normal">/{item.ssg_match.unit_normalized}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </div>

              {/* 최대 절감액 */}
              <div className="px-4 text-right text-sm">
                {hasSavings ? (
                  <div className="flex flex-col items-end">
                    <span className="font-bold text-red-600">
                      {formatCurrency(item.savings.max)}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
