import type { ClosingPartnerRow, ClosingVenueRow } from '../calc/closing'
import { calcSettlement, type PartnerType, type SettlementResult } from '../calc/settlement-formula'
import {
  loadSettlementMaster,
  missingInvoiceFields,
  venueItemKey,
  type SettlementMaster,
} from '../data/master'
import { aggregateByPartner } from '../parse/aggregate'
import { parseCjSheet } from '../parse/cj'
import { parseShinsegaeSheet, type ShinsegaeItem } from '../parse/shinsegae'
import type { NormalizedVenue } from '../parse/types'
import {
  collectInvoiceRows,
  type InvoiceParty,
  type InvoiceRow,
  type InvoiceTaxKind,
  type InvoiceVenueLine,
  type PendingBuyer,
  type PendingItemName,
} from '../report/invoice-sheet'
import { venueDisplayName, type ReportPartnerBlock } from '../report/settlement-sheet'
import { parseCjStatementSheet, type CjStatementResult } from '../parse/cj-statement'
import { applyAdjustments, sumAdjustments } from '../calc/adjustment'
import { suggestInvoiceItemName, venueItemNameOptions } from '../calc/item-name-suggestion'
import { listAdjustments, type AdjustmentRecord } from '../data/adjustment'
import { applyManualItems, type ManualItemRecord, type ManualNormalizedVenue } from '../calc/manual-item'
import { listManualItems } from '../data/manual-item'
import type { DeductionItem } from '../calc/deduction'
import {
  crossCheckCjStatement,
  cjCrossCheckMessage,
  type CjCrossCheckIssue,
} from '../calc/cj-cross-check'
import {
  checkSourcePeriod,
  periodMismatchMessage,
  type PeriodMismatch,
  type SourceDateRange,
} from '../calc/period-guard'
import { pickSourceSheets, type UploadedWorkbook } from './pick-sheets'
import {
  applyInvoiceOverrides,
  applyInvoiceOverrideDeltaToClosingVenues,
  type InvoiceOverride,
} from '../calc/invoice-policy'
import { listInvoiceOverrides } from '../data/invoice-override'

/**
 * 업로드된 원천 파일 → 영업자별 정산 결과까지 한 번에 처리한다.
 *
 * `/api/settlement/analyze`(미리보기)와 `/api/settlement/report`(엑셀 다운로드)가
 * 같은 함수를 쓴다. 두 경로가 다른 계산을 하면 화면에서 본 숫자와 다운로드한
 * 파일의 숫자가 달라질 수 있으므로 반드시 한 곳에 둔다.
 */

export interface SettlementRunRequest {
  workbooks: UploadedWorkbook[]
  /**
   * 정산월 `YYYY-MM`. 주면 **원천 파일의 날짜와 대조**한다 (docs §8-4).
   *
   * 안 주면 검사하지 않는다 — 파일을 먼저 올리고 월을 고르는 순서도 가능해서다.
   * 다만 확정·마감 경로에서는 반드시 준다. 그때는 월이 이미 정해져 있다.
   */
  period?: string
  /**
   * 영업자 id → 사업자공제(Q). 매월 수기 입력이라 요청마다 받는다 (docs §3).
   * 빠진 영업자는 0으로 본다.
   */
  deductions?: Record<string, number>
}

export interface PartnerSummary {
  partnerId: string
  partnerName: string
  partnerType: PartnerType
  /** 담당 사업장×식당 수 */
  venueCount: number
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
  /** 외부 사입 중 파트너 부담 서비스가 자동으로 더한 사업자공제 */
  manualDeduction: number
  /** 품목별 적립금 미적용을 반영한 실제 적립금 공급가 기준 */
  platformFeeBaseSupply: number
  settlement: SettlementResult
}

export interface ExcludedSummary {
  businessName: string
  costTotal: number
  priceTotal: number
}

export interface UnmappedSummary {
  source: string
  businessCode: string
  businessName: string
  costTotal: number
}

