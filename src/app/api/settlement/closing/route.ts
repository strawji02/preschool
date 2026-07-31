import { NextResponse, type NextRequest } from 'next/server'
import { requireApiAdmin, requireApiUser } from '@/features/shared/auth'
import {
  ClosingError,
  buildDeclarationLines,
  isExcelUpload,
  isValidPeriod,
  listClosings,
  loadClosing,
  loadClosingRevisions,
  normalizeDeductionItems,
  readUploadedWorkbook,
  reopenClosing,
  runSettlement,
  saveClosing,
  sumDeductionItems,
  type DeclarationSplit,
} from '@/features/settlement'

/**
 * [정산] 월 마감 (docs §8, §14-1).
 *
 * ★ 마감의 목적은 **과거 정산을 고정**하는 것이다. 지난달 내역서를 다시 뽑았을 때
 * 담당자나 금액이 달라지면 지급 근거와 세무 문서가 흔들린다.
 *
 * 그래서 저장 시점에 그 달의 전체 상태를 스냅샷으로 굳히고, 재저장은
 * **새 리비전을 쌓는다** — 덮어쓰지 않는다.
 */

/**
 * ⚠️ **확정·마감 모두 4개 게이트를 서버에서 다시 검사한다.**
 *
 * 화면이 이미 막고 있지만, 깨진 상태를 스냅샷으로 굳히면 나중에 그게 "확정된 사실"이
 * 되어버린다. 클라이언트를 믿지 않는다 (docs §14-2·§14-7).
 */
function gateErrors(
  result: Awaited<ReturnType<typeof runSettlement>>,
  splitProblems: string[]
): string[] {
  const out: string[] = []
  if (result.errors.length > 0) out.push(...result.errors)
  if (result.unmapped.length > 0) {
    const list = result.unmapped
      .map((v) => `${v.source}:${v.businessCode}(${v.businessName})`)
      .join(', ')
    out.push(`담당 영업자가 지정되지 않은 사업장이 있습니다: ${list}`)
  }
  out.push(...result.invoiceProblems)
  out.push(...splitProblems)
  return out
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const actor = guard.user.email

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
  if (!isValidPeriod(period)) {
    return NextResponse.json(
      { success: false, error: '마감 기간을 YYYY-MM 형식으로 선택해 주세요.' },
      { status: 400 }
    )
  }

  // `confirm`(확정) / `close`(마감). 마감된 달이면 데이터 계층이 거부한다 (docs §8).
  const actionRaw = String(form.get('action') ?? '')
  if (actionRaw !== 'confirm' && actionRaw !== 'close') {
    return NextResponse.json(
      { success: false, error: '마감 동작이 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const action = actionRaw

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.some((f) => !isExcelUpload(f))) {
    return NextResponse.json(
      { success: false, error: '엑셀 파일을 첨부해 주세요.' },
      { status: 400 }
    )
  }

  const itemsByPartner = parseRecord(form.get('deductionItems'), normalizeDeductionItems)
  const deductions: Record<string, number> = {}
  for (const [id, items] of Object.entries(itemsByPartner)) {
    deductions[id] = sumDeductionItems(items)
  }
  const splitsByPartner = parseRecord(form.get('splits'), normalizeSplits)
  const reason = String(form.get('reason') ?? '').trim() || null

  try {
    const workbooks = await Promise.all(files.map(readUploadedWorkbook))
    // ★ 정산월을 넘긴다 — 원천 파일의 날짜가 이 달과 다르면 확정·마감이 막힌다 (docs §8-4).
    const result = await runSettlement({ workbooks, deductions, period })

    // 분할 신고는 지급명세서 쪽 산식이 검증한다 — 같은 함수를 쓴다
    const declaration = buildDeclarationLines(
      result.partners.map((p) => ({
        partnerName: p.partnerName,
        declared: p.settlement.declared,
        splits: splitsByPartner[p.partnerId],
      }))
    )
    const splitProblems = declaration.warnings.filter((w) => w.includes('마감할 수 없습니다'))

    const blocked = gateErrors(result, splitProblems)
    if (blocked.length > 0) {
      return NextResponse.json(
        { success: false, error: blocked.join(' / '), problems: blocked },
        { status: 409 }
      )
    }

    // 스냅샷에는 **재현에 필요한 것을 전부** 담는다. 정규화하지 않는 이유는
    // 스키마가 바뀌어도 과거 리비전을 그대로 읽어야 하기 때문이다.
    const snapshot = {
      version: 1,
      period,
      savedAt: new Date().toISOString(),
      sources: result.sources,
      partners: result.partners,
      excluded: result.excluded,
      warnings: result.warnings,
      deductionItems: itemsByPartner,
      splits: splitsByPartner,
      declarationLines: declaration.lines,
      invoiceRows: result.invoiceRows,
      issuer: result.issuer,
      closingVenues: result.closingVenues,
      closingPartners: result.closingPartners,
    }

    const saved = await saveClosing({
      period,
      action,
      venues: result.closingVenues,
      partners: result.closingPartners,
      snapshot,
      actor,
      reason,
    })

    return NextResponse.json({ success: true, closing: saved })
  } catch (err) {
    if (err instanceof ClosingError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    console.error('[settlement/closing]', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '마감 저장 중 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}

/**
 * 마감 해제 — **admin 전용** (docs §8).
 *
 * 마감은 "이 숫자로 세무·지급이 끝났다"는 선언이라 저장으로는 못 바꾼다.
 * 고쳐야 할 때는 이 경로로 열고, **사유가 이력에 남는다.**
 *
 * 별도 메서드(PATCH)로 둔 이유: 저장(POST)과 성격이 다르다. 실수로 섞이면
 * 안 되는 동작이라 경로 자체를 분리한다.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireApiAdmin()
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
  const req = (body ?? {}) as Record<string, unknown>

  try {
    const closing = await reopenClosing({
      period: String(req.period ?? ''),
      actor: guard.user.email,
      reason: String(req.reason ?? ''),
    })
    return NextResponse.json({ success: true, closing })
  } catch (err) {
    if (err instanceof ClosingError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 })
    }
    console.error('[settlement/closing PATCH]', err)
    return NextResponse.json(
      { success: false, error: '마감 해제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** 마감 상태 조회. `period`가 있으면 그 달 + 이력, 없으면 월별 목록 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const period = request.nextUrl.searchParams.get('period')
  try {
    if (!period) {
      return NextResponse.json({ success: true, closings: await listClosings() })
    }
    const [closing, revisions] = await Promise.all([
      loadClosing(period),
      loadClosingRevisions(period),
    ])
    return NextResponse.json({ success: true, closing, revisions })
  } catch (err) {
    console.error('[settlement/closing GET]', err)
    return NextResponse.json(
      { success: false, error: '마감 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/** `{ "<partnerId>": [...] }` 형태를 항목별 정규화 함수로 정리한다 */
function parseRecord<T>(
  raw: FormDataEntryValue | null,
  normalize: (value: unknown) => T[]
): Record<string, T[]> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, T[]> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const items = normalize(value)
      if (items.length > 0) out[id] = items
    }
    return out
  } catch {
    return {}
  }
}

/** 분할 신고 정리 — 성명이 비었거나 금액 0인 줄은 사용자가 추가만 하고 안 채운 것이다 */
function normalizeSplits(value: unknown): DeclarationSplit[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v): DeclarationSplit | null => {
      if (!v || typeof v !== 'object') return null
      const row = v as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
      if (name === '' || !Number.isFinite(amount) || amount === 0) return null
      return { name, amount: Math.trunc(amount) }
    })
    .filter((s): s is DeclarationSplit => s !== null)
}
