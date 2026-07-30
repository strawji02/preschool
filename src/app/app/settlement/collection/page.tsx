import Link from 'next/link'
import { requireUser } from '@/features/shared/auth'
import { listClosings } from '@/features/settlement'
import CollectionWorkspace from './collection-workspace'

/**
 * 수금·지급 관리 (docs §9).
 *
 * **마감된 달만** 다룬다. 청구액이 확정되지 않으면 미수금을 계산할 근거가 없다.
 */

export const dynamic = 'force-dynamic'

export default async function CollectionPage() {
  await requireUser('/app/settlement/collection')
  const closings = await listClosings()
  const periods = closings.map((c) => c.period)

  return (
    <div>
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/app" className="hover:text-gray-900">
          업무 시스템
        </Link>
        <span className="mx-2">/</span>
        <Link href="/app/settlement" className="hover:text-gray-900">
          급식 정산
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">수금·지급</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">수금·지급 관리</h1>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            유치원 입금과 영업자 지급을 기록합니다. 청구액·실지급액은{' '}
            <strong>마감된 값</strong>을 그대로 쓰므로 여기서 금액이 달라지지 않습니다.
          </p>
        </div>
        <Link
          href="/app/settlement/report"
          className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          경영 보고서
        </Link>
      </div>

      <CollectionWorkspace periods={periods} initialPeriod={periods[0] ?? null} />
    </div>
  )
}
