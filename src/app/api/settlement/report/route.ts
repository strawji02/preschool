import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  adjustmentAmount,
  buildAdjustmentSheet,
  type AdjustmentRecord,
  buildDeclarationSheet,
  buildDeductionSheet,
  buildSettlementSheet,
  buildSettlementWorkbook,
  isExcelUpload,
  isValidPeriod,
  loadClosingSnapshot,
  normalizeDeductionItems,
  readUploadedWorkbook,
  rebuildClosingBlocks,
  runSettlement,
  sumDeductionItems,
  type ClosingPartnerRow,
  type ClosingVenueRow,
  type DeclarationSplit,
  type DeductionItem,
} from '@/features/settlement'
import * as XLSX from 'xlsx'

/**
 * [정산] 영업자별 정산 내역서 다운로드 (docs §6-2).
 *
 * 미리보기와 **같은 `runSettlement`를 쓴다.** 두 경로가 다른 계산을 하면 화면에서
 * 본 숫자와 파일의 숫자가 어긋날 수 있다.
 *
 * 매핑 누락이 있으면 파일을 내주지 않는다 — 누락된 사업장의 금액이 조용히 빠진
 * 내역서는 틀린 문서이고, 그걸로 지급이 진행되면 되돌리기 어렵다 (docs §8).
 */
/**
 * 확정·마감된 달의 내역서를 **원천 파일 없이** 다시 받는다 (docs §8-2).
 *
 * 금액을 다시 계산하지 않는다 — 스냅샷에 저장된 확정값을 시트 모양으로 옮기기만
 * 한다. 수수료율이나 담당자가 바뀐 뒤에 다시 뽑아도 마감 당시와 같은 파일이
 * 나와야 한다.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!isValidPeriod(period)) {
    return NextResponse.json(
      { success: false, error: '기간을 YYYY-MM 형식으로 지정해 주세요.' },
      { status: 400 }
    )
  }

  try {
    const loaded = await loadClosingSnapshot(period)
    if (!loaded) {
      return NextResponse.json(
        { success: false, error: '확정되지 않은 달입니다. 정산 화면에서 먼저 확정해 주세요.' },
        { status: 404 }
      )
    }
    const snap = loaded.snapshot as {
      closingVenues?: ClosingVenueRow[]
      closingPartners?: ClosingPartnerRow[]
      deductionItems?: Record<string, DeductionItem[]>
      splits?: Record<string, DeclarationSplit[]>
      // 조정은 2026-07-31부터 굳힌다 (docs §18). 그 전 리비전에는 없다.
      adjustments?: AdjustmentRecord[]
      adjustmentAmounts?: Record<string, number>
    }
    if (!Array.isArray(snap.closingVenues) || !Array.isArray(snap.closingPartners)) {
      return NextResponse.json(
        {
          success: false,
          error: '이 달의 저장분에는 내역서 정보가 없습니다. 정산 화면에서 다시 확정해 주세요.',
        },
        { status: 409 }
      )
    }

    const partners = snap.closingPartners
    const itemsByPartner = snap.deductionItems ?? {}
    const splitsByPartner = snap.splits ?? {}

    const sheet = buildSettlementSheet(rebuildClosingBlocks(snap.closingVenues, partners))
    const deductionSheet = buildDeductionSheet(
      partners.map((p) => ({
        partnerName: p.partnerName,
        items: itemsByPartner[p.partnerId] ?? [],
      }))
    )
    const declarationSheet = buildDeclarationSheet({
      periodLabel: period,
      partners: partners.map((p) => ({
        partnerName: p.partnerName,
        declared: p.declared,
        splits: splitsByPartner[p.partnerId],
      })),
    })

    // 조정 내역은 **스냅샷에 굳혀 둔 것**을 그대로 쓴다 (docs §18).
    // 원천 파일 없이 재발행하는 경로라 금액을 다시 계산할 수 없다.
    const adjustmentSheet = buildAdjustmentSheet(
      snap.adjustments ?? [],
      snap.adjustmentAmounts ?? {}
    )

    const wb = buildSettlementWorkbook(sheet, {
      deductionSheet,
      declarationSheet,
      adjustmentSheet,
    })
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array

    return reportResponse(bytes, period)
  } catch (err) {
    console.error('[settlement/report GET]', err)
    return NextResponse.json(
      { success: false, error: '내역서 생성 중 오류가 발생했습니다.' },
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
  if (files.length === 0 || files.some((f) => !isExcelUpload(f))) {
    return NextResponse.json(
      { success: false, error: '엑셀 파일을 첨부해 주세요.' },
      { status: 400 }
    )
  }

  // 공제 상세(항목별)를 받는다. 합계가 곧 산식의 Q이므로 서버에서 다시 더한다 —
  // 클라이언트가 보낸 합계를 그대로 믿으면 화면과 파일의 Q가 어긋날 수 있다.
  const itemsByPartner = parseDeductionItems(form.get('deductionItems'))
  const deductions: Record<string, number> = {}
  for (const [partnerId, items] of Object.entries(itemsByPartner)) {
    deductions[partnerId] = sumDeductionItems(items)
  }
  const splitsByPartner = parseSplits(form.get('splits'))
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
    const deductionSheet = buildDeductionSheet(
      result.partners.map((p) => ({
        partnerName: p.partnerName,
        items: itemsByPartner[p.partnerId] ?? [],
      }))
    )
    // 사업소득 지급명세서 (docs §6-3). 본사는 정산 대상이 아니라 여기 들어오지 않는다.
    const declarationSheet = buildDeclarationSheet({
      periodLabel: periodLabel || '기간미지정',
      partners: result.partners.map((p) => ({
        partnerName: p.partnerName,
        declared: p.settlement.declared,
        splits: splitsByPartner[p.partnerId],
      })),
    })

    // 분할 합계가 신고액과 다르면 파일을 내주지 않는다. 틀린 신고 금액이 세무사에게
    // 넘어가면 되돌리기 어렵다 (docs §4 — 불일치 시 마감 차단).
    const blocking = declarationSheet.warnings.filter((w) => w.includes('마감할 수 없습니다'))
    if (blocking.length > 0) {
      return NextResponse.json(
        { success: false, error: blocking.join(' / ') },
        { status: 409 }
      )
    }

    // 조정 내역 — 영업자에게 지급액이 왜 줄었는지 설명하는 근거 (docs §18)
    const adjAmounts: Record<string, number> = {}
    for (const a of result.adjustments) {
      const src = result.statementItems.find(
        (i) =>
          i.businessName === a.businessName &&
          i.restaurantName === a.restaurantName &&
          i.date === a.itemDate &&
          i.productCode === a.productCode
      )
      if (src) adjAmounts[a.id] = adjustmentAmount(src, a.quantity).total
    }

    const wb = buildSettlementWorkbook(sheet, {
      deductionSheet,
      declarationSheet,
      adjustmentSheet: buildAdjustmentSheet(result.adjustments, adjAmounts),
    })
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
    return reportResponse(bytes, periodLabel || '기간미지정')
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

/**
 * 분할 신고 `{ "<partnerId>": [{ name, amount }, ...] }` 형태 (docs §4).
 *
 * 합계 검증은 `buildDeclarationSheet`가 하므로 여기서는 형태만 정리한다.
 * 성명이 빈 줄과 금액 0인 줄은 사용자가 추가만 하고 안 채운 것이라 버린다.
 */
