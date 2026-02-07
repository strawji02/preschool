'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, Circle } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier, SupplierMatch } from '@/types/audit'
import { CandidateSelector } from './CandidateSelector'

interface MatchingRowProps {
  item: ComparisonItem
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirm: (itemId: string) => void
  onSearchClick: (item: ComparisonItem, supplier: Supplier) => void
}

export function MatchingRow({
  item,
  onSelectCandidate,
  onConfirm,
  onSearchClick,
}: MatchingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 견적불가 여부 확인 (CJ와 SSG 모두 후보가 없는 경우)
  const noMatch = item.cj_candidates.length === 0 && item.ssg_candidates.length === 0

  const getStatusBadge = () => {
    // 견적불가 우선 표시
    if (noMatch) {
      return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">견적불가</span>
    }

    switch (item.match_status) {
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

  return (
    <div className="border-b">
      {/* 메인 행 - 7컬럼 (절감액 제외) */}
      <div
        className={cn(
          'grid grid-cols-[1fr_60px_90px_120px_120px_60px_40px] gap-2 px-4 py-3 transition-colors',
          item.is_confirmed ? 'bg-green-50' : 'hover:bg-gray-50'
        )}
      >
        {/* 품목명 */}
        <div className="flex items-center gap-2 min-w-0">
          {getStatusBadge()}
          <span className="truncate text-sm" title={item.extracted_name}>
            {item.extracted_name}
          </span>
          {item.extracted_spec && (
            <span className="hidden truncate text-xs text-gray-500 lg:inline">
              ({item.extracted_spec})
            </span>
          )}
        </div>

        {/* 수량 */}
        <div className="flex items-center justify-end text-sm">
          {item.extracted_quantity}
        </div>

        {/* 내 단가 */}
        <div className="flex items-center justify-end text-sm font-medium">
          {formatCurrency(item.extracted_unit_price)}
        </div>

        {/* CJ 선택 */}
        <div className="flex items-center justify-center">
          <CandidateSelector
            supplier="CJ"
            candidates={item.cj_candidates}
            selectedMatch={item.cj_match}
            onSelect={(candidate) => onSelectCandidate(item.id, 'CJ', candidate)}
            onSearchClick={() => onSearchClick(item, 'CJ')}
            disabled={item.is_confirmed}
          />
        </div>

        {/* SSG 선택 */}
        <div className="flex items-center justify-center">
          <CandidateSelector
            supplier="SHINSEGAE"
            candidates={item.ssg_candidates}
            selectedMatch={item.ssg_match}
            onSelect={(candidate) => onSelectCandidate(item.id, 'SHINSEGAE', candidate)}
            onSearchClick={() => onSearchClick(item, 'SHINSEGAE')}
            disabled={item.is_confirmed}
          />
        </div>

        {/* 확정 버튼 (토글 가능) */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => onConfirm(item.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
              item.is_confirmed
                ? 'bg-green-500 hover:bg-green-600'
                : 'border-2 border-gray-300 text-gray-400 hover:border-green-500 hover:text-green-500'
            )}
            title={item.is_confirmed ? '확정 해제' : '확정'}
          >
            {item.is_confirmed ? (
              <Check size={14} className="text-white" />
            ) : (
              <Circle size={14} />
            )}
          </button>
        </div>

        {/* 확장 버튼 */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* 확장 영역 - 후보 카드 그리드 */}
      {isExpanded && (
        <div className="border-t bg-gray-50 px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* CJ 후보 목록 */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
                  CJ
                </span>
                후보 ({item.cj_candidates.length}개)
              </h4>
              <div className="space-y-2">
                {item.cj_candidates.length === 0 ? (
                  <p className="text-sm text-gray-500">매칭 후보 없음</p>
                ) : (
                  item.cj_candidates.map((candidate, index) => {
                    const isSelected = item.cj_match?.id === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => !item.is_confirmed && onSelectCandidate(item.id, 'CJ', candidate)}
                        disabled={item.is_confirmed}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-all',
                          isSelected
                            ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                            : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50',
                          item.is_confirmed && 'cursor-not-allowed opacity-60'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                              isSelected
                                ? 'bg-orange-500 text-white'
                                : 'bg-gray-200 text-gray-600'
                            )}>
                              {isSelected ? <Check size={12} /> : index + 1}
                            </span>
                            <span className="text-sm font-medium">{candidate.product_name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {Math.round(candidate.match_score * 100)}%
                          </span>
                        </div>
                        <div className="mt-1 pl-7 text-sm text-orange-600 font-medium">
                          {formatCurrency(candidate.standard_price)}
                          {candidate.unit_normalized && (
                            <span className="text-orange-400">/{candidate.unit_normalized}</span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* SSG 후보 목록 */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
                  신세계
                </span>
                후보 ({item.ssg_candidates.length}개)
              </h4>
              <div className="space-y-2">
                {item.ssg_candidates.length === 0 ? (
                  <p className="text-sm text-gray-500">매칭 후보 없음</p>
                ) : (
                  item.ssg_candidates.map((candidate, index) => {
                    const isSelected = item.ssg_match?.id === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => !item.is_confirmed && onSelectCandidate(item.id, 'SHINSEGAE', candidate)}
                        disabled={item.is_confirmed}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-all',
                          isSelected
                            ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                            : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/50',
                          item.is_confirmed && 'cursor-not-allowed opacity-60'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                              isSelected
                                ? 'bg-purple-500 text-white'
                                : 'bg-gray-200 text-gray-600'
                            )}>
                              {isSelected ? <Check size={12} /> : index + 1}
                            </span>
                            <span className="text-sm font-medium">{candidate.product_name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {Math.round(candidate.match_score * 100)}%
                          </span>
                        </div>
                        <div className="mt-1 pl-7 text-sm text-purple-600 font-medium">
                          {formatCurrency(candidate.standard_price)}
                          {candidate.unit_normalized && (
                            <span className="text-purple-400">/{candidate.unit_normalized}</span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
