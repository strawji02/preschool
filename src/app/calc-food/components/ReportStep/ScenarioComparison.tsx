'use client'

import { CheckCircle, AlertCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { SupplierScenario } from '@/types/audit'
import { FEATURE_FLAGS } from '../../config'

interface ScenarioComparisonProps {
  cjScenario: SupplierScenario
  ssgScenario: SupplierScenario
}

/**
 * 비용 절감 시나리오 (2026-05-16 PPTX 스타일 재설계)
 *
 * 사용자 PPT 디자인 컨셉 반영 — 콤팩트한 카드 그리드:
 *  1) Navy hero — 절감액 강조
 *  2) 비용 효율 비교 — 가로 막대 + % 표시
 *  3) 메타 카드 (거래명세표 / 비교 가능 / 비교 불가)
 *  4) 매칭 현황
 *
 * 좁은 화면(보고서 화면의 우측 50% 폭)에 맞춰 카드 가로 길이 축소.
 */
export function ScenarioComparison({ cjScenario, ssgScenario }: ScenarioComparisonProps) {
  // CJ 숨김 모드 (default): 신세계 단일
  if (!FEATURE_FLAGS.SHOW_CJ) {
    return <ShinsegaeScenarioPanel scenario={ssgScenario} />
  }
  // CJ + 신세계 둘 다 (legacy 모드)
  return (
    <div className="space-y-5">
      <ShinsegaeScenarioPanel scenario={ssgScenario} />
      <details className="rounded-lg border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-medium text-gray-600">
          CJ 시나리오 비교
        </summary>
        <div className="mt-2">
          <ShinsegaeScenarioPanel scenario={cjScenario} accent="orange" />
        </div>
      </details>
    </div>
  )
}

function ShinsegaeScenarioPanel({
  scenario,
  accent = 'blue',
}: {
  scenario: SupplierScenario
  accent?: 'blue' | 'orange'
}) {
  const ssgPct = scenario.totalOurCost > 0
    ? (scenario.totalSupplierCost / scenario.totalOurCost) * 100
    : 0
  const isSaving = scenario.totalSavings > 0
  const hasExcluded = scenario.excludedCount > 0
  const isAllMatched = scenario.unmatchedCount === 0 && scenario.matchedCount > 0
  const isNoMatch = scenario.matchedCount === 0

  // 컬러 팔레트 (PPTX 디자인 컨셉)
  const c = accent === 'orange'
    ? {
        heroFrom: 'from-orange-700',
        heroTo: 'to-orange-500',
        heroBadge: 'bg-amber-400 text-orange-900',
        barFill: 'bg-orange-600',
        accent: 'text-orange-700',
      }
    : {
        heroFrom: 'from-blue-900',
        heroTo: 'to-blue-700',
        heroBadge: 'bg-amber-400 text-blue-900',
        barFill: 'bg-blue-700',
        accent: 'text-blue-700',
      }

  return (
    <div className="space-y-3">
      {/* ─── 1. Navy Hero — 절감액 강조 ─── */}
      <div className={cn('relative overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white shadow-md', c.heroFrom, c.heroTo)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-wider text-blue-200">
              📊  신세계 도입 시
            </div>
            <div className="mt-1 text-base font-bold text-white">예상 절감액</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-white">
                {isSaving ? '−' : '+'} {formatCurrency(Math.abs(scenario.totalSavings))}
              </span>
              <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold', c.heroBadge)}>
                {isSaving ? '▼' : '▲'} {scenario.savingsPercent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 text-[11px] text-blue-200">비교 가능 품목 기준</div>
          </div>
        </div>
      </div>

      {/* ─── 2. 비용 효율 비교 — 가로 막대 ─── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">비용 효율 비교</h4>
          <span className={cn('text-xs font-bold', c.accent)}>
            {(100 - ssgPct).toFixed(1)}% 절감
          </span>
        </div>
        {/* 범례 */}
        <div className="mt-2 flex items-center gap-3 text-[10px]">
          <span className="inline-flex items-center gap-1 text-gray-600">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
            현재 (100%)
          </span>
          <span className={cn('inline-flex items-center gap-1 font-medium', c.accent)}>
            <span className={cn('inline-block h-2 w-2 rounded-full', c.barFill)} />
            신세계 ({ssgPct.toFixed(1)}%)
          </span>
        </div>
        {/* 막대 */}
        <div className="relative mt-2 h-7 overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn('absolute inset-y-0 left-0 rounded-full transition-all', c.barFill)}
            style={{ width: `${Math.min(100, ssgPct)}%` }}
          />
          {/* 신세계 % 라벨 (막대 끝, 흰색) */}
          {ssgPct >= 15 && (
            <span
              className="absolute inset-y-0 flex items-center text-[11px] font-bold text-white"
              style={{ left: `calc(${Math.min(100, ssgPct)}% - 2.7rem)` }}
            >
              {ssgPct.toFixed(1)}%
            </span>
          )}
          {/* 100% 라벨 (우측, 회색) */}
          <span className="absolute inset-y-0 right-2 flex items-center text-[10px] text-gray-500">
            100%
          </span>
        </div>
      </div>

      {/* ─── 3. 메타 카드 (총액 정보) — 2x2 그리드 ─── */}
      <div className="grid grid-cols-2 gap-2">
        <MetaCard
          label="거래명세표 총액"
          value={formatCurrency(scenario.grandTotalOurCost)}
          sub="원장 전체 (97건)"
        />
        <MetaCard
          label={isSaving ? '예상 신세계 견적' : '예상 신세계 견적'}
          value={formatCurrency(scenario.totalSupplierCost)}
          sub={`비교 가능 ${scenario.matchedCount}건`}
          highlight
        />
        <MetaCard
          label="비교 가능 총액"
          value={formatCurrency(scenario.totalOurCost)}
          sub={`${scenario.matchedCount}건 매칭`}
        />
        {hasExcluded ? (
          <MetaCard
            label="비교 불가 총액"
            value={formatCurrency(scenario.excludedTotalCost)}
            sub={`${scenario.excludedCount}건 별지`}
            muted
          />
        ) : (
          <MetaCard
            label="매칭 완료"
            value={`${formatNumber(scenario.matchedCount)}건`}
            sub="100%"
          />
        )}
      </div>

      {/* ─── 4. 매칭 현황 알림 (조건부) ─── */}
      {isAllMatched ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <CheckCircle size={14} className="text-green-600" />
          <span className="text-xs text-green-800">
            비교 가능 {formatNumber(scenario.matchedCount)}개 품목 전부 매칭 완료
          </span>
        </div>
      ) : isNoMatch ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <AlertCircle size={14} className="text-red-600" />
          <span className="text-xs text-red-800">매칭된 품목이 없습니다</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertCircle size={14} className="text-amber-600" />
          <span className="text-xs text-amber-800">
            {formatNumber(scenario.matchedCount)}/
            {formatNumber(scenario.matchedCount + scenario.unmatchedCount)}개 매칭
            <span className="ml-1 font-medium">
              ({formatNumber(scenario.unmatchedCount)}개 확인 필요)
            </span>
          </span>
        </div>
      )}

      {/* ─── 5. 비교 불가 안내 (조건부) ─── */}
      {hasExcluded && (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          💡 비교 불가 품목 {formatNumber(scenario.excludedCount)}개 ({formatCurrency(scenario.excludedTotalCost)})는
          기존 업체 그대로 유지됩니다. 하단 별지 참조.
        </div>
      )}
    </div>
  )
}

/** 작은 메타 카드 (2x2 그리드용) */
function MetaCard({
  label,
  value,
  sub,
  highlight,
  muted,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2.5',
        highlight
          ? 'border-blue-200 bg-blue-50/60'
          : muted
          ? 'border-gray-200 bg-gray-50'
          : 'border-gray-200 bg-white',
      )}
    >
      <div className={cn('text-[10px] font-medium', muted ? 'text-gray-500' : 'text-gray-600')}>
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 text-base font-bold tabular-nums',
          highlight ? 'text-blue-700' : muted ? 'text-gray-500' : 'text-gray-900',
        )}
      >
        {value}
      </div>
      {sub && (
        <div className={cn('mt-0.5 text-[10px]', muted ? 'text-gray-400' : 'text-gray-500')}>
          {sub}
        </div>
      )}
    </div>
  )
}
