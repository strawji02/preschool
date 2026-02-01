'use client'

import { useState } from 'react'
import { Search, ChevronDown, ChevronUp } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { AuditItemResponse } from '@/types/audit'

interface AnalysisGridProps {
  items: AuditItemResponse[]
  onSearchClick: (item: AuditItemResponse) => void
}

export function AnalysisGrid({ items, onSearchClick }: AnalysisGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'matched' | 'pending' | 'unmatched'>('all')

  // 현재 페이지의 아이템만 필터링
  const pageItems = items.filter((item) => {
    // page_number가 없으면 전체 아이템에서 추정
    const matchesPage = true // 일단 모든 아이템 표시, 페이지 필터링은 나중에

    if (filter === 'all') return matchesPage
    if (filter === 'matched')
      return matchesPage && (item.match_status === 'auto_matched' || item.match_status === 'manual_matched')
    if (filter === 'pending') return matchesPage && item.match_status === 'pending'
    if (filter === 'unmatched') return matchesPage && item.match_status === 'unmatched'
    return matchesPage
  })

  const getStatusBadge = (status: AuditItemResponse['match_status']) => {
    switch (status) {
      case 'auto_matched':
        return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">자동매칭</span>
      case 'manual_matched':
        return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">수동매칭</span>
      case 'pending':
        return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">확인필요</span>
      case 'unmatched':
        return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">미매칭</span>
    }
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {/* 필터 탭 */}
      <div className="flex gap-1 border-b bg-gray-50 p-2">
        {[
          { key: 'all', label: '전체' },
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

      {/* 테이블 헤더 */}
      <div className="grid grid-cols-[1fr_80px_100px_100px_80px_50px] gap-2 border-b bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
        <div>품목명</div>
        <div className="text-right">수량</div>
        <div className="text-right">청구단가</div>
        <div className="text-right">기준단가</div>
        <div className="text-right">차액</div>
        <div></div>
      </div>

      {/* 테이블 바디 */}
      <div className="flex-1 overflow-y-auto">
        {pageItems.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-gray-500">표시할 항목이 없습니다</div>
        ) : (
          pageItems.map((item) => {
            const isExpanded = expandedId === item.id
            const hasLoss = item.loss_amount && item.loss_amount > 0

            return (
              <div key={item.id} className="border-b">
                {/* 메인 행 */}
                <div
                  className={cn(
                    'grid grid-cols-[1fr_80px_100px_100px_80px_50px] gap-2 px-4 py-3 transition-colors',
                    hasLoss ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {getStatusBadge(item.match_status)}
                    <span className="truncate text-sm">{item.extracted_name}</span>
                    {item.extracted_spec && (
                      <span className="truncate text-xs text-gray-500">({item.extracted_spec})</span>
                    )}
                  </div>

                  <div className="text-right text-sm">{item.extracted_quantity}</div>

                  <div className="text-right text-sm">{formatCurrency(item.extracted_unit_price)}</div>

                  <div className="text-right text-sm">
                    {item.matched_product ? (
                      <span className="text-green-600">{formatCurrency(item.matched_product.standard_price)}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>

                  <div className="text-right text-sm">
                    {hasLoss ? (
                      <span className="font-medium text-red-600">+{formatCurrency(item.loss_amount!)}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onSearchClick(item)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                      title="상품 검색"
                    >
                      <Search size={16} />
                    </button>

                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* 확장 영역 - 매칭 후보 */}
                {isExpanded && item.match_candidates && item.match_candidates.length > 0 && (
                  <div className="border-t bg-gray-50 px-4 py-3">
                    <p className="mb-2 text-xs font-medium text-gray-600">매칭 후보</p>
                    <div className="space-y-2">
                      {item.match_candidates.map((candidate, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded bg-white p-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                              {candidate.supplier}
                            </span>
                            <span>{candidate.product_name}</span>
                            <span className="text-xs text-gray-500">({Math.round(candidate.match_score * 100)}%)</span>
                          </div>
                          <span className="font-medium">{formatCurrency(candidate.standard_price)}</span>
                        </div>
                      ))}
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
