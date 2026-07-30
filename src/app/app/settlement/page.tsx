import { requireUser } from '@/features/shared/auth'
import SettlementHeader from './settlement-header'
import SettlementWorkspace from './settlement-workspace'

/** 세션에 따라 결과가 달라지므로 정적 렌더링 대상이 되면 안 된다 */
export const dynamic = 'force-dynamic'

export default async function SettlementPage() {
  // 마감 해제는 admin만 할 수 있다 (docs §8). 화면에서도 버튼을 감춘다 —
  // 실제 경계는 API의 `requireApiAdmin()`이다.
  const user = await requireUser('/app/settlement')

  return (
    <div>
      <SettlementHeader
        active="settlement"
        title="급식 정산"
        description={
          <>
            신세계·CJ 원천 파일을 올리면 영업자별 지급액을 계산합니다. 통합 파일 하나로
            올려도 되고, 두 파일로 나눠 올려도 됩니다 — 시트는 내용으로 자동
            판별합니다.
          </>
        }
      />

      <SettlementWorkspace isAdmin={user.role === 'admin'} />
    </div>
  )
}
