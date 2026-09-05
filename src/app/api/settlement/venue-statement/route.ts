import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  buildShinsegaeStatement,
  isExcelUpload,
  loadPriceLookup,
  loadSettlementMaster,
  NO_SOURCE_MESSAGE,
  resolveSources,
  runSettlement,
  writeShinsegaeStatementXlsx,
  writeManualItemStatementXlsx,
  writeCjVenueStatementXlsx,
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
  // 파일은 선택이다 — 없으면 보관된 원천을 쓴다 (docs §20)
  if (files.some((f) => !isExcelUpload(f))) {
    return NextResponse.json(
      { success: false, error: '엑셀 파일만 올릴 수 있습니다.' },
      { status: 400 }
    )
  }

  const period = String(form.get('period') ?? '')
  const businessCode = String(form.get('businessCode') ?? '')
  const sourceRaw = String(form.get('source') ?? '')
  if (sourceRaw !== 'cj' && sourceRaw !== 'shinsegae') {
    return NextResponse.json(
      { success: false, error: '공급사 구분이 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const source = sourceRaw
  if (!/^\d{4}-\d{2}$/.test(period) || !businessCode) {
    return NextResponse.json(
      { success: false, error: '정산월과 유치원을 지정해 주세요.' },
      { status: 400 }
    )
  }

  try {
    // 파일이 없으면 보관된 원천을 쓴다 (docs §20)
    const resolved = await resolveSources({ period, files })
    if (resolved.from === 'none') {
      return NextResponse.json({ success: false, error: NO_SOURCE_MESSAGE }, { status: 400 })
    }
    const result = await runSettlement({ workbooks: resolved.workbooks, period })

    // 기간이 어긋나면 여기서도 막는다 — 잘못된 달의 명세표를 유치원에 주면 안 된다
    if (result.errors.length > 0) {
      return NextResponse.json(
        { success: false, error: result.errors.join(' / ') },
        { status: 409 }
      )
    }

    const master = await loadSettlementMaster()
    const venue = master.venues.find(
      (v) => v.source === source && v.businessCode === businessCode
    )
    if (!venue) {
      return NextResponse.json(
        { success: false, error: '등록된 유치원 사업장코드를 찾지 못했습니다.' },
        { status: 404 }
      )
    }
    const shinsegaeItems = result.shinsegaeItems.filter((i) => i.businessCode === businessCode)
    const cjItems = result.statementItems.filter((i) => i.businessName === venue.businessName)
    const manualItems = result.manualItems.filter(
      (i) => i.status === 'approved' && i.burden === 'venue' && i.source === source && i.businessCode === businessCode
    )
    if ((source === 'cj' ? cjItems.length : shinsegaeItems.length) === 0 && manualItems.length === 0) {
      return NextResponse.json(
        { success: false, error: '이 유치원의 품목을 찾지 못했습니다.' },
        { status: 404 }
      )
    }

    if (source === 'cj') {
      if (result.cjStatementItemCount === null) {
        return NextResponse.json(
          { success: false, error: 'CJ 거래명세서를 함께 올려야 2시트 청구서류를 만들 수 있습니다.' },
          { status: 409 }
        )
      }
      if (cjItems.length === 0) {
        return NextResponse.json(
          { success: false, error: 'CJ 거래명세서에서 이 유치원의 품목을 찾지 못했습니다.' },
          { status: 404 }
        )
      }
      const bytes = await writeCjVenueStatementXlsx({
        period,
        businessName: venue.invoice.companyName ?? venue.businessName,
        items: cjItems,
        finalInvoiceRows: result.invoiceRows.filter((row) =>
          row.venueKeys?.includes(`cj:${businessCode}`)
        ),
      })
      const name = `청구서류_CJ_${venue.invoice.companyName ?? venue.businessName}_${period}.xlsx`
      return new NextResponse(bytes as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Cache-Control': 'no-store',
        },
      })
    }

    /*
      ★ **공급받는자는 유치원**이다. 마스터의 계산서 정보를 그대로 쓴다.
      공급자((주)신세계푸드)와 직인은 템플릿에 박혀 있어 여기서 넣지 않는다 (docs §19-2).
    */
    const inv = venue?.invoice
    if (!inv?.companyName || !inv.bizRegNo) {
      return NextResponse.json(
        {
          success: false,
          error: `${shinsegaeItems[0]?.businessName ?? manualItems[0]?.businessName ?? businessCode}: 상호·사업자등록번호가 없어 명세표를 만들 수 없습니다. 마스터를 채워 주세요.`,
        },
        { status: 409 }
      )
    }

    /*
      ⚠️ **조정(§18)은 싣지 않는다.** 조정은 CJ 거래명세서 품목에만 걸리므로
      신세계 유치원에는 생길 수 없다. 혹시 생기면 아래에서 걸러 알린다.
    */
    const stray = shinsegaeItems.length > 0
      ? result.adjustments.filter((a) => a.businessName === shinsegaeItems[0].businessName)
      : []
    if (stray.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `${shinsegaeItems[0].businessName}에 품목 조정 ${stray.length}건이 걸려 있습니다. 신세계 명세표는 조정을 담지 못하니 확인해 주세요.`,
        },
        { status: 409 }
      )
    }

    /*
      ★ **원산지는 신세계 월별 단가표에서 온다** (docs §21).
      기본은 정산월 단가표다. 다른 달을 쓰려면 `priceBookPeriod`로 넘긴다 —
      단가표가 늦게 오거나 과거 달을 재발행할 때 필요하다.
    */
    if (shinsegaeItems.length === 0) {
      const bytes = await writeManualItemStatementXlsx({
        businessName: inv.companyName,
        period,
        items: manualItems,
      })
      const name = `거래명세표_${inv.companyName}_${period}.xlsx`
      return new NextResponse(bytes as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      })
    }

    const priceBookPeriod = String(form.get('priceBookPeriod') ?? '') || period
    const originByCode = new Map<string, string>()
    for (const [code, v] of await loadPriceLookup(
      priceBookPeriod,
      shinsegaeItems.map((i) => i.productCode)
    )) {
      if (v.origin) originByCode.set(code, v.origin)
    }

    const statement = buildShinsegaeStatement({
      businessName: inv.companyName,
      period,
      buyer: {
        companyName: inv.companyName,
        bizRegNo: inv.bizRegNo,
        ceoName: inv.ceoName ?? '',
        address: inv.address ?? '',
      },
      items: shinsegaeItems,
      originByCode,
    })

    const bytes = await writeShinsegaeStatementXlsx(statement, manualItems)
    const name = `거래명세표_${inv.companyName}_${period}.xlsx`
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
