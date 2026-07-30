import { requireComparisonAccess } from '@/features/shared/auth'

/**
 * 급식 비교 시스템 접근 가드 (2026-07-31).
 *
 * ⚠️ **이 화면은 2026-07-30까지 로그인 없이 열려 있었다.** 거래처 단가가 담긴
 * 원천 데이터를 다루므로 화이트리스트 안에서도 지정한 사람만 볼 수 있게 좁혔다
 * (migration 056).
 *
 * 페이지가 클라이언트 컴포넌트라 가드를 여기 layout에 둔다 — 서버에서 먼저
 * 판단해야 권한 없는 사용자에게 화면이 잠깐이라도 보이지 않는다.
 *
 * 런처의 3클릭 은폐는 UX 장치일 뿐이다. URL을 직접 쳐도 **여기서** 막힌다.
 */
export const dynamic = 'force-dynamic'

export default async function CalcFoodLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireComparisonAccess('/calc-food')
  return <>{children}</>
}
