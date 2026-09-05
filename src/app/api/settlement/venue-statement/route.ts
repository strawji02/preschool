import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  buildShinsegaeStatement,
  createZipArchive,
  isExcelUpload,
  loadPriceLookup,
  loadClosingSnapshot,
  loadSettlementMaster,
  NO_SOURCE_MESSAGE,
  resolveSources,
  runSettlement,
  uniqueVenueStatementTargets,
  venueStatementArchiveName,
  venueStatementEntryName,
  writeShinsegaeStatementXlsx,
  writeManualItemStatementXlsx,
  writeCjVenueStatementXlsx,
  type InvoiceRow,
  type ManualItemRecord,
  type SettlementMaster,
  type SettlementRunResult,
  type VenueStatementTarget,
} from '@/features/settlement'

type FrozenVenue = {
  source?: string
  businessCode?: string
  businessName?: string
  companyName?: string | null
  isExcluded?: boolean
  price?: { total?: number }
}

type FrozenClosing = NonNullable<Awaited<ReturnType<typeof loadClosingSnapshot>>>

interface GeneratedFile {
  name: string
  bytes: Uint8Array
}

class VenueStatementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * [정산] 유치원 제공 거래명세표 — docs/systems/settlement/조정.md §19
 *
 * 기본은 유치원 한 곳의 XLSX, `all=true`이면 대상 전체를 각자 독립 XLSX로 만든 뒤
 * ZIP 하나로 돌려준다. 개별 생성과 ZIP 생성은 같은 검증·서식을 사용한다.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return failure('업로드 형식이 올바르지 않습니다.', 400)
  }

  const files = form.getAll('files').filter((file): file is File => file instanceof File)
  if (files.some((file) => !isExcelUpload(file))) {
    return failure('엑셀 파일만 올릴 수 있습니다.', 400)
  }

  const period = String(form.get('period') ?? '')
  const all = String(form.get('all') ?? '') === 'true'
  const sourceRaw = String(form.get('source') ?? '')
  const businessCode = String(form.get('businessCode') ?? '')
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return failure('정산월을 지정해 주세요.', 400)
  }
  if (!all && (sourceRaw !== 'cj' && sourceRaw !== 'shinsegae')) {
    return failure('공급사 구분이 올바르지 않습니다.', 400)
  }
  if (!all && !businessCode) {
    return failure('유치원을 지정해 주세요.', 400)
  }

  const closingRevisionRaw = String(form.get('closingRevision') ?? '')
  const closingRevision = closingRevisionRaw ? Number(closingRevisionRaw) : null
  if (closingRevision !== null && !Number.isSafeInteger(closingRevision)) {
    return failure('마감 리비전을 확인해 주세요.', 400)
  }

  try {
    const resolved = await resolveSources({ period, files })
    if (resolved.from === 'none') return failure(NO_SOURCE_MESSAGE, 400)

    const result = await runSettlement({ workbooks: resolved.workbooks, period })
    if (result.errors.length > 0) {
      return failure(result.errors.join(' / '), 409)
    }

    const frozen = closingRevision === null ? null : await loadClosingSnapshot(period)
    if (closingRevision !== null &&
      (!frozen || frozen.closing.revision !== closingRevision)) {
      return failure('선택한 마감 리비전을 찾지 못했습니다. 보고서를 새로고침해 주세요.', 409)
    }

    const master = await loadSettlementMaster()
    const frozenVenues = (frozen?.snapshot.closingVenues ?? []) as FrozenVenue[]
    const currentTargets = uniqueVenueStatementTargets(result.statementVenues)
    const currentByKey = new Map<string, VenueStatementTarget>(
      currentTargets.map((target) => [`${target.source}:${target.businessCode}`, target] as const)
    )

    const targets = all
      ? frozen
        ? uniqueVenueStatementTargets(
            frozenVenues.flatMap((venue) => {
              if (venue.isExcluded || (venue.source !== 'cj' && venue.source !== 'shinsegae')) {
                return []
              }
              const key = `${venue.source}:${venue.businessCode ?? ''}`
              const current = currentByKey.get(key)
              if (!current) return []
              return [{
                source: venue.source,
                businessCode: current.businessCode,
                businessName: venue.companyName ?? venue.businessName ?? current.businessName,
              }]
            })
          )
        : currentTargets
      : [{
          source: sourceRaw as VenueStatementTarget['source'],
          businessCode,
          businessName: currentByKey.get(`${sourceRaw}:${businessCode}`)?.businessName ?? businessCode,
        }]

    if (targets.length === 0) {
      return failure('다운로드할 유치원 거래명세표가 없습니다.', 404)
    }

    const priceBookPeriod = String(form.get('priceBookPeriod') ?? '') || period
    const shinsegaeCodes = new Set(
      targets.filter((target) => target.source === 'shinsegae').map((target) => target.businessCode)
    )
    const originByCode = new Map<string, string>()
    if (shinsegaeCodes.size > 0) {
      const productCodes = result.shinsegaeItems
        .filter((item) => shinsegaeCodes.has(item.businessCode))
        .map((item) => item.productCode)
      for (const [code, value] of await loadPriceLookup(priceBookPeriod, productCodes)) {
        if (value.origin) originByCode.set(code, value.origin)
      }
    }

    const generated = await Promise.all(
      targets.map((target) => generateVenueStatement({
        period,
        target,
        result,
        frozen,
        frozenVenues,
        master,
        originByCode,
      }))
    )

    if (!all) return fileResponse(generated[0].bytes, generated[0].name, 'xlsx')

    const zip = createZipArchive(generated.map((file, index) => ({
      name: venueStatementEntryName(period, targets[index]),
      bytes: file.bytes,
    })))
    return fileResponse(zip, venueStatementArchiveName(period), 'zip')
  } catch (error) {
    if (error instanceof VenueStatementError) return failure(error.message, error.status)
    console.error('[settlement/venue-statement]', error)
    return failure(error instanceof Error ? error.message : '거래명세표 생성 중 오류', 500)
  }
}

