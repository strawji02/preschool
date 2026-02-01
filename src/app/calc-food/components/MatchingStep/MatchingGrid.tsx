'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier, SupplierMatch } from '@/types/audit'
import { MatchingRow } from './MatchingRow'

interface MatchingGridProps {
  items: ComparisonItem[]
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirm: (itemId: string) => void
  onSearchClick: (item: ComparisonItem, supplier: Supplier) => void
}

type FilterType = 'all' | 'confirmed' | 'unconfirmed' | 'matched' | 'pending' | 'unmatched'

export function MatchingGrid({
  items,
  onSelectCandidate,
  onConfirm,
  onSearchClick,
}: MatchingGridProps) {
  const [filter, setFilter] = useState<FilterType>('all')

  // 필터링
  const filteredItems = items.filter((item) => {
    switch (filter) {
      case 'all':
        return true
      case 'confirmed':
        return item.is_confirmed
      case 'unconfirmed':
        return !item.is_confirmed
      case 'matched':
        return item.match_status === 'auto_matched' || item.match_status === 'manual_matched'
      case 'pending':
        return item.match_status === 'pending'
      case 'unmatched':
        return item.match_status === 'unmatched'
      default:
        return true
    }
  })

  // 필터 카운트
  const counts = {
    all: items.length,
    confirmed: items.filter(i => i.is_confirmed).length,
    unconfirmed: items.filter(i => !i.is_confirmed).length,
    matched: items.filter(i => i.match_status === 'auto_matched' || i.match_status === 'manual_matched').length,
    pending: items.filter(i => i.match_status === 'pending').length,
    unmatched: items.filter(i => i.match_status === 'unmatched').length,
  }

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'unconfirmed', label: '미확정' },
    { key: 'confirmed', label: '확정됨' },
    { key: 'pending', label: '확인필요' },
    { key: 'unmatched', label: '미매칭' },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 필터 탭 */}
      <div className="flex gap-1 border-b bg-gray-50 p-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              filter === tab.key
                ? 'bg-white font-medium text-gray-900 shadow-sm'
                : 'text-gray-600 hover:bg-white/50'
            )}
          >
            {tab.label}
            <span className="ml-1 text-xs text-gray-400">({counts[tab.key]})</span>
          </button>
        ))}
      </div>

      {/* 테이블 헤더 - 7컬럼 (절감액 없음!) */}
      <div className="grid grid-cols-[1fr_60px_90px_120px_120px_60px_40px] gap-2 border-b bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
        <div>품목명</div>
        <div className="text-right">수량</div>
        <div className="text-right">내 단가</div>
        <div className="text-center">
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
            CJ 선택
          </span>
        </div>
        <div className="text-center">
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
            SSG 선택
          </span>
        </div>
        <div className="text-center">확정</div>
        <div></div>
      </div>

      {/* 테이블 바디 */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-gray-500">
            표시할 항목이 없습니다
          </div>
        ) : (
          filteredItems.map((item) => (
            <MatchingRow
              key={item.id}
              item={item}
              onSelectCandidate={onSelectCandidate}
              onConfirm={onConfirm}
              onSearchClick={onSearchClick}
            />
          ))
        )}
      </div>
    </div>
  )
}
