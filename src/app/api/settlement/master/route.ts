import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  MasterWriteError,
  assignVenue,
  excludeVenue,
  setVenueItemName,
  updateVenueInvoice,
  type VenueInvoiceInput,
} from '@/features/settlement'

/**
 * [정산] 마스터 편집 — 정산 화면 안에서 미해결 항목을 그 자리에서 고친다 (docs §14-3).
 *
 * 한 라우트에 `action`으로 나눈 이유: 세 동작이 **같은 흐름의 일부**다.
 * 담당자는 "이 사업장을 어떻게 처리할까"를 결정하고, 그 결과가 배정/제외/품목명이다.
 * 경로를 셋으로 쪼개면 화면 코드가 어느 것을 부를지 매번 분기해야 한다.
 *
 * 저장 후 화면은 **자동으로 재분석**한다 — 파일이 이미 브라우저에 있으므로
 * 사용자가 다시 올릴 필요가 없다.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 형식이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: '요청 본문이 비어 있습니다.' },
      { status: 400 }
    )
  }

  const req = body as Record<string, unknown>
  const action = String(req.action ?? '')
  const source = String(req.source ?? '')
  if (source !== 'shinsegae' && source !== 'cj') {
    return NextResponse.json(
      { success: false, error: '원천 구분이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  try {
    switch (action) {
      case 'assign-venue':
        await assignVenue({
          source,
          businessCode: String(req.businessCode ?? ''),
          businessName: String(req.businessName ?? ''),
          partnerId: typeof req.partnerId === 'string' ? req.partnerId : null,
          newPartnerName:
            typeof req.newPartnerName === 'string' ? req.newPartnerName : null,
          invoice:
            req.invoice && typeof req.invoice === 'object' ? readInvoice(req.invoice) : null,
        })
        break

      case 'update-invoice':
        await updateVenueInvoice({
          source,
          businessCode: String(req.businessCode ?? ''),
          invoice: readInvoice(req.invoice),
        })
        break

      case 'exclude-venue':
        await excludeVenue({
          source,
          businessCode: String(req.businessCode ?? ''),
          businessName: String(req.businessName ?? ''),
          reason: String(req.reason ?? ''),
        })
        break

      case 'set-item-name': {
        const taxKind = String(req.taxKind ?? '')
        if (taxKind !== 'taxable' && taxKind !== 'exempt') {
          return NextResponse.json(
            { success: false, error: '과세구분이 올바르지 않습니다.' },
            { status: 400 }
          )
        }
        await setVenueItemName({
          source,
          businessCode: String(req.businessCode ?? ''),
          restaurantCode: String(req.restaurantCode ?? ''),
          restaurantName: String(req.restaurantName ?? ''),
          taxKind,
          invoiceItemName: String(req.invoiceItemName ?? ''),
        })
        break
      }

      default:
        return NextResponse.json(
          { success: false, error: `알 수 없는 요청입니다: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    // MasterWriteError는 사용자에게 보여줄 수 있는 문장이다
    if (err instanceof MasterWriteError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    console.error('[settlement/master]', err)
    return NextResponse.json(
      { success: false, error: '저장 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** 계산서 정보 파싱. 값 검증은 `master-write`가 한다 (체크섬·필수항목). */
function readInvoice(raw: unknown): VenueInvoiceInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '')
  return {
    bizRegNo: str('bizRegNo'),
    companyName: str('companyName'),
    ceoName: str('ceoName'),
    address: str('address'),
    bizType: str('bizType'),
    bizItem: str('bizItem'),
    email: str('email'),
    email2: str('email2') === '' ? null : str('email2'),
  }
}
