import { requireUser } from '@/features/shared/auth'
import { listClosings } from '@/features/settlement'
import SettlementHeader from '../settlement-header'
import CollectionWorkspace from './collection-workspace'

/**
 * 수금·지급 관리 (docs §9).
 *
 * **마감된 달만** 다룬다. 청구액이 확정되지 않으면 미수금을 계산할 근거가 없다.
 */

export const dynamic = 'force-dynamic'

export default async function CollectionPage() {
  const user = await requireUser('/app/settlement/collection')
  const closings = await listClosings()
  const periods = closings.map((c) => c.period)

  return (
    <div>
      <SettlementHeader
        active="collection"
        title="수금·지급 관리"
        description={
          <>
            유치원 입금과 영업자 지급을 기록합니다. 청구액·실지급액은{' '}
            <strong className="font-medium text-gray-700">마감된 값</strong>을 그대로
            쓰므로 여기서 금액이 달라지지 않습니다.
          </>
        }
      />

      <CollectionWorkspace periods={periods} initialPeriod={periods[0] ?? null} isAdmin={user.role === 'admin'} />
    </div>
  )
}
