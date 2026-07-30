import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  isExcelUpload,
  readUploadedWorkbook,
  runSettlement,
} from '@/features/settlement'

/**
 * [정산] 원천 파일 분석 — 화면 미리보기용.
 *
 * 엑셀을 만들지 않고 숫자와 검증 결과만 돌려준다. 사업자공제(Q)는 여기서 받지 않는다.
 * 클라이언트가 `calcSettlement`로 실시간 재계산하므로 공제액을 바꿀 때마다 서버를
 * 왕복할 필요가 없다. 다운로드 시점에만 서버가 다시 계산한다.
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
  if (files.length === 0) {
    return NextResponse.json(
      { success: false, error: '엑셀 파일을 첨부해 주세요.' },
      { status: 400 }
    )
  }

  const rejected = files.filter((f) => !isExcelUpload(f))
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `엑셀 파일만 올릴 수 있습니다: ${rejected.map((f) => f.name).join(', ')}`,
      },
      { status: 400 }
    )
  }

  try {
    const workbooks = await Promise.all(files.map(readUploadedWorkbook))
    const result = await runSettlement({ workbooks })

    // blocks·invoiceRows·issuer는 응답에서 뺀다 — 식당/계산서 단위 원본이라 무겁고
    // (계산서는 매달 88장 규모), 화면에는 장수·합계만 쓴다.
    const { blocks: _blocks, invoiceRows, issuer: _issuer, ...summary } = result

    const invoiceSummary = {
      taxableCount: invoiceRows.filter((r) => r.taxKind === 'taxable').length,
      exemptCount: invoiceRows.filter((r) => r.taxKind === 'exempt').length,
      taxableSupply: sum(invoiceRows, 'taxable', (r) => r.supply),
      taxableVat: sum(invoiceRows, 'taxable', (r) => r.vat),
      exemptSupply: sum(invoiceRows, 'exempt', (r) => r.supply),
      /** 여러 식당이 한 장으로 합쳐진 계산서 수 (docs §6-1 해밀 사례) */
      mergedCount: invoiceRows.filter((r) => r.mergedFrom > 1).length,
      /** 원단위 절사 (docs §6-2). 장수와 금액을 함께 보여줘야 확인이 된다 */
      roundedCount: invoiceRows.filter((r) => r.roundingDiff > 0).length,
      roundingTotal: result.invoiceRoundingTotal,
    }

    return NextResponse.json({ success: true, ...summary, invoiceSummary })
  } catch (err) {
    console.error('[settlement/analyze]', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}

/** 과세구분별 합계 — 화면 요약용 */
function sum<T extends { taxKind: string }>(
  rows: readonly T[],
  kind: string,
  pick: (row: T) => number
): number {
  return rows.reduce((acc, r) => (r.taxKind === kind ? acc + pick(r) : acc), 0)
}