export interface SourceSummary {
  fileName: string
  sheetName: string
  venueCount: number
  /** 파일이 담고 있는 기간. 날짜 열이 없는 원천(CJ 집계표)은 null */
  dateRange: SourceDateRange | null
}

export interface SettlementRunResult {
  partners: PartnerSummary[]
  excluded: ExcludedSummary[]
  /** 담당 영업자를 못 찾은 사업장. 하나라도 있으면 마감할 수 없다 (docs §8). */
  unmapped: UnmappedSummary[]
  sources: { shinsegae: SourceSummary | null; cj: SourceSummary | null }
  /** 진행은 됐지만 사람이 확인해야 하는 사항 */
  warnings: string[]
  /** 처리를 진행할 수 없는 사유. 비어 있지 않으면 결과를 신뢰하면 안 된다. */
  errors: string[]
  /**
   * 정산월과 어긋난 원천. 비어 있어야 정상이며, 있으면 `errors`에도 들어간다.
   * 화면이 "몇 월 파일인지"를 구체적으로 보여줄 수 있도록 구조를 따로 남긴다.
   */
  periodMismatches: PeriodMismatch[]
  /**
   * 거래명세서 ↔ 집계표 대조 결과. 비어 있어야 정상이며, 있으면 `errors`에도 들어간다.
   * 거래명세서를 안 올렸으면 대조 자체를 안 하므로 빈 배열이다 (경고는 따로 나간다).
   */
  cjCrossCheck: CjCrossCheckIssue[]
  /** 거래명세서 품목 수. 없으면 null — 올렸는지 여부를 화면이 구분해야 한다. */
  cjStatementItemCount: number | null
  /** 이 달에 적용된 품목 조정 (docs §18). 화면 목록과 내역서가 이걸 쓴다. */
  adjustments: AdjustmentRecord[]
  /** 조정으로 줄어든 청구액 합계. 이동은 사업장 합계를 바꾸지 않아 세지 않는다. */
  adjustmentTotal: number
  /** 외부 사입 전체. 작성중·취소도 화면과 감사용으로 돌려준다. */
  manualItems: ManualItemRecord[]
  /** 파트너 부담 서비스가 Q에 더한 상세. 사용자 수기 공제와 구분해 보여준다. */
  manualDeductionItems: Record<string, DeductionItem[]>
  /**
   * 조정에 쓸 수 있는 원천 품목. 화면에서 **골라서** 조정하므로 필요하다.
   * 거래명세서가 없으면 빈 배열 — 그때는 조정을 추가할 수 없다.
   */
  statementItems: CjStatementResult['items']
  /**
   * 신세계 품목 행 — 유치원 제공 거래명세표(docs §19)가 쓴다.
   * CJ는 집계표만 받으므로 품목이 없다 (거래명세서는 별도로 `statementItems`).
   */
  shinsegaeItems: ShinsegaeItem[]
  /** 거래명세표를 만들 수 있는 신세계 유치원 목록 (본사·제외 사업장 뺀 것) */
  statementVenues: {
    source: 'shinsegae' | 'cj'
    businessCode: string
    businessName: string
    itemCount: number
  }[]
  /** 내역서 생성 입력 — 정산 제외 블록이 맨 앞에 온다 (원본과 동일 순서) */
  blocks: ReportPartnerBlock[]
  /**
   * 마감 가능 여부 — **매핑** 기준이다 (누락·오류 없음).
   * 계산서 발행 가능 여부는 `canIssueInvoices`를 따로 본다.
   */
  canClose: boolean