async function generateVenueStatement(input: {
  period: string
  target: VenueStatementTarget
  result: SettlementRunResult
  frozen: FrozenClosing | null
  frozenVenues: FrozenVenue[]
  master: SettlementMaster
  originByCode: ReadonlyMap<string, string>
}): Promise<GeneratedFile> {
  const { period, target, result, frozen, frozenVenues, master, originByCode } = input
  const { source, businessCode } = target

  if (frozen) {
    const frozenTotal = frozenVenues
      .filter((item) => item.source === source && item.businessCode === businessCode)
      .reduce((sum, item) => sum + Number(item.price?.total ?? 0), 0)
    const currentTotal = result.closingVenues
      .filter((item) => item.source === source && item.businessCode === businessCode)
      .reduce((sum, item) => sum + item.price.total, 0)
    if (frozenTotal !== currentTotal) {
      throw new VenueStatementError(
        `${target.businessName}: 마감 당시 청구액(${frozenTotal.toLocaleString()}원)과 보관 원천(${currentTotal.toLocaleString()}원)이 달라 거래명세표 생성을 중단했습니다.`,
        409
      )
    }
  }

  const venue = master.venues.find(
    (candidate) => candidate.source === source && candidate.businessCode === businessCode
  )
  if (!venue) {
    throw new VenueStatementError(
      `${target.businessName}: 등록된 유치원 사업장코드를 찾지 못했습니다.`,
      404
    )
  }

  const frozenVenue = frozenVenues.find(
    (item) => item.source === source && item.businessCode === businessCode
  )
  const sourceBusinessName = frozenVenue?.businessName ?? venue.businessName
  const shinsegaeItems = result.shinsegaeItems.filter((item) => item.businessCode === businessCode)
  const cjItems = result.statementItems.filter((item) => item.businessName === sourceBusinessName)
  const allManualItems = frozen
    ? (frozen.snapshot.manualItems ?? []) as ManualItemRecord[]
    : result.manualItems
  const manualItems = allManualItems.filter(
    (item) => item.status === 'approved' && item.burden === 'venue' &&
      item.source === source && item.businessCode === businessCode
  )
  const frozenInvoiceRows = frozen
    ? (frozen.snapshot.invoiceRows ?? []) as InvoiceRow[]
    : result.invoiceRows

  if ((source === 'cj' ? cjItems.length : shinsegaeItems.length) === 0 && manualItems.length === 0) {
    throw new VenueStatementError(`${target.businessName}: 거래명세표 품목을 찾지 못했습니다.`, 404)
  }

  if (source === 'cj') {
    if (result.cjStatementItemCount === null) {
      throw new VenueStatementError(
        'CJ 거래명세서를 함께 올려야 2시트 청구서류를 만들 수 있습니다.',
        409
      )
    }
    if (cjItems.length === 0) {
      throw new VenueStatementError(
        `${target.businessName}: CJ 거래명세서에서 품목을 찾지 못했습니다.`,
        404
      )
    }
    const blockedOverride = !frozen && (
      result.invoiceOverrides.some(
        (override) => override.businessCode === businessCode && override.status === 'draft'
      ) || result.invoiceProblems.some(
        (problem) => problem.includes('원본 금액이 변경') ||
          problem.includes('원단위 조정이 승인 대기')
      )
    )
    if (blockedOverride) {
      throw new VenueStatementError(
        'CJ 1016 원단위 조정을 확인·저장한 뒤 청구서류를 만들어 주세요.',
        409
      )
    }
    const businessName = frozenVenue?.companyName ??
      venue.invoice.companyName ?? sourceBusinessName
    const bytes = await writeCjVenueStatementXlsx({
      period,
      businessName,
      items: cjItems,
      finalInvoiceRows: frozenInvoiceRows.filter((row) =>
        row.venueKeys?.includes(`cj:${businessCode}`)
      ),
    })
    return { name: `청구서류_CJ_${businessName}_${period}.xlsx`, bytes }
  }

  const frozenBuyer = frozenInvoiceRows.find((row) =>
    row.venueKeys?.includes(`${source}:${businessCode}`)
  )?.buyer
  const invoice = frozenBuyer ?? venue.invoice
  if (!invoice?.companyName || !invoice.bizRegNo) {
    throw new VenueStatementError(
      `${shinsegaeItems[0]?.businessName ?? manualItems[0]?.businessName ?? businessCode}: 상호·사업자등록번호가 없어 명세표를 만들 수 없습니다. 마스터를 채워 주세요.`,
      409
    )
  }

  const stray = shinsegaeItems.length > 0
    ? result.adjustments.filter((adjustment) =>
        adjustment.businessName === shinsegaeItems[0].businessName
      )
    : []
  if (stray.length > 0) {
    throw new VenueStatementError(
      `${shinsegaeItems[0].businessName}에 품목 조정 ${stray.length}건이 걸려 있습니다. 신세계 명세표는 조정을 담지 못하니 확인해 주세요.`,
      409
    )
  }

  if (shinsegaeItems.length === 0) {
    const bytes = await writeManualItemStatementXlsx({
      businessName: invoice.companyName,
      period,
      items: manualItems,
    })
    return { name: `거래명세표_${invoice.companyName}_${period}.xlsx`, bytes }
  }

  const statement = buildShinsegaeStatement({
    businessName: invoice.companyName,
    period,
    buyer: {
      companyName: invoice.companyName,
      bizRegNo: invoice.bizRegNo,
      ceoName: invoice.ceoName ?? '',
      address: invoice.address ?? '',
    },
    items: shinsegaeItems,
    originByCode,
  })
  const bytes = await writeShinsegaeStatementXlsx(statement, manualItems)
  return { name: `거래명세표_${invoice.companyName}_${period}.xlsx`, bytes }
}

function fileResponse(bytes: Uint8Array, name: string, kind: 'xlsx' | 'zip'): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': kind === 'zip'
        ? 'application/zip'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}

function failure(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status })
}
