import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  buildInvoiceSheets,
  isExcelUpload,
  isValidPeriod,
  loadClosingSnapshot,
  monthEndIssueDate,
  NO_SOURCE_MESSAGE,
  resolveSources,
  runSettlement,
  type InvoiceParty,
  type InvoiceRow,
  type InvoiceSheet,
  type InvoiceTaxKind,
} from '@/features/settlement'
import * as XLSX from 'xlsx'

/**
 * [정산] 홈택스 일괄발행 엑셀 다운로드 (docs §6-1).
 *
 * 과세(세금계산서)와 면세(계산서)는 **양식이 다른 별개 파일**이라 한 번에 하나만
 * 내려준다 (`kind`). 홈택스에도 따로 올린다.
 *
 * 계산서를 만들 수 없는 항목이 있으면 파일을 내주지 않는다 — 일부만 빠진 계산서를
 * 발행하면 매출 누락이 되고, 이미 발행한 뒤에는 수정발행 절차를 밟아야 한다.
 */
/**
 * 확정·마감된 달의 계산서를 **원천 파일 없이** 다시 받는다 (docs §8-2).
 *
 * 업로드 화면에만 다운로드가 있어서, 브라우저를 닫으면 계산서를 받을 수 없었다.
 * 세무사가 며칠 뒤 다시 요청하면 엑셀을 찾아 올려야 했고, 그사이 마스터가
 * 바뀌었으면 **다른 파일이 나온다.**
 *
 * 스냅샷의 `invoiceRows`를 그대로 쓴다 — 다시 계산하지 않는다. 마감 당시
 * 홈택스에 올린 것과 같은 파일이 나와야 한다.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const sp = request.nextUrl.searchParams
  const period = sp.get('period') ?? ''
  const kindRaw = sp.get('kind') ?? ''

  if (!isValidPeriod(period)) {
    return NextResponse.json(
      { success: false, error: '기간을 YYYY-MM 형식으로 지정해 주세요.' },
      { status: 400 }
    )
  }
  if (kindRaw !== 'taxable' && kindRaw !== 'exempt') {
    return NextResponse.json(
      { success: false, error: '계산서 종류가 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const kind: InvoiceTaxKind = kindRaw

  try {
    const loaded = await loadClosingSnapshot(period)
    if (!loaded) {
      return NextResponse.json(
        { success: false, error: '확정되지 않은 달입니다. 정산 화면에서 먼저 확정해 주세요.' },
        { status: 404 }
      )
    }
    const snap = loaded.snapshot as {
      invoiceRows?: InvoiceRow[]
      issuer?: InvoiceParty | null
    }
    if (!snap.issuer || !Array.isArray(snap.invoiceRows)) {
      return NextResponse.json(
        {
          success: false,
          error:
            '이 달의 저장분에는 계산서 정보가 없습니다. 정산 화면에서 다시 확정해 주세요.',
        },
        { status: 409 }
      )
    }

    // 작성일자는 마감한 달의 말일이다 — 업로드 시점과 무관하게 늘 같아야 한다
    const [y, m] = period.split('-').map(Number)
    const { issueDate, day } = monthEndIssueDate(y, m)
    const sheets = buildInvoiceSheets({
      issueDate,
      day,
      issuer: snap.issuer,
      rows: snap.invoiceRows,
    })
    const sheet = sheets[kind]

    if (sheet.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            kind === 'taxable'
              ? '과세 매출이 없어 세금계산서를 만들 수 없습니다.'
              : '면세 매출이 없어 계산서를 만들 수 없습니다.',
        },
        { status: 409 }
      )
    }

    return invoiceResponse(sheet, kind, period)
  } catch (err) {
    console.error('[settlement/invoice GET]', err)
    return NextResponse.json(
      { success: false, error: '계산서 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

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

  const kindRaw = String(form.get('kind') ?? '')
  if (kindRaw !== 'taxable' && kindRaw !== 'exempt') {
    return NextResponse.json(
      { success: false, error: '계산서 종류가 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const kind: InvoiceTaxKind = kindRaw

  // 작성일자는 월말일이다. `YYYY-MM`으로 받아 애매함을 없앤다.
  const issueMonth = String(form.get('issueMonth') ?? '')
  const parsed = /^(\d{4})-(\d{2})$/.exec(issueMonth)
  if (!parsed) {
    return NextResponse.json(
      { success: false, error: '작성 연월을 YYYY-MM 형식으로 선택해 주세요.' },
      { status: 400 }
    )
  }
  const year = Number(parsed[1])
  const month = Number(parsed[2])
  if (month < 1 || month > 12) {
    return NextResponse.json(
      { success: false, error: '작성 월이 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  try {
    // 계산서 작성 연월이 곧 정산월이다 (docs §8-5)
    const resolved = await resolveSources({ period: issueMonth, files })
    if (resolved.from === 'none') {
      return NextResponse.json({ success: false, error: NO_SOURCE_MESSAGE }, { status: 400 })
    }
    const result = await runSettlement({ workbooks: resolved.workbooks, period: issueMonth })

    if (result.errors.length > 0) {
      return NextResponse.json(
        { success: false, error: result.errors.join(' / ') },
        { status: 400 }
      )
    }
    if (result.unmapped.length > 0) {
      const list = result.unmapped
        .map((v) => `${v.source}:${v.businessCode}(${v.businessName})`)
        .join(', ')
      return NextResponse.json(
        {
          success: false,
          error: `담당 영업자가 지정되지 않은 사업장이 있어 계산서를 만들 수 없습니다: ${list}`,
        },
        { status: 409 }
      )
    }
    if (result.invoiceProblems.length > 0 || !result.issuer) {
      return NextResponse.json(
        { success: false, error: result.invoiceProblems.join(' / ') },
        { status: 409 }
      )
    }

    const { issueDate, day } = monthEndIssueDate(year, month)
    const sheets = buildInvoiceSheets({
      issueDate,
      day,
      issuer: result.issuer,
      rows: result.invoiceRows,
    })
    const sheet = sheets[kind]

    if (sheet.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            kind === 'taxable'
              ? '과세 매출이 없어 세금계산서를 만들 수 없습니다.'
              : '면세 매출이 없어 계산서를 만들 수 없습니다.',
        },
        { status: 409 }
      )
    }

    return invoiceResponse(sheet, kind, `${year}-${String(month).padStart(2, '0')}`)
  } catch (err) {
    console.error('[settlement/invoice]', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '계산서 생성 중 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}

/**
 * 엑셀 응답 — POST(업로드)와 GET(스냅샷)이 **같은 파일명 규칙**을 써야 한다.
 * 두 경로에서 이름이 다르면 같은 달 파일이 두 종류로 돌아다닌다.
 */
function invoiceResponse(
  sheet: InvoiceSheet,
  kind: InvoiceTaxKind,
  period: string
): NextResponse {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][]),
    // 홈택스 템플릿의 시트명을 그대로 쓴다
    'Sheet1'
  )
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array

  const [y, m] = period.split('-')
  const label = `${y}년 ${Number(m)}월`
  const fileName =
    kind === 'taxable'
      ? `(세금)계산서 발행을 위한 엑셀 파일_${label}.xlsx`
      : `계산서 발행을 위한 엑셀 파일_${label}.xlsx`

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 한글 파일명은 filename*(RFC 5987)로 줘야 브라우저가 제대로 받는다
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}
