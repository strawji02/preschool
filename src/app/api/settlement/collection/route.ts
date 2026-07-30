import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  CollectionError,
  addPayout,
  addReceipt,
  deletePayout,
  deleteReceipt,
  loadCollection,
} from '@/features/settlement'

/**
 * [정산] 수금·지급 기록 (docs §9).
 *
 * 청구액·실지급액은 마감 스냅샷에서 오므로 여기서는 **입금·지급 기록만** 다룬다.
 * 금액을 두 곳에 두면 어긋난다.
 *
 * 마감된 달에만 기록할 수 있다 — 마감 전에는 청구액이 확정되지 않아 미수금을
 * 계산할 근거가 없다. 그 검사는 데이터 계층이 한다.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const actor = guard.user.email

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 형식이 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const req = (body ?? {}) as Record<string, unknown>
  const action = String(req.action ?? '')

  try {
    switch (action) {
      case 'add-receipt': {
        const source = String(req.source ?? '')
        if (source !== 'shinsegae' && source !== 'cj') {
          return NextResponse.json(
            { success: false, error: '원천 구분이 올바르지 않습니다.' },
            { status: 400 }
          )
        }
        await addReceipt({
          period: String(req.period ?? ''),
          source,
          businessCode: String(req.businessCode ?? ''),
          receivedDate: String(req.receivedDate ?? ''),
          amount: Number(req.amount),
          note: typeof req.note === 'string' ? req.note : null,
          actor,
        })
        break
      }

      case 'add-payout':
        await addPayout({
          period: String(req.period ?? ''),
          partnerId: String(req.partnerId ?? ''),
          paidDate: String(req.paidDate ?? ''),
          amount: Number(req.amount),
          note: typeof req.note === 'string' ? req.note : null,
          actor,
        })
        break

      case 'delete-receipt':
        await deleteReceipt(String(req.id ?? ''))
        break

      case 'delete-payout':
        await deletePayout(String(req.id ?? ''))
        break

      default:
        return NextResponse.json(
          { success: false, error: `알 수 없는 요청입니다: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    // CollectionError는 사용자에게 보여줄 수 있는 문장이다
    if (err instanceof CollectionError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    console.error('[settlement/collection]', err)
    return NextResponse.json(
      { success: false, error: '저장 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** `?period=YYYY-MM` 현황 조회 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const period = request.nextUrl.searchParams.get('period')
  if (!period) {
    return NextResponse.json(
      { success: false, error: '기간을 지정해 주세요.' },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json({ success: true, collection: await loadCollection(period) })
  } catch (err) {
    if (err instanceof CollectionError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    console.error('[settlement/collection GET]', err)
    return NextResponse.json(
      { success: false, error: '조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
