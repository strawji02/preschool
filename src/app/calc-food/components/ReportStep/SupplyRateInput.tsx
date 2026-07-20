'use client'

/**
 * 공급율 입력 컴포넌트 (2026-05-16, 2026-07-21 공용 추출)
 *
 * 신세계 견적에 일괄 적용되는 배율 (예: 1.25 = 25% 마진 추가).
 * 변경 절감액 = 기존 - (신세계 × supplyRate)
 *
 * 0.5 ~ 2.0 범위, 0.01 step. proposal_extras.supply_rate에 저장 (useSupplyRate 훅).
 * 매칭 화면(compact)과 최종 보고서(기본) 양쪽에서 재사용.
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

export function SupplyRateInput({
  supplyRate,
  onChange,
  compact = false,
}: {
  supplyRate: number
  onChange: (rate: number) => void
  /** 매칭 화면 헤더용 축약 레이아웃 */
  compact?: boolean
}) {
  const [draft, setDraft] = useState(supplyRate.toFixed(2))
  useEffect(() => {
    setDraft(supplyRate.toFixed(2))
  }, [supplyRate])
  const active = supplyRate !== 1

  const commit = () => {
    const n = parseFloat(draft)
    if (Number.isFinite(n) && n >= 0.5 && n <= 2) {
      onChange(Number(n.toFixed(2)))
    } else {
      setDraft(supplyRate.toFixed(2))
    }
  }

  return (
    <section
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white',
        compact ? 'px-3 py-1.5' : 'mb-4 px-3 py-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          공급율
        </span>
        <span
          className="truncate text-[11px] text-gray-500"
          title="모든 신세계 단가에 곱하는 배율"
        >
          신세계 단가 ×N (예: 1.25 = 25% 마진)
        </span>
        {active && (
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
            ×{supplyRate.toFixed(2)} 적용
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          step="0.01"
          min="0.5"
          max="2"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className={cn(
            'w-20 rounded-md border px-2.5 py-1 text-right text-sm font-semibold focus:outline-none focus:ring-2',
            active
              ? 'border-blue-400 bg-blue-50 text-blue-700 focus:border-blue-500 focus:ring-blue-200'
              : 'border-gray-300 bg-white text-gray-700 focus:border-blue-500 focus:ring-blue-200',
          )}
        />
        {active && (
          <button
            onClick={() => onChange(1.25)}
            className="rounded-md border border-gray-300 px-2 py-1 text-[10px] text-gray-600 hover:bg-gray-50"
            title="공급율 초기화 (1.25)"
          >
            ↺
          </button>
        )}
      </div>
    </section>
  )
}
