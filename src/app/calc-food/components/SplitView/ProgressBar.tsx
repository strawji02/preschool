'use client'

import { CheckCircle, Clock, AlertCircle } from 'lucide-react'
import type { ProgressStatus } from './types'

interface ProgressBarProps {
  status: ProgressStatus
}

export function ProgressBar({ status }: ProgressBarProps) {
  const percent = status.total > 0
    ? Math.round((status.completed / status.total) * 100)
    : 0

  return (
    <div className="flex items-center gap-6 border-b bg-white px-6 py-3">
      {/* 진행률 바 */}
      <div className="flex flex-1 items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="min-w-[80px] text-right text-sm font-medium text-gray-700">
          {status.completed}/{status.total} ({percent}%)
        </span>
      </div>

      {/* 상태 배지 */}
      <div className="flex items-center gap-4">
        {/* 자동 확정 */}
        <div className="flex items-center gap-1.5">
          <CheckCircle size={16} className="text-green-500" />
          <span className="text-sm text-gray-600">
            자동확정 <span className="font-semibold text-green-600">{status.autoConfirmed}</span>
          </span>
        </div>

        {/* 수동 검토 필요 */}
        <div className="flex items-center gap-1.5">
          <AlertCircle size={16} className="text-amber-500" />
          <span className="text-sm text-gray-600">
            수동검토 <span className="font-semibold text-amber-600">{status.manualReview}</span>
          </span>
        </div>

        {/* 남은 항목 */}
        <div className="flex items-center gap-1.5">
          <Clock size={16} className="text-gray-400" />
          <span className="text-sm text-gray-600">
            미완료 <span className="font-semibold text-gray-700">{status.total - status.completed}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
