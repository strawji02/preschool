import { NextResponse, type NextRequest } from 'next/server'
import { requireApiAdmin, requireApiUser } from '@/features/shared/auth'
import {
  SupplierPayableError,
  addSupplierAdjustment,
  addSupplierPayment,
  approveSupplierAdjustment,
  cancelSupplierEntry,
  loadSupplierPayable,
} from '@/features/settlement'

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  try {
    const period = request.nextUrl.searchParams.get('period') ?? ''
    return NextResponse.json({ success: true, payable: await loadSupplierPayable(period) })
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
  const adminActions = ['approve-adjustment', 'cancel-payment', 'cancel-adjustment']
  const guard = adminActions.includes(action) ? await requireApiAdmin() : await requireApiUser()
  if ('response' in guard) return guard.response
  const source = String(body.source ?? '')
  if (['add-payment', 'add-adjustment'].includes(action) && source !== 'cj' && source !== 'shinsegae') {
    return NextResponse.json({ success: false, error: '공급사 구분이 올바르지 않습니다.' }, { status: 400 })
  }
  try {
    if (action === 'add-payment') {
      await addSupplierPayment({
        period: String(body.period ?? ''),
        source: source as 'cj' | 'shinsegae',
        paidDate: String(body.paidDate ?? ''),
        amount: Number(body.amount),
        note: typeof body.note === 'string' ? body.note : null,
        actor: guard.user.email,
      })
    } else if (action === 'add-adjustment') {
      await addSupplierAdjustment({
        period: String(body.period ?? ''),
        source: source as 'cj' | 'shinsegae',
        amount: Number(body.amount),
        reason: String(body.reason ?? ''),
        actor: guard.user.email,
      })
    } else if (action === 'approve-adjustment') {
      await approveSupplierAdjustment(String(body.id ?? ''), guard.user.email)
    } else if (action === 'cancel-payment' || action === 'cancel-adjustment') {
      await cancelSupplierEntry({
        kind: action === 'cancel-payment' ? 'payment' : 'adjustment',
        id: String(body.id ?? ''),
        actor: guard.user.email,
        reason: String(body.reason ?? ''),
      })
    } else {
      return NextResponse.json({ success: false, error: '알 수 없는 요청입니다.' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return handle(error)
  }
}

function handle(error: unknown): NextResponse {
  if (error instanceof SupplierPayableError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }
  console.error('[settlement/supplier-payable]', error)
  return NextResponse.json({ success: false, error: '공급자 대금 처리 중 오류가 발생했습니다.' }, { status: 500 })
}
