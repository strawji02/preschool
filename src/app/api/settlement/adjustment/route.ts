import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  AdjustmentError,
  createAdjustment,
  deleteAdjustment,
  listAdjustments,
  loadClosing,
} from '@/features/settlement'

/**
 * [정산] 품목 조정 — docs/systems/settlement/조정.md §18
 *
 * 저장하면 화면이 **자동으로 재분석**한다. 파일은 이미 브라우저에 있으므로
 * 다시 올릴 필요가 없다 (마스터 편집 §14-3과 같은 흐름).
 *
 * ⚠️ **마감된 달은 거부한다.** 마감은 "이 숫자로 세무·지급이 끝났다"는 선언이라
 * 조정으로 뒤늦게 금액을 바꾸면 안 된다. 고쳐야 하면 마감을 먼저 해제한다 (§8-1).
 */

const PERIOD = /^\d{4}-\d{2}$/

async function assertOpen(period: string): Promise<string | null> {
  const closing = await loadClosing(period)
  if (closing?.status === 'closed') {
    return `${period}은 마감된 달입니다. 조정하려면 먼저 마감을 해제해 주세요.`
  }
  return null
}

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!PERIOD.test(period)) {
    return NextResponse.json(
      { success: false, error: '정산월이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json({ success: true, adjustments: await listAdjustments(period) })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 형식이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const period = String(body.period ?? '')
  if (!PERIOD.test(period)) {
    return NextResponse.json(
      { success: false, error: '정산월이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const kind = String(body.kind ?? '')
  if (kind !== 'exclude' && kind !== 'move') {
    return NextResponse.json(
      { success: false, error: '조정 종류가 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const quantity = Number(body.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json(
      { success: false, error: '조정 수량을 확인해 주세요.' },
      { status: 400 }
    )
  }

  // 사유와 요청자는 **필수**다. 이게 없으면 나중에 아무도 설명하지 못한다.
  const reason = String(body.reason ?? '').trim()
  const requestedBy = String(body.requestedBy ?? '').trim()
  if (!reason || !requestedBy) {
    return NextResponse.json(
      { success: false, error: '사유와 요청자를 입력해 주세요.' },
      { status: 400 }
    )
  }

  const target = body.targetRestaurantName ? String(body.targetRestaurantName) : null
  if (kind === 'move' && !target) {
    return NextResponse.json(
      { success: false, error: '이동할 식당을 선택해 주세요.' },
      { status: 400 }
    )
  }

  try {
    const blocked = await assertOpen(period)
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 409 })

    const saved = await createAdjustment({
      period,
      kind,
      businessName: String(body.businessName ?? ''),
      restaurantName: String(body.restaurantName ?? ''),
      itemDate: String(body.itemDate ?? ''),
      productCode: String(body.productCode ?? ''),
      productName: String(body.productName ?? ''),
      unit: String(body.unit ?? ''),
      quantity,
      targetRestaurantName: kind === 'move' ? target : null,
      reason,
      requestedBy,
      createdBy: guard.user.email,
    })
    return NextResponse.json({ success: true, adjustment: saved })
  } catch (err) {
    const message =
      err instanceof AdjustmentError || err instanceof Error
        ? err.message
        : '저장 중 오류가 발생했습니다.'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const id = request.nextUrl.searchParams.get('id') ?? ''
  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!id || !PERIOD.test(period)) {
    return NextResponse.json(
      { success: false, error: '삭제 대상이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  try {
    const blocked = await assertOpen(period)
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 409 })

    await deleteAdjustment(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '삭제 실패' },
      { status: 500 }
    )
  }
}