function parseSplits(
  raw: FormDataEntryValue | null
): Record<string, DeclarationSplit[]> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, DeclarationSplit[]> = {}
    for (const [partnerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      const splits = value
        .map((v): DeclarationSplit | null => {
          if (!v || typeof v !== 'object') return null
          const row = v as Record<string, unknown>
          const name = typeof row.name === 'string' ? row.name.trim() : ''
          const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
          if (name === '' || !Number.isFinite(amount) || amount === 0) return null
          return { name, amount: Math.trunc(amount) }
        })
        .filter((s): s is DeclarationSplit => s !== null)
      if (splits.length > 0) out[partnerId] = splits
    }
    return out
  } catch {
    return {}
  }
}

/**
 * `{ "<partnerId>": [{ category, amount, note? }, ...] }` 형태.
 * 항목 정리는 `normalizeDeductionItems`가 맡는다 (금액 0·항목명 없는 줄 제거).
 */
function parseDeductionItems(
  raw: FormDataEntryValue | null
): Record<string, DeductionItem[]> {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, DeductionItem[]> = {}
    for (const [partnerId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const items = normalizeDeductionItems(value)
      if (items.length > 0) out[partnerId] = items
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 엑셀 응답 — POST(업로드)와 GET(스냅샷)이 **같은 파일명 규칙**을 써야 한다.
 * 두 경로에서 이름이 다르면 같은 달 파일이 두 종류로 돌아다닌다.
 */
function reportResponse(bytes: Uint8Array, periodLabel: string): NextResponse {
  const fileName = `정산내역서_${periodLabel}.xlsx`
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