  /** 홈택스 계산서 (docs §6-1). 작성일자와 무관하므로 날짜는 출력 시점에 붙인다. */
  invoiceRows: InvoiceRow[]
  /**
   * 계산서 원단위 절사로 깎인 금액의 총합 (docs §6-2).
   *
   * 정산(영업자 지급)은 **원값**을 쓰므로 이만큼이 본사 몫에서 빠진다.
   * 영업자에게 줄 돈은 그대로 두고 회사가 흡수하는 구조다.
   */
  invoiceRoundingTotal: number
  /** CJ 1016 원단위 조정 원장. 마감 스냅샷에 근거와 함께 보존한다. */
  invoiceOverrides: InvoiceOverride[]
  /** 화면에서 조정할 수 있는 CJ 1016 계산서 원본 행. */
  invoiceOverrideCandidates: InvoiceRow[]
  /**
   * 계산서를 만들 수 없는 항목 — 유치원 사업자 정보 미비, 식당 품목명 미지정.
   * 마감 차단 사유다 (docs §14-2). 정산 제외와 금액 0은 포함하지 않는다.
   */
  invoiceProblems: string[]
  /** 계산서 공급자(본사). 미설정이면 계산서를 만들 수 없다 */
  issuer: InvoiceParty | null
  canIssueInvoices: boolean
  /**
   * 화면에서 **그 자리에서 고칠 수 있게** 구조화한 미해결 항목 (docs §14-3).
   * `invoiceProblems`와 같은 내용이지만 기계가 읽을 수 있는 형태다.
   */
  pending: {
    buyers: PendingBuyer[]
    itemNames: PendingItemNameResolution[]
  }
  /**
   * **활성 영업자 전체.** `partners`는 이번 달 데이터가 있는 영업자만 담으므로
   * 신규 사업장에 담당자를 배정할 때 쓸 수 없다 (담당 유치원이 아직 없는 영업자가 빠진다).
   */
  allPartners: { partnerId: string; partnerName: string }[]

  /**
   * 마감 스냅샷에 굳힐 식당 단위 확정값 (docs §14-1).
   * 영업자 이름을 함께 담는다 — 나중에 이름이 바뀌어도 마감 문서는 그대로여야 한다.
   */
  closingVenues: ClosingVenueRow[]
  /** 마감 스냅샷에 굳힐 영업자 단위 산식 결과 */
  closingPartners: ClosingPartnerRow[]
}

/** 미매칭 행에 원본 추천값과 해당 유치원 전용 후보를 붙인 화면 계약. */
export interface PendingItemNameResolution extends PendingItemName {
  suggestedItemName: string
  itemNameOptions: string[]
}

