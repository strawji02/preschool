import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  isExcelUpload,
  listPriceBooks,
  parsePriceBookSheet,
  PriceBookError,
  readUploadedWorkbook,
  savePriceBook,
} from '@/features/settlement'

/**
 * [정산] 신세계 월별 단가표 — docs/systems/settlement/단가표.md §21
 *
 * 신세계가 **매달 10일 전에** 보내는 품목 카탈로그다. 거래명세표의 **원산지**를
 * 여기서 가져온다 (우리 원천에는 원산지 열이 없다, §19).
 *
 * ⚠️ **파일에 연월이 없다.** 사용자가 고르고, 서버가 **직전 달 결정단가와
 * 대조해** 오선택을 막는다. 실측: 맞으면 100% 일치, 한 달 건너뛰면 88.8%.
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

  const period = String(form.get('period') ?? '')
  const force = String(form.get('force') ?? '') === '1'
  const file = form.getAll('files').find((f): f is File => f instanceof File)
  if (!file || !isExcelUpload(file)) {
    return NextResponse.json(
      { success: false, error: '단가표 엑셀 파일을 올려 주세요.' },
      { status: 400 }
    )
  }

  try {
    const wb = await readUploadedWorkbook(file)
    // 시트가 하나뿐인 파일이다 (`Sheet1`). 첫 시트를 쓴다.
    const sheet = wb.sheets[0]
    if (!sheet) {
      return NextResponse.json(
        { success: false, error: '단가표에서 시트를 찾지 못했습니다.' },
        { status: 400 }
      )
    }
    const parsed = parsePriceBookSheet(sheet.rows)
    const saved = await savePriceBook({
      period,
      items: parsed.items,
      actor: guard.user.email,
      force,
    })
    return NextResponse.json({
      success: true,
      period,
      saved: saved.saved,
      warnings: parsed.warnings,
      check: saved.check,
      books: await listPriceBooks(),
    })
  } catch (err) {
    if (err instanceof PriceBookError) {
      // 연월 오선택은 **되돌릴 수 있게** 알린다 — 강행하려면 force=1
      return NextResponse.json({ success: false, error: err.message }, { status: 409 })
    }
    console.error('[settlement/price-book]', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '단가표 저장 중 오류' },
      { status: 500 }
    )
  }
}

/** 보관된 단가표 목록 — 화면이 연월을 고를 수 있게 */
export async function GET() {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  try {
    return NextResponse.json({ success: true, books: await listPriceBooks() })
  } catch (err) {
    console.error('[settlement/price-book GET]', err)
    return NextResponse.json({ success: false, error: '단가표 조회 실패' }, { status: 500 })
  }
}
