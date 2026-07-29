import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  buildSettlementSheet,
  isExcelUpload,
  readUploadedWorkbook,
  runSettlement,
  writeSettlementXlsx,
} from '@/features/settlement'

/**
 * [정산] 영업자별 정산 내역서 다운로드 (docs §6-2).
 *
 * 미리보기와 **같은 `runSettlement`를 쓴다.** 두 경로가 다른 계산을 하면 화면에서
 * 본 숫자와 파일의 숫자가 어긋날 수 있다.
 *
 * 매핑 누락이 있으면 파일을 내주지 않는다 — 누락된 사업장의 금액이 조용히 빠진
 * 내역서는 틀린 문서이고, 그걸로 지급이 진행되면 되돌리기 어렵다 (docs §8).
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

  const deductions = parseDeductions(form.get('deductions'))
  const periodLabel = String(form.get('period') ?? '').trim()

  try {
    const workbooks = await Promise.all(files.map(readUploadedWorkbook))
    const result = await runSettlement({ workbooks, deductions })

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
          error: `담당 영업자가 지정되지 않은 사업장이 있어 내역서를 만들 수 없습니다: ${list}`,
        },
        { status: 409 }
      )
    }

    const sheet = buildSettlementSheet(result.blocks)
    const bytes = writeSettlementXlsx(sheet)
    const fileName = `정산내역서_${periodLabel || '기간미지정'}.xlsx`

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
  } catch (err) {
    console.error('[settlement/report]', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '내역서 생성 중 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}

/** `{ "<partnerId>": 624000 }` 형태. 숫자로 해석되지 않는 값은 무시한다. */
function parseDeductions(raw: FormDataEntryValue | null): Record<string, number> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}