export async function runSettlement(
  req: SettlementRunRequest
): Promise<SettlementRunResult> {
  const picked = pickSourceSheets(req.workbooks)
  const warnings = [...picked.warnings]
  const errors = [...picked.errors]

  if (!picked.shinsegae || !picked.cj) {
    return emptyResult({ warnings, errors })
  }

  const ss = parseShinsegaeSheet(picked.shinsegae.rows)
  const cj = parseCjSheet(picked.cj.rows)
  warnings.push(...ss.warnings, ...cj.warnings)

  // CJ 거래명세서 — 있으면 파싱한다. 없어도 진행한다 (docs §5-2).
  let statement: CjStatementResult | null = null
  if (picked.cjStatement) {
    statement = parseCjStatementSheet(picked.cjStatement.rows)
    warnings.push(...statement.warnings)
  }

  // ★ 정산월 대조는 **매핑·산식보다 먼저** 본다 (docs §8-4).
  // 달이 틀리면 그 뒤의 숫자는 전부 의미가 없다. 그래서 경고가 아니라 errors다.
  //
  // CJ 집계표에는 날짜가 없다. 거래명세서를 함께 받으면서 **CJ도 기간 검증이 걸린다** —
  // 집계표가 다른 달이면 아래 교차검증이 금액 차이로 잡는다.
  const periodMismatches = checkSourcePeriod(req.period ?? '', [
    { label: `신세계 (${picked.shinsegae.sheetName})`, dateRange: ss.dateRange },
    { label: `CJ 집계표 (${picked.cj.sheetName})`, dateRange: cj.dateRange },
    ...(picked.cjStatement
      ? [
          {
            label: `CJ 거래명세서 (${picked.cjStatement.sheetName})`,
            dateRange: statement?.dateRange ?? null,
          },
        ]
      : []),
  ])
  errors.push(...periodMismatches.map(periodMismatchMessage))

  // ★ 거래명세서 ↔ 집계표 대조 (docs §5-2). 두 파일을 CJ가 각각 만들어 주므로,
  // 맞으면 양쪽 다 신뢰할 수 있고 어긋나면 한쪽이 틀린 것이다.
  const cjCrossCheck = crossCheckCjStatement(statement?.venues ?? null, cj.venues)
  errors.push(...cjCrossCheck.map(cjCrossCheckMessage))

  // 원본 `집계표_정산용`이 CJ를 먼저 나열하므로 같은 순서로 맞춘다
  const rawVenues: NormalizedVenue[] = [...cj.venues, ...ss.venues]

  // ★ 품목 조정 (docs §18). **교차검증 뒤, 매핑 앞**이 자리다.
  //
  // 원천끼리의 대조(§5-2)는 조정 **전** 숫자로 해야 한다 — 원천은 사실이고
  // 조정은 우리 정책이라, 섞으면 "CJ가 틀린 것"과 "우리가 뺀 것"을 구분할 수 없다.
  // 유치원 제공 거래명세표용 품목 (docs §19).
  // ⚠️ **정산 제외 사업장(본사 등)은 뺀다** — 유치원에 줄 문서가 아니다.
  const shinsegaeItems = (ss.items ?? []) as ShinsegaeItem[]

  const adjustments = req.period ? await listAdjustments(req.period) : []
  const master = await loadSettlementMaster()
  const applied = applyAdjustments(rawVenues, statement?.items ?? [], adjustments)
  errors.push(...applied.errors)

  // 외부 사입은 원천 대조·품목 조정 뒤에만 얹는다. 원천 교차검증에 섞으면
  // CJ/신세계 오류와 우리 수기 입력을 구분할 수 없다.
  const manualItems = req.period ? await listManualItems(req.period) : []
  const manual = applyManualItems(applied.venues, manualItems, master.mapping)
  errors.push(...manual.errors)
  const venues = manual.financialVenues
  const settlementVenues = manual.settlementVenues

  const agg = aggregateByPartner(settlementVenues, master.mapping)
  warnings.push(...agg.warnings)

  const deductions = req.deductions ?? {}
  const manualDeductionItems: Record<string, DeductionItem[]> = {}
  for (const item of manual.applied) {
    if (item.burden !== 'partner') continue
    const partnerId = master.mapping[`${item.source}:${item.businessCode}`]
    if (!partnerId) continue
    const amount = item.charge.total > 0 ? item.charge.total : item.purchase.total
    ;(manualDeductionItems[partnerId] ??= []).push({
      category: `외부 사입 · ${item.productName}`,
      amount,
      note: item.reason,
    })
  }

  const partners: PartnerSummary[] = agg.partners.map((p) => {
    const record = master.partners.get(p.partnerId)
    if (!record) {
      // 매핑은 있는데 영업자 레코드가 없다 = 마스터 데이터 불정합
      warnings.push(
        `영업자 정보를 찾을 수 없습니다 (id: ${p.partnerId}). 마스터 데이터를 확인하세요.`
      )
    }
    const manualDeduction = manual.partnerDeductions[p.partnerId] ?? 0
    const platformFeeBaseSupply = Math.max(
      0,
      p.costTotal - p.costVat - (manual.platformFeeExcludedBase[p.partnerId] ?? 0)
    )
    const settlement = calcSettlement({
      costTotal: p.costTotal,
      costVat: p.costVat,
      priceTotal: p.priceTotal,
      priceVat: p.priceVat,
      partnerType: record?.partnerType ?? 'partner',
      commissionPercent: record?.commissionPercent,
      businessDeduction: (deductions[p.partnerId] ?? 0) + manualDeduction,
      platformFeeBaseSupply,
    })
    warnings.push(...settlement.warnings)

    return {
      partnerId: p.partnerId,
      partnerName: record?.name ?? p.partnerId,
      partnerType: record?.partnerType ?? 'partner',
      venueCount: p.venues.length,
      costTotal: p.costTotal,
      costVat: p.costVat,
      priceTotal: p.priceTotal,
      priceVat: p.priceVat,
      manualDeduction,
      platformFeeBaseSupply,
      settlement,
    }
  })

  // 내역서 블록 — 정산 제외(본사)를 맨 앞에 두는 것이 원본 레이아웃이다
  const blocks: ReportPartnerBlock[] = []
  if (agg.excluded.length > 0) {
    blocks.push({
      partnerName: '본사',
      lines: agg.excluded.map(toLine),
      settlement: null,
    })
  }
  const settlementManualIds = new Set(
    settlementVenues
      .map((v) => (v as ManualNormalizedVenue).manualItemId)
      .filter((id): id is string => Boolean(id))
  )
  const directManual = venues.filter((v) => {
    const id = (v as ManualNormalizedVenue).manualItemId
    return Boolean(id) && !settlementManualIds.has(id!)
  })
  if (directManual.length > 0) {
    blocks.push({
      partnerName: '본사 직접',
      lines: directManual.map(toLine),
      settlement: null,
    })
  }
  for (const [i, p] of agg.partners.entries()) {
    blocks.push({
      partnerName: partners[i].partnerName,
      lines: p.venues.map(toLine),
      settlement: partners[i].settlement,
    })
  }

  const unmapped: UnmappedSummary[] = agg.unmapped.map((v) => ({
    source: v.source,
    businessCode: v.businessCode,
    businessName: v.businessName,
    costTotal: v.cost.total,
  }))

  // 홈택스 계산서 (docs §6-1). 매핑 누락 사업장은 계산서 대상에서도 빠지는데,
  // 그건 이미 `unmapped`로 잡히므로 여기서 중복 경고하지 않는다.
  // 절사 방식은 설정에서 온다 — 세무사 협의로 바뀔 수 있다 (docs §6-2)
  const originalInvoice = collectInvoiceRows(
    [
      ...buildInvoiceLines(applied.venues, master),
      ...buildManualInvoiceLines(manual.invoiceItems, master),
    ]
  )
  const invoiceOverrides = req.period ? await listInvoiceOverrides(req.period) : []
  const invoice = applyInvoiceOverrides(originalInvoice.rows, invoiceOverrides)
  const pending = {
    buyers: originalInvoice.pending.buyers,
    itemNames: resolvePendingItemNames(originalInvoice.pending.itemNames, master),
  }
  const issuer = master.issuer
  const invoiceProblems = [
    ...originalInvoice.problems,
    ...invoice.problems,
    ...invoiceOverrides
      .filter((override) => override.status === 'draft')
      .map((override) => `CJ 1016 ${override.itemName} 원단위 조정이 승인 대기 중입니다.`),
  ]
  if (!issuer) {
    invoiceProblems.push(
      '계산서 공급자(본사) 정보가 설정되지 않아 계산서를 만들 수 없습니다.'
    )
  }

  // 거래명세표를 줄 유치원 — **정산 제외 사업장(본사)은 뺀다.**
  const excludedCodes = new Set(agg.excluded.map((v) => v.businessCode))
  const statementVenues = (() => {
    const map = new Map<string, { source: 'shinsegae' | 'cj'; businessCode: string; businessName: string; itemCount: number }>()
    for (const it of shinsegaeItems) {
      if (excludedCodes.has(it.businessCode)) continue
      const key = `shinsegae:${it.businessCode}`
      const cur = map.get(key)
      if (cur) cur.itemCount += 1
      else map.set(key, { source: 'shinsegae', businessCode: it.businessCode, businessName: it.businessName, itemCount: 1 })
    }
    if (statement) {
      const codeByBusinessName = new Map(
        master.venues
          .filter((venue) => venue.source === 'cj')
          .map((venue) => [venue.businessName, venue.businessCode] as const)
      )
      for (const it of statement.items) {
        const businessCode = codeByBusinessName.get(it.businessName)
        if (!businessCode || excludedCodes.has(businessCode)) continue
        const key = `cj:${businessCode}`
        const cur = map.get(key)
        if (cur) cur.itemCount += 1
        else map.set(key, { source: 'cj', businessCode, businessName: it.businessName, itemCount: 1 })
      }
    }
    for (const it of manual.invoiceItems) {
      const key = `${it.source}:${it.businessCode}`
      const cur = map.get(key)
      if (cur) cur.itemCount += 1
      else map.set(key, { source: it.source, businessCode: it.businessCode, businessName: it.businessName, itemCount: 1 })
    }
    return [...map.values()].sort((a, b) => a.businessName.localeCompare(b.businessName))
  })()

  const closingVenues = withInvoiceOverrideDelta(
    buildClosingVenues(venues, master),
    originalInvoice.rows,
    invoice.rows,
    master
  )
  const overrideDelta = closingVenues.find(
    (venue) => venue.source === 'cj' &&
      venue.businessCode === '1016' &&
      venue.restaurantCode === 'invoice-override'
  )
  if (overrideDelta) {
    const line = {
      venueName: overrideDelta.restaurantName,
      cost: overrideDelta.cost,
      price: overrideDelta.price,
    }
    const direct = blocks.find((block) => block.partnerName === '본사 직접')
    if (direct) direct.lines.push(line)
    else {
      const index = blocks[0]?.partnerName === '본사' ? 1 : 0
      blocks.splice(index, 0, { partnerName: '본사 직접', lines: [line], settlement: null })
    }
  }

  return {
    partners,
    excluded: agg.excluded.map((v) => ({
      businessName: venueDisplayName(v),
      costTotal: v.cost.total,
      priceTotal: v.price.total,
    })),
    unmapped,
    periodMismatches,
    cjCrossCheck,
    cjStatementItemCount: statement ? statement.items.length : null,
    adjustments,
    adjustmentTotal: sumAdjustments(statement?.items ?? [], adjustments),
    manualItems,
    manualDeductionItems,
    statementItems: statement?.items ?? [],
    shinsegaeItems,
    statementVenues,
    sources: {
      shinsegae: {
        fileName: picked.shinsegae.fileName,
        sheetName: picked.shinsegae.sheetName,
        venueCount: ss.venues.length,
        dateRange: ss.dateRange,
      },
      cj: {
        fileName: picked.cj.fileName,
        sheetName: picked.cj.sheetName,
        venueCount: cj.venues.length,
        dateRange: cj.dateRange,
      },
    },
    warnings,
    errors,
    blocks,
    canClose: errors.length === 0 && unmapped.length === 0,
    invoiceRows: invoice.rows,
    invoiceRoundingTotal: 0,
    invoiceOverrides,
    invoiceOverrideCandidates: originalInvoice.rows.filter((row) =>
      row.allowVenueOverride !== false && row.venueKeys?.includes('cj:1016')
    ),
    invoiceProblems,
    issuer,
    canIssueInvoices:
      errors.length === 0 && unmapped.length === 0 && invoiceProblems.length === 0,
    pending,
    allPartners: [...master.partners.values()]
      .filter((p) => p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ partnerId: p.id, partnerName: p.name })),
    closingVenues,
    closingPartners: partners.map((p) => {
      const record = master.partners.get(p.partnerId)
      return {
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        partnerType: p.partnerType,
        commissionPercent: record?.commissionPercent ?? DEFAULT_COMMISSION_FALLBACK,
        costTotal: p.costTotal,
        costVat: p.costVat,
        priceTotal: p.priceTotal,
        priceVat: p.priceVat,
        margin: p.settlement.margin,
        platformFee: p.settlement.platformFee,
        vatDiff: p.settlement.vatDiff,
        businessDeduction: p.settlement.businessDeduction,
        preTax: p.settlement.preTax,
        declared: p.settlement.declared,
        incomeTax: p.settlement.incomeTax,
        localTax: p.settlement.localTax,
        netPay: p.settlement.netPay,
      }
    }),
  }
}

