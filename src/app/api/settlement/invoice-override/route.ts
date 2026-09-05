import { NextResponse, type NextRequest } from 'next/server'
import { requireApiAdmin, requireApiUser } from '@/features/shared/auth'
import {
  InvoiceOverrideError,
  approveInvoiceOverride,
  cancelInvoiceOverride,
  createInvoiceOverride,
  isValidPeriod,
  listInvoiceOverrides,
} from '@/features/settlement'

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!isValidPeriod(period)) {
    return NextResponse.json({ success: false, error: '정산월이 올바르지 않습니다.' }, { status: 400 })
  }
  try {
    return NextResponse.json({ success: true, overrides: await listInvoiceOverrides(period) })
  } catch (error) {
    return handle(error)
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const action = String(body.action ?? '')
  const guard = action === 'create' ? await requireApiUser() : await requireApiAdmin()
  if ('response' in guard) return guard.response

  try {
    if (action === 'create') {
      const period = String(body.period ?? '')
      const taxKind = String(body.taxKind ?? '')
      if (!isValidPeriod(period) || (taxKind !== 'taxable' && taxKind !== 'exempt')) {
        return NextResponse.json({ success: false, error: '정산월 또는 과세구분이 올바르지 않습니다.' }, { status: 400 })
      }
      const override = await createInvoiceOverride({
        period,
        taxKind,
        itemName: String(body.itemName ?? ''),
        originalSupply: Number(body.originalSupply),
        originalVat: Number(body.originalVat),
        finalSupply: Number(body.finalSupply),
        finalVat: Number(body.finalVat),
        reason: String(body.reason ?? ''),
        actor: guard.user.email,
      })
      return NextResponse.json({ success: true, override })
    }
    if (action === 'approve') {
      await approveInvoiceOverride(String(body.id ?? ''), guard.user.email)
    } else if (action === 'cancel') {
      await cancelInvoiceOverride(
        String(body.id ?? ''),
        guard.user.email,
        String(body.reason ?? '')
      )
    } else {
      return NextResponse.json({ success: false, error: '알 수 없는 요청입니다.' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return handle(error)
  }
}

function handle(error: unknown): NextResponse {
  if (error instanceof InvoiceOverrideError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }
  console.error('[settlement/invoice-override]', error)
  return NextResponse.json({ success: false, error: '원단위 조정 처리 중 오류가 발생했습니다.' }, { status: 500 })
}
