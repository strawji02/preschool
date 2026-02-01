'use client'

import { TrendingDown, Star, CheckCircle, AlertCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { SupplierScenario } from '@/types/audit'

interface ScenarioComparisonProps {
  cjScenario: SupplierScenario
  ssgScenario: SupplierScenario
}

export function ScenarioComparison({ cjScenario, ssgScenario }: ScenarioComparisonProps) {
  // 더 나은 시나리오 결정
  const recommended = cjScenario.totalSavings >= ssgScenario.totalSavings ? 'CJ' : 'SHINSEGAE'

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* CJ 시나리오 */}
      <ScenarioCard
        scenario={cjScenario}
        isRecommended={recommended === 'CJ'}
        colorClass="orange"
        label="CJ"
      />

      {/* SSG 시나리오 */}
      <ScenarioCard
        scenario={ssgScenario}
        isRecommended={recommended === 'SHINSEGAE'}
        colorClass="purple"
        label="신세계"
      />
    </div>
  )
}

interface ScenarioCardProps {
  scenario: SupplierScenario
  isRecommended: boolean
  colorClass: 'orange' | 'purple'
  label: string
}

function ScenarioCard({ scenario, isRecommended, colorClass, label }: ScenarioCardProps) {
  const bgColor = colorClass === 'orange' ? 'bg-orange-50' : 'bg-purple-50'
  const borderColor = colorClass === 'orange' ? 'border-orange-500' : 'border-purple-500'
  const textColor = colorClass === 'orange' ? 'text-orange-700' : 'text-purple-700'
  const badgeBg = colorClass === 'orange' ? 'bg-orange-100' : 'bg-purple-100'
  const savingsColor = colorClass === 'orange' ? 'text-orange-600' : 'text-purple-600'

  return (
    <div
      className={cn(
        'relative rounded-xl border-2 p-6 transition-all',
        isRecommended ? borderColor : 'border-gray-200',
        bgColor
      )}
    >
      {/* 추천 배지 */}
      {isRecommended && (
        <div className={cn(
          'absolute -top-3 left-4 flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium',
          colorClass === 'orange' ? 'bg-orange-500 text-white' : 'bg-purple-500 text-white'
        )}>
          <Star size={14} fill="currentColor" />
          추천
        </div>
      )}

      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('rounded px-2 py-0.5 text-sm font-semibold', badgeBg, textColor)}>
            {label}
          </span>
          <span className="text-sm text-gray-600">로 전환 시</span>
        </div>
      </div>

      {/* 금액 정보 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">현재 총액</span>
          <span className="font-medium text-gray-900">{formatCurrency(scenario.totalOurCost)}</span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">{label} 총액</span>
          <span className={cn('font-medium', textColor)}>
            {formatCurrency(scenario.totalSupplierCost)}
          </span>
        </div>

        <div className="border-t border-gray-300 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown size={20} className={savingsColor} />
              <span className="font-medium text-gray-900">예상 절감액</span>
            </div>
            <div className="text-right">
              <p className={cn('text-2xl font-bold', savingsColor)}>
                {formatCurrency(scenario.totalSavings)}
              </p>
              <p className={cn('text-sm', savingsColor)}>
                ({scenario.savingsPercent.toFixed(1)}%)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 매칭 현황 */}
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-white/50 p-3">
        {scenario.unmatchedCount === 0 ? (
          <>
            <CheckCircle size={18} className="text-green-500" />
            <span className="text-sm text-gray-700">
              전체 {formatNumber(scenario.matchedCount)}개 품목 매칭 완료
            </span>
          </>
        ) : (
          <>
            <AlertCircle size={18} className="text-yellow-500" />
            <span className="text-sm text-gray-700">
              {formatNumber(scenario.matchedCount)}/{formatNumber(scenario.matchedCount + scenario.unmatchedCount)}개 매칭
              <span className="ml-1 text-yellow-600">
                ({formatNumber(scenario.unmatchedCount)}개 미매칭)
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
