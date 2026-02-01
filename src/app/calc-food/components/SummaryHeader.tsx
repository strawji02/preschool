'use client'

import { TrendingDown, CheckCircle, AlertCircle, HelpCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { SessionStats } from '../hooks/useAuditSession'

interface SummaryHeaderProps {
  stats: SessionStats
  fileName: string
}

export function SummaryHeader({ stats, fileName }: SummaryHeaderProps) {
  return (
    <div className="border-b bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{fileName}</h2>
        <span className="text-sm text-gray-500">{formatNumber(stats.totalItems)}개 품목</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* 총 손실액 */}
        <div className="rounded-lg bg-red-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <TrendingDown size={16} className="text-red-600" />
            <span className="text-sm text-red-600">총 손실액</span>
          </div>
          <p className="text-xl font-bold text-red-600">{formatCurrency(stats.totalLoss)}</p>
        </div>

        {/* 매칭됨 */}
        <div className="rounded-lg bg-green-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600" />
            <span className="text-sm text-green-600">매칭됨</span>
          </div>
          <p className="text-xl font-bold text-green-600">{stats.matchedItems}개</p>
        </div>

        {/* 확인 필요 */}
        <div className="rounded-lg bg-yellow-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <AlertCircle size={16} className="text-yellow-600" />
            <span className="text-sm text-yellow-600">확인 필요</span>
          </div>
          <p className="text-xl font-bold text-yellow-600">{stats.pendingItems}개</p>
        </div>

        {/* 미매칭 */}
        <div className="rounded-lg bg-gray-100 p-3">
          <div className="mb-1 flex items-center gap-2">
            <HelpCircle size={16} className="text-gray-600" />
            <span className="text-sm text-gray-600">미매칭</span>
          </div>
          <p className="text-xl font-bold text-gray-600">{stats.unmatchedItems}개</p>
        </div>
      </div>
    </div>
  )
}
