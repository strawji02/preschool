'use client'

/**
 * 카테고리별 절감 카드 그리드 (2026-05-16)
 *
 * 사용자 PPTX 디자인 컨셉 반영:
 *  - 좌측 둥근 아이콘 (소프트 블루 배경 + 이모지)
 *  - 우상 절감률 회색 배지
 *  - 카테고리명 (한글) + (English)
 *  - 주요 품목 (top 3, 절감액 작게)
 *  - 비용 (회색 작게)
 *  - 큰 절감액 (navy bold)
 *
 * 좁은 화면(보고서 50% 폭)을 위해 2x2 그리드 사용.
 */
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { FoodCategory } from '@/lib/category-classifier'
import type { CategoryStat } from './ProposalReport'

const CATEGORY_META: Record<
  FoodCategory,
  { en: string; emoji: string }
> = {
  '농산': { en: 'Agricultural', emoji: '🌱' },
  '축산': { en: 'Livestock', emoji: '🥩' },
  '수산': { en: 'Marine', emoji: '🌊' },
  '가공·기타': { en: 'Processed/Etc', emoji: '📦' },
}

function shortName(name: string, max = 8): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

export function CategoryBreakdownCards({
  stats,
  cols = 2,
}: {
  stats: CategoryStat[]
  /** 그리드 열 수 — 2(분석화면 50% 폭) 또는 4(제안서 풀스크린) */
  cols?: 2 | 4
}) {
  if (stats.length === 0) return null
  return (
    <div
      className={cn(
        'grid gap-2.5',
        cols === 4 ? 'grid-cols-4' : 'grid-cols-2',
      )}
    >
      {stats.map((stat) => (
        <CategoryCard key={stat.category} stat={stat} />
      ))}
    </div>
  )
}

function CategoryCard({ stat }: { stat: CategoryStat }) {
  const meta = CATEGORY_META[stat.category]
  const isSaving = stat.savings > 0
  return (
    <div className="relative rounded-lg border border-gray-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm">
      {/* 우상 절감률 배지 */}
      <span
        className={cn(
          'absolute right-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold',
          isSaving ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700',
        )}
      >
        {isSaving ? '▼' : '▲'} {stat.savingsPercent.toFixed(1)}%
      </span>

      {/* 좌측 아이콘 (둥근 소프트 블루) */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-lg">
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-bold text-gray-900">{stat.category}</span>
            <span className="text-[10px] text-gray-500">({meta.en})</span>
          </div>
          <div className="text-[10px] text-gray-500">
            {formatNumber(stat.itemCount)}개 품목
          </div>
        </div>
      </div>

      {/* 주요 품목 */}
      {stat.topItems.length > 0 && (
        <div className="mt-2 text-[10px] text-gray-600" title={stat.topItems.map((it) => it.name).join(', ')}>
          <span className="text-gray-400">주요: </span>
          {stat.topItems.slice(0, 3).map((it) => shortName(it.name)).join(', ')}
        </div>
      )}

      {/* 비용 + 큰 절감액 */}
      <div className="mt-2 flex items-end justify-between border-t border-gray-100 pt-2">
        <span className="text-[10px] text-gray-500">
          비용 {formatCurrency(stat.ourCost)}
        </span>
        <span
          className={cn(
            'text-base font-bold tabular-nums',
            isSaving ? 'text-blue-700' : 'text-red-700',
          )}
        >
          {isSaving ? '−' : '+'} {formatCurrency(Math.abs(stat.savings))}
        </span>
      </div>
    </div>
  )
}
