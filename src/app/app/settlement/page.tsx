import Link from 'next/link'
import { requireUser } from '@/features/shared/auth'
import SettlementWorkspace from './settlement-workspace'

/** 세션에 따라 결과가 달라지므로 정적 렌더링 대상이 되면 안 된다 */
export const dynamic = 'force-dynamic'

export default async function SettlementPage() {
  await requireUser('/app/settlement')

  return (
    <div>
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/app" className="hover:text-gray-900">
          업무 시스템
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">급식 정산</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">급식 정산</h1>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            신세계·CJ 원천 파일을 올리면 영업자별 지급액을 계산합니다. 통합 파일 하나로
            올려도 되고, 두 파일로 나눠 올려도 됩니다 — 시트는 내용으로 자동 판별합니다.
          </p>
        </div>
        <Link
          href="/app/settlement/report"
          className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          경영 보고서
        </Link>
      </div>

      <SettlementWorkspace />
    </div>
  )
}
