'use client'

import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, AlertTriangle, Info } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier } from '@/types/audit'
import { validateItems, getHighestLevel, getLevelStyles } from '@/lib/integrity-check'
import type { ItemValidation, ValidationResult } from '@/lib/integrity-check'

interface AnalysisGridProps {
  items: ComparisonItem[]
  onSearchClick: (item: ComparisonItem, supplier: Supplier) => void
}

export function AnalysisGrid({ items, onSearchClick }: AnalysisGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'matched' | 'pending' | 'unmatched' | 'savings'>('all')
  const [hoveredCell, setHoveredCell] = useState<{ itemId: string; field: string } | null>(null)

  // 무결성 검증 실행
  const validations = useMemo(() => {
    return validateItems(items)
  }, [items])

  // 검증 결과를 itemId로 매핑
  const validationMap = useMemo(() => {
    const map = new Map<string, ItemValidation>()
    validations.forEach((validation) => {
      map.set(validation.item.id, validation)
    })
    return map
  }, [validations])

  // 필터링
  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true
    if (filter === 'matched')
      return item.match_status === 'auto_matched' || item.match_status === 'manual_matched'
    if (filter === 'pending') return item.match_status === 'pending'
    if (filter === 'unmatched') return item.match_status === 'unmatched'
    if (filter === 'savings') return item.savings.max > 0
    return true
  })

  const getStatusBadge = (status: ComparisonItem['match_status']) => {
    switch (status) {
      case 'auto_matched':
        return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">자동</span>
      case 'manual_matched':
        return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">수동</span>
      case 'pending':
        return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">확인</span>
      case 'unmatched':
        return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">미매칭</span>
    }
  }

  // 셀 하이라이트 스타일 및 툴팁 렌더링
  const getCellHighlight = (itemId: string, field: string) => {
    const validation = validationMap.get(itemId)
    if (!validation) return { style: '', tooltip: null }

    const fieldResults = validation.fields[field as keyof typeof validation.fields]
    if (!fieldResults || fieldResults.length === 0) return { style: '', tooltip: null }

    const level = getHighestLevel(fieldResults)
    const style = getLevelStyles(level)

    const isHovered = hoveredCell?.itemId === itemId && hoveredCell?.field === field
    const tooltip = isHovered ? (
      <div className="absolute z-50 mt-1 rounded-lg border bg-white p-2 shadow-lg">
        {fieldResults.map((result, idx) => (
          <div key={idx} className="flex items-start gap-2 text-xs">
            {result.level === 'error' && <AlertTriangle size={12} className="mt-0.5 text-red-600" />}
            {result.level === 'warning' && <AlertTriangle size={12} className="mt-0.5 text-yellow-600" />}
            {result.level === 'info' && <Info size={12} className="mt-0.5 text-blue-600" />}
            <span className={cn(
              result.level === 'error' && 'text-red-700',
              result.level === 'warning' && 'text-yellow-700',
              result.level === 'info' && 'text-blue-700'
            )}>
              {result.message}
            </span>
          </div>
        ))}
      </div>
    ) : null

    return { style, tooltip }
  }

  // 가격 셀 렌더링 (CJ 또는 SSG)
  const renderPriceCell = (
    item: ComparisonItem,
    supplier: Supplier,
    match: ComparisonItem['cj_match'] | ComparisonItem['ssg_match']
  ) => {
    const hasMatch = match !== undefined
    const isBetter = hasMatch && match.standard_price < item.extracted_unit_price

    if (!hasMatch) {
      return (
        <button
          onClick={() => onSearchClick(item, supplier)}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
        >
          검색
        </button>
      )
    }

    return (
      <div
        className={cn(
          'cursor-pointer rounded px-2 py-1 text-sm transition-colors',
          isBetter ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-gray-100'
        )}
        onClick={() => onSearchClick(item, supplier)}
        title={`${match.product_name} (${Math.round(match.match_score * 100)}%)`}
      >
        <span className={cn('font-medium', isBetter && 'text-green-700')}>
          {formatCurrency(match.standard_price)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* 필터 탭 */}
      <div className="flex gap-1 border-b bg-gray-50 p-2">
        {[
          { key: 'all', label: '전체' },
          { key: 'savings', label: '절감가능' },
          { key: 'matched', label: '매칭됨' },
          { key: 'pending', label: '확인필요' },
          { key: 'unmatched', label: '미매칭' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as typeof filter)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              filter === tab.key ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:bg-white/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 테이블 헤더 - 7컬럼 */}
      <div className="grid grid-cols-[1fr_60px_90px_90px_90px_80px_40px] gap-2 border-b bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
        <div>품목명</div>
        <div className="text-right">수량</div>
        <div className="text-right">내 단가</div>
        <div className="text-center">
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">CJ</span>
        </div>
        <div className="text-center">
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">신세계</span>
        </div>
        <div className="text-right">최대절감</div>
        <div></div>
      </div>

      {/* 테이블 바디 */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-gray-500">표시할 항목이 없습니다</div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id
            const hasSavings = item.savings.max > 0

            return (
              <div key={item.id} className="border-b">
                {/* 메인 행 */}
                <div
                  className={cn(
                    'grid grid-cols-[1fr_60px_90px_90px_90px_80px_40px] gap-2 px-4 py-3 transition-colors',
                    hasSavings ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
                  )}
                >
                  {/* 품목명 */}
                  <div
                    className={cn("flex items-center gap-2 min-w-0 relative rounded px-2 py-1 -mx-2 -my-1", getCellHighlight(item.id, 'name').style)}
                    onMouseEnter={() => setHoveredCell({ itemId: item.id, field: 'name' })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {getStatusBadge(item.match_status)}
                    <span className="truncate text-sm" title={item.extracted_name}>
                      {item.extracted_name}
                    </span>
                    {item.extracted_spec && (
                      <span className="hidden truncate text-xs text-gray-500 lg:inline">({item.extracted_spec})</span>
                    )}
                    {getCellHighlight(item.id, 'name').tooltip}
                  </div>

                  {/* 수량 */}
                  <div
                    className={cn("text-right text-sm relative rounded px-2 py-1 -mx-2 -my-1", getCellHighlight(item.id, 'quantity').style)}
                    onMouseEnter={() => setHoveredCell({ itemId: item.id, field: 'quantity' })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {item.extracted_quantity}
                    {getCellHighlight(item.id, 'quantity').tooltip}
                  </div>

                  {/* 내 단가 */}
                  <div
                    className={cn("text-right text-sm font-medium relative rounded px-2 py-1 -mx-2 -my-1", getCellHighlight(item.id, 'unit_price').style)}
                    onMouseEnter={() => setHoveredCell({ itemId: item.id, field: 'unit_price' })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {formatCurrency(item.extracted_unit_price)}
                    {getCellHighlight(item.id, 'unit_price').tooltip}
                  </div>

                  {/* CJ 가격 */}
                  <div className="flex items-center justify-center">
                    {renderPriceCell(item, 'CJ', item.cj_match)}
                  </div>

                  {/* 신세계 가격 */}
                  <div className="flex items-center justify-center">
                    {renderPriceCell(item, 'SHINSEGAE', item.ssg_match)}
                  </div>

                  {/* 최대 절감액 */}
                  <div className="text-right text-sm">
                    {hasSavings ? (
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-red-600">{formatCurrency(item.savings.max)}</span>
                        {item.savings.best_supplier && (
                          <span
                            className={cn(
                              'text-xs',
                              item.savings.best_supplier === 'CJ' ? 'text-orange-600' : 'text-purple-600'
                            )}
                          >
                            {item.savings.best_supplier === 'CJ' ? 'CJ' : '신세계'}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>

                  {/* 확장 버튼 */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* 확장 영역 - 상세 비교 */}
                {isExpanded && (
                  <div className="border-t bg-gray-50 px-4 py-3">
                    <div className="grid grid-cols-2 gap-4">
                      {/* CJ 상세 */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                            CJ
                          </span>
                          {item.cj_match && (
                            <span className="text-xs text-gray-500">
                              {Math.round(item.cj_match.match_score * 100)}% 일치
                            </span>
                          )}
                        </div>
                        {item.cj_match ? (
                          <div className="space-y-1 text-sm">
                            <p className="font-medium">{item.cj_match.product_name}</p>
                            <p className="text-gray-600">
                              단가: <span className="font-medium">{formatCurrency(item.cj_match.standard_price)}</span>
                            </p>
                            {item.savings.cj > 0 && (
                              <p className="text-red-600">절감: {formatCurrency(item.savings.cj)}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">매칭된 상품 없음</p>
                        )}
                        <button
                          onClick={() => onSearchClick(item, 'CJ')}
                          className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <Search size={12} />
                          다른 상품 검색
                        </button>
                      </div>

                      {/* 신세계 상세 */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                            신세계
                          </span>
                          {item.ssg_match && (
                            <span className="text-xs text-gray-500">
                              {Math.round(item.ssg_match.match_score * 100)}% 일치
                            </span>
                          )}
                        </div>
                        {item.ssg_match ? (
                          <div className="space-y-1 text-sm">
                            <p className="font-medium">{item.ssg_match.product_name}</p>
                            <p className="text-gray-600">
                              단가: <span className="font-medium">{formatCurrency(item.ssg_match.standard_price)}</span>
                            </p>
                            {item.savings.ssg > 0 && (
                              <p className="text-red-600">절감: {formatCurrency(item.savings.ssg)}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">매칭된 상품 없음</p>
                        )}
                        <button
                          onClick={() => onSearchClick(item, 'SHINSEGAE')}
                          className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <Search size={12} />
                          다른 상품 검색
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
