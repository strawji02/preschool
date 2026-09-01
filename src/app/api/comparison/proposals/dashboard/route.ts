import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/features/shared/auth/api-guard'
import { apiError } from '@/lib/api-error'
import {
  getProposalDashboard,
  type ProposalDashboardQuery,
} from '@/lib/comparison-proposal-history-server'
import type { ProposalDashboardChangeType } from '@/lib/comparison-proposal-history'

const CHANGE_TYPES = new Set<ProposalDashboardChangeType>([
  'all', 'new', 'reissue', 'both', 'statement_only', 'amount_only', 'neither',
])

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  if (!guard.user.canAccessComparison) {
    return NextResponse.json({ success: false, error: '비교 시스템 권한이 필요합니다.' }, { status: 403 })
  }

  const month = request.nextUrl.searchParams.get('month') ?? ''
  const rawChangeType = request.nextUrl.searchParams.get('change_type') ?? 'all'
  const changeType = CHANGE_TYPES.has(rawChangeType as ProposalDashboardChangeType)
    ? rawChangeType as ProposalDashboardChangeType
    : null
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !changeType) {
    return NextResponse.json({ success: false, error: '조회 월 또는 변경 유형이 올바르지 않습니다.' }, { status: 400 })
  }

  const query: ProposalDashboardQuery = {
    month,
    search: request.nextUrl.searchParams.get('search')?.slice(0, 100) ?? '',
    changeType,
    issuerId: request.nextUrl.searchParams.get('issuer_id')?.slice(0, 50) ?? '',
    page: Number(request.nextUrl.searchParams.get('page') ?? 1),
    pageSize: Number(request.nextUrl.searchParams.get('page_size') ?? 20),
  }
  try {
    const dashboard = await getProposalDashboard(query)
    return NextResponse.json({ success: true, dashboard })
  } catch (error) {
    return apiError(error, 500, 'comparison-proposal-dashboard')
  }
}
