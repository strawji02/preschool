import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  SourceArchiveError,
  checkSourcePeriod,
  detectSheetKind,
  toArchiveKind,
  isExcelUpload,
  listSourceFiles,
  loadActiveSources,
  parseCjSheet,
  parseCjStatementSheet,
  parseShinsegaeSheet,
  periodMismatchMessage,
  readWorkbookBytes,
  saveSourceFiles,
  type DetectedSheet,
  type SourceDateRange,
  type SourceKind,
} from '@/features/settlement'

/**
 * [정산] 원천 파일 보관 — docs/systems/settlement/원천보관.md §20
 *
 * 말일 09:00~14:00 다섯 시간 안에 **혼자** 끝내야 하는 일이다. 그 사이 조정
 * 요청이 몰려 들어오는데, 원천이 브라우저에만 있으면 창을 닫는 순간 처음부터다.
 * **한 번 올리면 그 달은 파일 없이 끝까지** 가도록 서버에 둔다.
 *
 * ⚠️ **기간이 어긋나면 저장하지 않는다.** 2026-07-31에 7월 자료가 6월로 확정된
 * 사고가 있었다. 잘못된 원천이 서버에 자리 잡으면 그 뒤 모든 작업이 오염되므로,
 * 들어오는 문턱에서 막는다 (§8-4).
 */

const PERIOD = /^\d{4}-\d{2}$/

/** 파일 하나에서 원천 시트를 찾아낸다. 통합 파일은 2종이 나온다. */
function detect(fileName: string, bytes: Uint8Array): DetectedSheet[] {
  const wb = readWorkbookBytes(fileName, bytes)
  const found: DetectedSheet[] = []

  for (const sheet of wb.sheets) {
    const kind = detectSheetKind(sheet.rows)
    if (!kind) continue
    // 같은 종류가 한 파일에 둘이면 첫 번째만 쓴다 (pickSourceSheets와 같은 규칙)
    if (found.some((f) => f.kind === kind)) continue

    let dateRange: SourceDateRange | null = null
    if (kind === 'shinsegae') dateRange = parseShinsegaeSheet(sheet.rows).dateRange
    else if (kind === 'cj') dateRange = parseCjSheet(sheet.rows).dateRange
    else dateRange = parseCjStatementSheet(sheet.rows).dateRange

    // ⚠️ 캐스트 금지 — 판별기는 카멜, DB는 스네이크다 (`toArchiveKind` 주석)
    found.push({ kind: toArchiveKind(kind), sheetName: sheet.name, dateRange })
  }
  return found
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

  const period = String(form.get('period') ?? '')
  if (!PERIOD.test(period)) {
    return NextResponse.json(
      { success: false, error: '정산월을 선택해 주세요.' },
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

  try {
    const prepared = await Promise.all(
      files.map(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer())
        return { fileName: f.name, bytes, sheets: detect(f.name, bytes) }
      })
    )

    const usable = prepared.filter((p) => p.sheets.length > 0)
    if (usable.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            '원천 시트를 찾지 못했습니다. 신세계 품목 시트, CJ 집계표, CJ 거래명세서 중 하나가 들어 있어야 합니다.',
        },
        { status: 400 }
      )
    }

    // ★ 저장 전에 기간을 본다. 잘못된 원천이 자리 잡으면 그 뒤가 전부 오염된다.
    const mismatches = checkSourcePeriod(
      period,
      usable.flatMap((p) =>
        p.sheets.map((s) => ({ label: `${p.fileName} (${s.sheetName})`, dateRange: s.dateRange }))
      )
    )
    if (mismatches.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: mismatches.map(periodMismatchMessage).join(' / '),
          periodMismatches: mismatches,
        },
        { status: 409 }
      )
    }

    const saved = await saveSourceFiles({
      period,
      uploadedBy: guard.user.email,
      files: usable,
    })

    return NextResponse.json({
      success: true,
      saved,
      active: await loadActiveSources(period),
    })
  } catch (err) {
    const message =
      err instanceof SourceArchiveError || err instanceof Error
        ? err.message
        : '보관 중 오류가 발생했습니다.'
    console.error('[settlement/source]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 그 달의 보관 상태. `history=1`이면 교체 이력까지. */
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
    const wantHistory = request.nextUrl.searchParams.get('history') === '1'
    return NextResponse.json({
      success: true,
      active: await loadActiveSources(period),
      history: wantHistory ? await listSourceFiles(period) : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 }
    )
  }
}
