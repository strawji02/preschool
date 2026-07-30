'use client'

import Link from 'next/link'
import { useState } from 'react'

/**
 * 급식 비교 시스템 은폐 카드 (2026-07-31).
 *
 * ⚠️ **이건 보안이 아니라 UX 장치다.** 3회 클릭은 "평소에 안 보이게" 하는 것일 뿐,
 * URL을 직접 쳐도 서버가 막아야 한다 — `/calc-food/layout.tsx`의
 * `requireComparisonAccess()`와 middleware의 API 가드가 실제 경계다.
 *
 * 이 컴포넌트는 **권한이 있는 사용자에게만** 렌더된다. 권한이 없으면 서버가
 * 아예 넘기지 않으므로 클릭해도 아무 일이 없다.
 */
export default function ComparisonReveal({ label }: { label: string }) {
  const [clicks, setClicks] = useState(0)
  const revealed = clicks >= 3

  return (
    <div className="mt-10 border-t border-gray-100 pt-6">
      <button
        type="button"
        onClick={() => setClicks((c) => c + 1)}
        className="text-xs text-gray-400 transition hover:text-gray-600"
        aria-label="계정"
      >
        {label}
      </button>

      {revealed && (
        <Link
          href="/calc-food"
          className="mt-3 block rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-gray-400 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900">급식 단가 비교</h2>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
              운영 중
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            거래명세서를 업로드해 품목별 단가를 표준 단가와 비교하고 절감 가능액을
            산출합니다.
          </p>
        </Link>
      )}
    </div>
  )
}