/**
 * 영업자 레코드를 못 찾았을 때의 수수료율.
 *
 * 여기까지 왔다면 마스터 불정합이고 이미 경고가 붙어 있다. 스냅샷에 `null`을 넣어
 * 나중에 "그때 수수료율이 뭐였지"를 답할 수 없게 만드는 대신 기본값을 남긴다.
 */
const DEFAULT_COMMISSION_FALLBACK = 5

/** 식당 단위 확정값 — 담당 영업자 이름까지 굳힌다 */
function buildClosingVenues(
  venues: readonly ManualNormalizedVenue[],
  master: SettlementMaster
): ClosingVenueRow[] {
  const byKey = new Map(
    master.venues.map((v) => [`${v.source}:${v.businessCode}`, v] as const)
  )
  return venues.map((v) => {
    const rec = byKey.get(`${v.source}:${v.businessCode}`)
    const isPartnerManual =
      v.manualItemId && v.manualBurden === 'venue' && v.manualPartnerIncluded !== false
    const partnerId = v.manualItemId && !isPartnerManual ? null : rec?.partnerId ?? null
    return {
      source: v.source,
      businessCode: v.businessCode,
      businessName: v.businessName,
      restaurantCode: v.restaurantCode,
      restaurantName: v.restaurantName,
      companyName: rec?.invoice.companyName ?? null,
      partnerId,
      partnerName: partnerId ? master.partners.get(partnerId)?.name ?? null : null,
      isExcluded: rec?.isExcluded ?? false,
      exclusionReason: rec?.exclusionReason ?? null,
      cost: v.cost,
      price: v.price,
      ...(v.manualItemId
        ? {
            manualItemId: v.manualItemId,
            manualBurden: v.manualBurden,
            manualPartnerIncluded: v.manualPartnerIncluded,
          }
        : {}),
    }
  })
}

