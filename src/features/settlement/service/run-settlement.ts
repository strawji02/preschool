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
import { parseShinsegaeSheet } from '../parse/shinsegae'
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
import {
  checkSourcePeriod,
  periodMismatchMessage,
  type PeriodMismatch,
  type SourceDateRange,
} from '../calc/period-guard'
import { pickSourceSheets, type UploadedWorkbook } from './pick-sheets'

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
    itemNames: PendingItemName[]
  }
  /**
   * 이미 쓰이고 있는 품목명 — 빈도순. 화면에서 콤보로 제시한다.
   * 오타로 새 품목이 생기면 계산서가 쪼개지므로 기존 값을 먼저 보여주는 게 중요하다.
   */
  itemNameOptions: string[]
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

  // ★ 정산월 대조는 **매핑·산식보다 먼저** 본다 (docs §8-4).
  // 달이 틀리면 그 뒤의 숫자는 전부 의미가 없다. 그래서 경고가 아니라 errors다.
  const periodMismatches = checkSourcePeriod(req.period ?? '', [
    { label: `신세계 (${picked.shinsegae.sheetName})`, dateRange: ss.dateRange },
    { label: `CJ (${picked.cj.sheetName})`, dateRange: cj.dateRange },
  ])
  errors.push(...periodMismatches.map(periodMismatchMessage))

  // 원본 `집계표_정산용`이 CJ를 먼저 나열하므로 같은 순서로 맞춘다
  const venues: NormalizedVenue[] = [...cj.venues, ...ss.venues]

  const master = await loadSettlementMaster()
  const agg = aggregateByPartner(venues, master.mapping)
  warnings.push(...agg.warnings)

  const deductions = req.deductions ?? {}

  const partners: PartnerSummary[] = agg.partners.map((p) => {
    const record = master.partners.get(p.partnerId)
    if (!record) {
      // 매핑은 있는데 영업자 레코드가 없다 = 마스터 데이터 불정합
      warnings.push(
        `영업자 정보를 찾을 수 없습니다 (id: ${p.partnerId}). 마스터 데이터를 확인하세요.`
      )
    }
    const settlement = calcSettlement({
      costTotal: p.costTotal,
      costVat: p.costVat,
      priceTotal: p.priceTotal,
      priceVat: p.priceVat,
      partnerType: record?.partnerType ?? 'partner',
      commissionPercent: record?.commissionPercent,
      businessDeduction: deductions[p.partnerId] ?? 0,
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
  const invoice = collectInvoiceRows(
    buildInvoiceLines(venues, master),
    master.issuer?.roundingMode ?? 'vat'
  )
  const issuer = master.issuer
  const invoiceProblems = [...invoice.problems]
  if (!issuer) {
    invoiceProblems.push(
      '계산서 공급자(본사) 정보가 설정되지 않아 계산서를 만들 수 없습니다.'
    )
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
    invoiceRoundingTotal: invoice.roundingTotal,
    invoiceProblems,
    issuer,
    canIssueInvoices:
      errors.length === 0 && unmapped.length === 0 && invoiceProblems.length === 0,
    pending: invoice.pending,
    itemNameOptions: itemNameOptions(master),
    allPartners: [...master.partners.values()]
      .filter((p) => p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ partnerId: p.id, partnerName: p.name })),
    closingVenues: buildClosingVenues(venues, master),
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
  venues: readonly NormalizedVenue[],
  master: SettlementMaster
): ClosingVenueRow[] {
  const byKey = new Map(
    master.venues.map((v) => [`${v.source}:${v.businessCode}`, v] as const)
  )
  return venues.map((v) => {
    const rec = byKey.get(`${v.source}:${v.businessCode}`)
    const partnerId = rec?.partnerId ?? null
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
    }
  })
}

/**
 * 이미 등록된 품목명을 빈도순으로 모은다.
 *
 * 오타로 새 품목이 생기면 계산서가 두 장으로 쪼개진다(`급식재료`와 `급식재료 `).
 * 자주 쓰는 것을 앞에 두면 사용자가 직접 타이핑할 일이 줄어든다.
 */
function itemNameOptions(master: SettlementMaster): string[] {
  const counts = new Map<string, number>()
  for (const item of master.venueItems.values()) {
    counts.set(item.invoiceItemName, (counts.get(item.invoiceItemName) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
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
      // 유치원별 원단위 절사 (docs §6-2, migration 058)
      roundDown: rec?.invoiceRoundDown ?? false,
      buyer,
      itemNames: { taxable: itemName('taxable'), exempt: itemName('exempt') },
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
    warnings: base.warnings,
    errors: base.errors,
    blocks: [],
    canClose: false,
    invoiceRows: [],
    invoiceRoundingTotal: 0,
    invoiceProblems: [],
    issuer: null,
    canIssueInvoices: false,
    pending: { buyers: [], itemNames: [] },
    itemNameOptions: [],
    allPartners: [],
    closingVenues: [],
    closingPartners: [],
  }
}
