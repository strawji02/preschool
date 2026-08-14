'use client'

/**
 * 신세계 단가 기준월 선택 — docs/systems/comparison.md §9
 *
 * ★ **왜 골라야 하나** — `products`의 단가는 5/9 이후 갱신되지 않았다. 8월 단가표와
 * 대조하니 **16.4%(1,235개)가 어긋났고**, 그 중 943개는 실제로 올랐다. 낡은 낮은
 * 단가가 남아 있으면 **절감액이 과대 계상**된다. 그래서 "언제 단가와 비교한
 * 것인가"를 세션마다 못 박는다.
 *
 * ★ **업로드 전에 고른다.** 매칭이 시작되면 후보 단가가 그때 값으로 저장되므로
 * 뒤에서 바꿔도 이미 계산된 절감액은 안 바뀐다.
 *
 * ⚠️ **"고르지 않음"을 남겨 둔다.** 지금까지의 세션 233개가 그렇게 만들어졌고,
 * 이미 제출한 제안서의 숫자가 나중에 바뀌면 안 된다.
 */

import { useEffect, useState } from 'react'
import { CalendarDays, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PriceBook {
  period: string
  itemCount: number
  originCount: number
  uploadedAt: string
}

/** `2026-08` → `26년 8월` */
export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split('-')
  if (!y || !m) return period
  return `${y.slice(2)}년 ${Number(m)}월`
}

export function PriceBookPeriodPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (period: string | null) => void
}) {
  const [books, setBooks] = useState<PriceBook[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/price-books')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.success && Array.isArray(data.books)) {
          const list = data.books as PriceBook[]
          setBooks(list)
          /*
            가장 최근 달을 기본으로 고른다. 사용자가 매번 고르는 걸 잊으면
            낡은 단가로 비교하게 되고, 그게 바로 고치려는 문제다.
          */
          if (value === null && list.length > 0) onChange(list[0].period)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
    // 최초 1회만 — value를 넣으면 사용자가 고른 값을 되돌린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed) {
    return (
      <div className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle size={16} className="shrink-0" />
        <span>
          단가표 목록을 불러오지 못했습니다. <b>지금까지처럼</b> 신세계 DB 단가로 비교합니다.
        </span>
      </div>
    )
  }

  if (books === null) {
    return (
      <div className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" />
        단가표 확인 중…
      </div>
    )
  }

  if (books.length === 0) {
    return (
      <div className="mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        <CalendarDays size={16} className="shrink-0" />
        <span>
          올라온 신세계 단가표가 없습니다. <b>신세계 DB 단가</b>로 비교합니다.
        </span>
      </div>
    )
  }

  return (
    <div className="mx-auto mb-4 max-w-3xl rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <CalendarDays size={16} className="text-gray-400" />
          신세계 단가 기준월
        </div>

        <div className="flex flex-wrap gap-1.5">
          {books.map((b) => (
            <button
              key={b.period}
              type="button"
              onClick={() => onChange(b.period)}
              title={`품목 ${b.itemCount.toLocaleString()}개`}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                value === b.period
                  ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {formatPeriodLabel(b.period)}
            </button>
          ))}

          {/* ⚠️ 지금까지의 세션 233개가 이 방식이다 — 지우면 옛 결과를 재현할 수 없다 */}
          <button
            type="button"
            onClick={() => onChange(null)}
            title="products 테이블의 단가 — 2026-05-09 이후 갱신되지 않았습니다"
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              value === null
                ? 'border-gray-500 bg-gray-100 font-medium text-gray-700'
                : 'border-gray-300 text-gray-500 hover:bg-gray-50'
            )}
          >
            지금까지처럼
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {value === null ? (
          <>
            <b className="text-amber-700">신세계 DB 단가</b>로 비교합니다 — 2026-05-09 이후 갱신되지
            않아 절감액이 실제보다 크게 나올 수 있습니다.
          </>
        ) : (
          <>
            거래명세표를 올리기 <b>전에</b> 고르세요. 매칭이 끝난 뒤 바꿔도 이미 계산된 절감액은
            바뀌지 않습니다.
          </>
        )}
      </p>
    </div>
  )
}
