'use client'

import { TrendingDown, Star, CheckCircle, AlertCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { SupplierScenario } from '@/types/audit'
import { FEATURE_FLAGS } from '../../config'

interface ScenarioComparisonProps {
  cjScenario: SupplierScenario
  ssgScenario: SupplierScenario
}

export function ScenarioComparison({ cjScenario, ssgScenario }: ScenarioComparisonProps) {
  // CJ 숨김 모드: 신세계 단일 카드 (큰 크기)
  if (!FEATURE_FLAGS.SHOW_CJ) {
    return (
      <div className="grid grid-cols-1">
        <ScenarioCard
          scenario={ssgScenario}
          isRecommended={true}
          colorClass="purple"
          label="신세계"
          size="large"
        />
      </div>
    )
  }

  // 양쪽 표시 모드 (레거시)
  const recommended = cjScenario.totalSavings >= ssgScenario.totalSavings ? 'CJ' : 'SHINSEGAE'

  return (
    <div className="grid grid-cols-2 gap-6">
      <ScenarioCard
        scenario={cjScenario}
        isRecommended={recommended === 'CJ'}
        colorClass="orange"
        label="CJ"
      />
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
  size?: 'normal' | 'large'
}

function ScenarioCard({ scenario, isRecommended, colorClass, label, size = 'normal' }: ScenarioCardProps) {
  const bgColor = colorClass === 'orange' ? 'bg-orange-50' : 'bg-purple-50'
  const borderColor = colorClass === 'orange' ? 'border-orange-500' : 'border-purple-500'
  const textColor = colorClass === 'orange' ? 'text-orange-700' : 'text-purple-700'
  const badgeBg = colorClass === 'orange' ? 'bg-orange-100' : 'bg-purple-100'
  const savingsColor = colorClass === 'orange' ? 'text-orange-600' : 'text-purple-600'

  const savingsFontSize = size === 'large' ? 'text-4xl' : 'text-2xl'
  const padding = size === 'large' ? 'p-8' : 'p-6'
  const hasExcluded = scenario.excludedCount > 0

  return (
    <div
      className={cn(
        'relative rounded-xl border-2 transition-all',
        padding,
        isRecommended ? borderColor : 'border-gray-200',
        bgColor
      )}
    >
      {/* 추천 배지 (단일 카드 모드에서는 숨김) */}
      {isRecommended && size !== 'large' && (
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
        {/* 원장(기존 업체 거래명세표 총액) — 전체 품목 기준 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">기존 업체 거래명세표 총액</span>
          <span className="font-medium text-gray-900">{formatCurrency(scenario.grandTotalOurCost)}</span>
        </div>

        {/* 비교 대상 (비교 가능 품목) */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            비교 가능 품목 총액
            {hasExcluded && (
              <span className="ml-1 text-xs text-gray-500">
                (비교 불가 {formatNumber(scenario.excludedCount)}개 제외)
              </span>
            )}
          </span>
          <span className="font-medium text-gray-900">{formatCurrency(scenario.totalOurCost)}</span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">{label} 도입 시 비교 가능 총액</span>
          <span className={cn('font-medium', textColor)}>
            {formatCurrency(scenario.totalSupplierCost)}
          </span>
        </div>

        <div className="border-t border-gray-300 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown size={size === 'large' ? 24 : 20} className={savingsColor} />
              <span className={cn('font-medium text-gray-900', size === 'large' && 'text-lg')}>
                예상 절감액
              </span>
            </div>
            <div className="text-right">
              <p className={cn('font-bold', savingsFontSize, savingsColor)}>
                {formatCurrency(scenario.totalSavings)}
              </p>
              <p className={cn(size === 'large' ? 'text-base' : 'text-sm', savingsColor)}>
                ({scenario.savingsPercent.toFixed(1)}% 절감)
              </p>
            </div>
          </div>
        </div>

        {/* 비교 불가 품목 안내 (있는 경우만) */}
        {hasExcluded && (
          <div className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-800">
            💡 비교 불가 품목 {formatNumber(scenario.excludedCount)}개 ({formatCurrency(scenario.excludedTotalCost)})는
            기존 업체 그대로 유지됩니다. 보고서 하단 별지 참조.
          </div>
        )}
      </div>

      {/* 매칭 현황 */}
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-white/50 p-3">
        {scenario.unmatchedCount === 0 && scenario.matchedCount > 0 ? (
          <>
            <CheckCircle size={18} className="text-green-500" />
            <span className="text-sm text-gray-700">
              비교 가능 {formatNumber(scenario.matchedCount)}개 품목 전부 매칭 완료
            </span>
          </>
        ) : scenario.matchedCount === 0 ? (
          <>
            <AlertCircle size={18} className="text-red-500" />
            <span className="text-sm text-gray-700">
              매칭된 품목이 없습니다
            </span>
          </>
        ) : (
          <>
            <AlertCircle size={18} className="text-yellow-500" />
            <span className="text-sm text-gray-700">
              {formatNumber(scenario.matchedCount)}/{formatNumber(scenario.matchedCount + scenario.unmatchedCount)}개 매칭
              <span className="ml-1 text-yellow-600">
                ({formatNumber(scenario.unmatchedCount)}개 확인 필요)
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
