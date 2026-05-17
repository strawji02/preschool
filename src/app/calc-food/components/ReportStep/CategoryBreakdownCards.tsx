'use client'

/**
 * 카테고리별 절감 카드 그리드 (2026-05-17 — 사용자 첨부 이미지 디자인 반영)
 *
 * Layout (사용자 요청):
 *   ┌─────────────────────────────────────────┐
 *   │ [🌱]  ▼7.0%        현 거래처 ₩2,249,187 │
 *   │                          − ₩156,752     │
 *   │ 농산                                     │
 *   │ 아이누리 감자 -₩37K                       │
 *   │ 아이누리 감자 -₩32K                       │
 *   │ 아욱 -₩17K 외...                          │
 *   └─────────────────────────────────────────┘
 *
 * - 좌상: 아이콘 (소프트 블루 배경 + 이모지) + 절감률 회색 배지
 * - 우상: 현 거래처 비용 (작은 회색) + 큰 절감액 (빨강 bold)
 * - 좌중: 카테고리명 (한글)
 * - 좌하: 3개 주요 품목 좌측 정렬 (각 줄, 절감액 K 표기)
 */
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { FoodCategory } from '@/lib/category-classifier'
import type { CategoryStat } from './ProposalReport'

const CATEGORY_META: Record<FoodCategory, { emoji: string }> = {
  '농산': { emoji: '🌱' },
  '축산': { emoji: '🥩' },
  '수산': { emoji: '🌊' },
  '가공·기타': { emoji: '📦' },
}

function shortName(name: string, max = 10): string {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped
}

function shortKRW(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`
  return formatCurrency(n)
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
  // 표시할 주요 품목 (top 3) + "외 N..." 인디케이터
  const topItems = stat.topItems.slice(0, 3)
  const hasMore = stat.topItems.length > 3

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm">
      {/* ─── 상단 row: [좌] 아이콘 + 절감률 배지  /  [우] 현 거래처 + 절감액 ─── */}
      <div className="flex items-start justify-between gap-2">
        {/* 좌상: 아이콘 + 절감률 배지 */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-lg">
            {meta.emoji}
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold',
              isSaving ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700',
            )}
          >
            {isSaving ? '▼' : '▲'} {stat.savingsPercent.toFixed(1)}%
          </span>
        </div>
        {/* 우상: 현 거래처 비용 + 큰 절감액 */}
        <div className="min-w-0 flex-1 text-right">
          <div className="text-[10px] text-gray-500 tabular-nums">
            현 거래처 <span className="text-gray-600">{formatCurrency(stat.ourCost)}</span>
          </div>
          <div
            className={cn(
              'mt-0.5 text-base font-bold tabular-nums',
              isSaving ? 'text-red-600' : 'text-red-600',
            )}
          >
            {isSaving ? '−' : '+'} {formatCurrency(Math.abs(stat.savings))}
          </div>
        </div>
      </div>

      {/* ─── 카테고리명 (좌측, 크게) ─── */}
      <div className="mt-2 text-base font-bold text-gray-900">{stat.category}</div>

      {/* ─── 주요 품목 list (좌측 정렬, 각 줄) ─── */}
      {topItems.length > 0 && (
        <div className="mt-1 space-y-0.5 text-[10px] text-gray-600">
          {topItems.map((it, i) => (
            <div key={i} className="truncate" title={it.name}>
              {shortName(it.name)} <span className="text-red-500">-₩{shortKRW(it.savings)}</span>
              {i === topItems.length - 1 && hasMore && (
                <span className="ml-1 text-gray-400">외...</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
