'use client'

import { TrendingDown, CheckCircle } from 'lucide-react'
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

      <div className="grid grid-cols-4 gap-3">
        {/* CJ 절감 */}
        <div className="rounded-lg bg-orange-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">CJ</span>
            <span className="text-sm text-orange-600">절감가능</span>
          </div>
          <p className="text-lg font-bold text-orange-600">{formatCurrency(stats.cjSavings)}</p>
          <p className="text-xs text-orange-500">{stats.cjMatchRate.toFixed(0)}% 매칭</p>
        </div>

        {/* 신세계 절감 */}
        <div className="rounded-lg bg-purple-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">신세계</span>
            <span className="text-sm text-purple-600">절감가능</span>
          </div>
          <p className="text-lg font-bold text-purple-600">{formatCurrency(stats.ssgSavings)}</p>
          <p className="text-xs text-purple-500">{stats.ssgMatchRate.toFixed(0)}% 매칭</p>
        </div>

        {/* 최대 절감액 */}
        <div className="rounded-lg bg-red-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <TrendingDown size={16} className="text-red-600" />
            <span className="text-sm text-red-600">최대 절감액</span>
          </div>
          <p className="text-xl font-bold text-red-600">{formatCurrency(stats.maxSavings)}</p>
          <p className="text-xs text-red-500">
            청구액 대비 {stats.totalBilled > 0 ? ((stats.maxSavings / stats.totalBilled) * 100).toFixed(1) : 0}%
          </p>
        </div>

        {/* 매칭 현황 */}
        <div className="rounded-lg bg-green-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600" />
            <span className="text-sm text-green-600">매칭 현황</span>
          </div>
          <p className="text-xl font-bold text-green-600">
            {stats.matchedItems}/{stats.totalItems}
          </p>
          <p className="text-xs text-green-500">
            {stats.pendingItems > 0 && `확인필요 ${stats.pendingItems}개`}
            {stats.pendingItems > 0 && stats.unmatchedItems > 0 && ' · '}
            {stats.unmatchedItems > 0 && `미매칭 ${stats.unmatchedItems}개`}
            {stats.pendingItems === 0 && stats.unmatchedItems === 0 && '전체 매칭 완료'}
          </p>
        </div>
      </div>
    </div>
  )
}
