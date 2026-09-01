import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/features/shared/auth/api-guard'
import { apiError } from '@/lib/api-error'
import { getMonthlyProposalVersions } from '@/lib/comparison-proposal-history-server'
import { buildMonthlyProposalReport } from '@/lib/comparison-proposal-report'

function currentKstMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  if (!guard.user.canAccessComparison) {
    return NextResponse.json({ success: false, error: '비교 시스템 권한이 필요합니다.' }, { status: 403 })
  }
  try {
    const month = request.nextUrl.searchParams.get('month') ?? currentKstMonth()
    const rows = await getMonthlyProposalVersions(month)
    const buffer = await buildMonthlyProposalReport(month, rows as unknown[])
    const filename = encodeURIComponent(`비교_제안서_발행변경_보고서_${month}.xlsx`)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('YYYY-MM')) {
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }
    return apiError(error, 500, 'comparison-proposal-monthly-report')
  }
}
