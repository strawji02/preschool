import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  adjustmentAmount,
  buildVenueStatement,
  isExcelUpload,
  readUploadedWorkbook,
  runSettlement,
  writeVenueStatementXlsx,
} from '@/features/settlement'

/**
 * [정산] 유치원 제공 거래명세표 — docs/systems/settlement/조정.md §19
 *
 * 신세계 유치원 **한 곳** 분을 xlsx로 돌려준다. 유치원마다 따로 주는 문서라
 * 한 파일에 여러 곳을 담지 않는다 — 다른 유치원 단가가 섞이면 안 된다.
 *
 * ⚠️ 금액은 **가맹점(단가) 기준**이다. 우리 매입가(원가)는 담지 않는다.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { success: false, error: '업로드 형식이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.some((f) => !isExcelUpload(f))) {
    return NextResponse.json(
      { success: false, error: '엑셀 파일을 첨부해 주세요.' },
      { status: 400 }
    )
  }

  const period = String(form.get('period') ?? '')
  const businessCode = String(form.get('businessCode') ?? '')
  if (!/^\d{4}-\d{2}$/.test(period) || !businessCode) {
    return NextResponse.json(
      { success: false, error: '정산월과 유치원을 지정해 주세요.' },
      { status: 400 }
    )
  }

  try {
    const workbooks = await Promise.all(files.map(readUploadedWorkbook))
    const result = await runSettlement({ workbooks, period })

    // 기간이 어긋나면 여기서도 막는다 — 잘못된 달의 명세표를 유치원에 주면 안 된다
    if (result.errors.length > 0) {
      return NextResponse.json(
        { success: false, error: result.errors.join(' / ') },
        { status: 409 }
      )
    }

    const items = result.shinsegaeItems.filter((i) => i.businessCode === businessCode)
    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: '이 유치원의 품목을 찾지 못했습니다.' },
        { status: 404 }
      )
    }

    // 이 유치원에 걸린 조정만 싣는다. 다른 유치원 조정이 섞이면 안 된다.
    const mine = result.adjustments.filter((a) => a.businessName === items[0].businessName)
    const amounts: Record<string, number> = {}
    for (const a of mine) {
      const src = result.statementItems.find(
        (i) =>
          i.businessName === a.businessName &&
          i.restaurantName === a.restaurantName &&
          i.date === a.itemDate &&
          i.productCode === a.productCode
      )
      if (src) amounts[a.id] = adjustmentAmount(src, a.quantity).total
    }

    const statement = buildVenueStatement({
      businessName: items[0].businessName,
      period,
      issuer: {
        companyName: result.issuer?.companyName ?? '',
        bizRegNo: result.issuer?.bizRegNo ?? '',
        ceoName: result.issuer?.ceoName ?? '',
        address: result.issuer?.address ?? '',
      },
      items,
      adjustments: mine,
      adjustmentAmounts: amounts,
    })

    const bytes = writeVenueStatementXlsx(statement)
    const name = `거래명세표_${items[0].businessName}_${period}.xlsx`
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    })
  } catch (err) {
    console.error('[settlement/venue-statement]', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '생성 중 오류' },
      { status: 500 }
    )
  }
}
