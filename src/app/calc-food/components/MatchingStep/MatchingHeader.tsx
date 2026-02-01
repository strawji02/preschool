'use client'

import { CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'

interface MatchingHeaderProps {
  fileName: string
  confirmationStats: {
    total: number
    confirmed: number
    unconfirmed: number
  }
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
}

export function MatchingHeader({
  fileName,
  confirmationStats,
  onConfirmAllAutoMatched,
  onProceedToReport,
}: MatchingHeaderProps) {
  const { total, confirmed, unconfirmed } = confirmationStats
  const progress = total > 0 ? (confirmed / total) * 100 : 0
  const isAllConfirmed = unconfirmed === 0

  return (
    <div className="border-b bg-white p-4">
      {/* 제목 행 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{fileName}</h2>
          <p className="text-sm text-gray-500">
            매칭 결과를 확인하고 각 품목의 공급사 매칭을 확정하세요
          </p>
        </div>

        {/* 분석 완료 버튼 */}
        <button
          onClick={onProceedToReport}
          className={cn(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium transition-colors',
            isAllConfirmed
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          )}
        >
          분석 완료
          <ArrowRight size={18} />
        </button>
      </div>

      {/* 진행 상황 */}
      <div className="rounded-lg bg-gray-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isAllConfirmed ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            )}
            <span className="font-medium text-gray-900">
              {isAllConfirmed
                ? '모든 품목 확정 완료'
                : `${formatNumber(unconfirmed)}개 품목 확정 필요`}
            </span>
          </div>

          {/* 자동매칭 전체 확정 버튼 */}
          {unconfirmed > 0 && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200"
            >
              자동매칭 전체 확정
            </button>
          )}
        </div>

        {/* 진행바 */}
        <div className="relative h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className={cn(
              'absolute left-0 top-0 h-full transition-all duration-300',
              isAllConfirmed ? 'bg-green-500' : 'bg-blue-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 상세 통계 */}
        <div className="mt-3 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-gray-600">확정됨</span>
            <span className="font-medium">{formatNumber(confirmed)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-gray-300" />
            <span className="text-gray-600">미확정</span>
            <span className="font-medium">{formatNumber(unconfirmed)}</span>
          </div>
          <div className="ml-auto text-gray-500">
            총 {formatNumber(total)}개 품목
          </div>
        </div>
      </div>
    </div>
  )
}
