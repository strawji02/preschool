import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  buildInvoiceSheets,
  isExcelUpload,
  monthEndIssueDate,
  readUploadedWorkbook,
  runSettlement,
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
    const workbooks = await Promise.all(files.map(readUploadedWorkbook))
    const result = await runSettlement({ workbooks })

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

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][]),
      // 홈택스 템플릿의 시트명을 그대로 쓴다
      'Sheet1'
    )
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array

    const label = `${year}년 ${month}월`
    const fileName =
      kind === 'taxable'
        ? `(세금)계산서 발행을 위한 엑셀 파일_${label}.xlsx`
        : `계산서 발행을 위한 엑셀 파일_${label}.xlsx`

    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
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