/**
 * CJ 1016 원단위 조정 차액은 파트너 정산 원금에 섞지 않고 본사 조정 행으로 굳힌다.
 * 수금대장은 이 행을 포함한 최종 청구액을 사용하고, 공급자 원금은 cost=0이라 불변이다.
 */
function withInvoiceOverrideDelta(
  venues: ClosingVenueRow[],
  originalRows: readonly InvoiceRow[],
  finalRows: readonly InvoiceRow[],
  master: SettlementMaster
): ClosingVenueRow[] {
  const venue = master.venues.find(
    (candidate) => candidate.source === 'cj' && candidate.businessCode === '1016'
  )
  return applyInvoiceOverrideDeltaToClosingVenues(venues, originalRows, finalRows, {
    businessName: venue?.businessName ?? 'CJ 1016 인천 복자유치원',
    companyName: venue?.invoice.companyName ?? null,
  })
}

function resolvePendingItemNames(
  items: readonly PendingItemName[],
  master: SettlementMaster
): PendingItemNameResolution[] {
  const history = [...master.venueItems.values()]
  return items.map((item) => ({
    ...item,
    suggestedItemName: suggestInvoiceItemName(item.restaurantName, item.businessName),
    itemNameOptions: venueItemNameOptions(
      history,
      item.source,
      item.businessCode,
      item.taxKind
    ),
  }))
}

