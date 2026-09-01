import { requireComparisonAccess } from '@/features/shared/auth'
import { ProposalHistoryDashboard } from './proposal-history-dashboard'

export const dynamic = 'force-dynamic'

export default async function ProposalHistoryPage() {
  await requireComparisonAccess('/calc-food/proposal-history')
  return <ProposalHistoryDashboard />
}
