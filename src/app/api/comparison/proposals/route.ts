import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/features/shared/auth/api-guard'
import { apiError, isValidUuid } from '@/lib/api-error'
import {
  getProposalHistory,
  normalizeAmountSnapshot,
  recordProposalVersion,
  type ProposalIssueFormat,
} from '@/lib/comparison-proposal-history-server'

async function requireComparisonApiUser() {
  const guard = await requireApiUser()
  if ('response' in guard) return guard
  if (!guard.user.canAccessComparison) {
    return {
      response: NextResponse.json({ success: false, error: '비교 시스템 권한이 필요합니다.' }, { status: 403 }),
    }
  }
  return guard
}

export async function GET(request: NextRequest) {
  const guard = await requireComparisonApiUser()
  if ('response' in guard) return guard.response
  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!isValidUuid(sessionId)) {
    return NextResponse.json({ success: false, error: '올바른 session_id가 필요합니다.' }, { status: 400 })
  }
  try {
    return NextResponse.json({ success: true, versions: await getProposalHistory(sessionId) })
  } catch (error) {
    return apiError(error, 500, 'comparison-proposal-history-get')
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireComparisonApiUser()
  if ('response' in guard) return guard.response
  try {
    const body = await request.json()
    const sessionId = String(body.session_id ?? '')
    const issueFormat = String(body.issue_format ?? '') as ProposalIssueFormat
    const idempotencyKey = String(body.idempotency_key ?? '')
    if (!isValidUuid(sessionId) || !['pptx', 'pdf_print'].includes(issueFormat)) {
      return NextResponse.json({ success: false, error: '세션과 발행 형식을 확인해주세요.' }, { status: 400 })
    }
    const result = await recordProposalVersion({
      sessionId,
      kindergartenName: String(body.kindergarten_name ?? ''),
      targetPeriod: String(body.target_period ?? ''),
      issueFormat,
      idempotencyKey,
      amountSnapshot: normalizeAmountSnapshot(body.amount_snapshot),
      changeReasons: Array.isArray(body.change_reasons)
        ? body.change_reasons.map((value: unknown) => String(value))
        : [],
      issuedBy: guard.user.id,
    })
    return NextResponse.json({ success: true, version: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('필요') || message.includes('올바르') || message.includes('지원하지')) {
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }
    return apiError(error, 500, 'comparison-proposal-history-post')
  }
}