function toLine(v: NormalizedVenue) {
  return { venueName: venueDisplayName(v), cost: v.cost, price: v.price }
}

/**
 * 원천 식당 줄에 계산서 마스터를 붙인다.
 *
 * 필수 항목이 하나라도 빠지면 `buyer`를 **null로 넘긴다** — 부분적으로 채워진
 * 계산서를 만들면 홈택스 업로드가 실패하거나 엉뚱한 사업자에게 발행된다.
 */
function buildInvoiceLines(
  venues: readonly NormalizedVenue[],
  master: SettlementMaster
): InvoiceVenueLine[] {
  const byKey = new Map(
    master.venues.map((v) => [`${v.source}:${v.businessCode}`, v] as const)
  )

  return venues.map((v) => {
    const rec = byKey.get(`${v.source}:${v.businessCode}`)
    const complete = rec !== undefined && missingInvoiceFields(rec).length === 0
    const buyer: InvoiceParty | null =
      complete && rec
        ? {
            bizRegNo: rec.invoice.bizRegNo!,
            companyName: rec.invoice.companyName!,
            ceoName: rec.invoice.ceoName!,
            address: rec.invoice.address!,
            bizType: rec.invoice.bizType!,
            bizItem: rec.invoice.bizItem!,
            email: rec.invoice.email!,
            email2: rec.invoice.email2,
          }
        : null

    const itemName = (kind: InvoiceTaxKind): string | null =>
      master.venueItems.get(
        venueItemKey(v.source, v.businessCode, v.restaurantCode, kind)
      )?.invoiceItemName ?? null

    return {
      source: v.source,
      businessCode: v.businessCode,
      businessName: v.businessName,
      restaurantCode: v.restaurantCode,
      restaurantName: v.restaurantName,
      price: v.price,
      // 매핑 누락(사업장 미등록)도 계산서를 만들지 않는다. `unmapped`가 이미 알려준다.
      isExcluded: rec?.isExcluded ?? true,
      // 과거 플래그는 DB 롤백 호환용으로만 남고 계산에서는 무시한다.
      roundDown: false,
      buyer,
      itemNames: { taxable: itemName('taxable'), exempt: itemName('exempt') },
    }
  })
}

/** 승인된 외부 사입을 홈택스 계산서 입력 줄로 바꾼다. */
function buildManualInvoiceLines(
  items: readonly ManualItemRecord[],
  master: SettlementMaster
): InvoiceVenueLine[] {
  const byKey = new Map(
    master.venues.map((v) => [`${v.source}:${v.businessCode}`, v] as const)
  )
  return items.map((item) => {
    const rec = byKey.get(`${item.source}:${item.businessCode}`)
    const complete = rec !== undefined && missingInvoiceFields(rec).length === 0
    const buyer: InvoiceParty | null = complete && rec
      ? {
          bizRegNo: rec.invoice.bizRegNo!,
          companyName: rec.invoice.companyName!,
          ceoName: rec.invoice.ceoName!,
          address: rec.invoice.address!,
          bizType: rec.invoice.bizType!,
          bizItem: rec.invoice.bizItem!,
          email: rec.invoice.email!,
          email2: rec.invoice.email2,
        }
      : null
    const invoiceName =
      item.invoiceMode === 'separate' ? item.productName : item.invoiceItemName
    return {
      source: item.source,
      businessCode: item.businessCode,
      businessName: item.businessName,
      restaurantCode: `manual:${item.id}`,
      restaurantName: `외부사입 · ${item.productName}`,
      price: item.charge,
      isExcluded: rec?.isExcluded ?? true,
      roundDown: false,
      buyer,
      itemNames: {
        taxable: item.chargeTaxKind === 'taxable' ? invoiceName : null,
        exempt: item.chargeTaxKind === 'exempt' ? invoiceName : null,
      },
      groupKey: item.invoiceMode === 'separate' ? `manual:${item.id}` : undefined,
    }
  })
}

function emptyResult(base: { warnings: string[]; errors: string[] }): SettlementRunResult {
  return {
    partners: [],
    excluded: [],
    unmapped: [],
    sources: { shinsegae: null, cj: null },
    periodMismatches: [],
    cjCrossCheck: [],
    cjStatementItemCount: null,
    adjustments: [],
    adjustmentTotal: 0,
    manualItems: [],
    manualDeductionItems: {},
    statementItems: [],
    shinsegaeItems: [],
    statementVenues: [],
    warnings: base.warnings,
    errors: base.errors,
    blocks: [],
    canClose: false,
    invoiceRows: [],
    invoiceRoundingTotal: 0,
    invoiceOverrides: [],
    invoiceOverrideCandidates: [],
    invoiceProblems: [],
    issuer: null,
    canIssueInvoices: false,
    pending: { buyers: [], itemNames: [] },
    allPartners: [],
    closingVenues: [],
    closingPartners: [],
  }
}
