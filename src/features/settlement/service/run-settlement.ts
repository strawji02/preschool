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
} from '../report/invoice-sheet'
import { venueDisplayName, type ReportPartnerBlock } from '../report/settlement-sheet'
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
   * 계산서를 만들 수 없는 항목 — 유치원 사업자 정보 미비, 식당 품목명 미지정.
   * 마감 차단 사유다 (docs §14-2). 정산 제외와 금액 0은 포함하지 않는다.
   */
  invoiceProblems: string[]
  /** 계산서 공급자(본사). 미설정이면 계산서를 만들 수 없다 */
  issuer: InvoiceParty | null
  canIssueInvoices: boolean
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
  const invoice = collectInvoiceRows(buildInvoiceLines(venues, master))
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
    sources: {
      shinsegae: {
        fileName: picked.shinsegae.fileName,
        sheetName: picked.shinsegae.sheetName,
        venueCount: ss.venues.length,
      },
      cj: {
        fileName: picked.cj.fileName,
        sheetName: picked.cj.sheetName,
        venueCount: cj.venues.length,
      },
    },
    warnings,
    errors,
    blocks,
    canClose: errors.length === 0 && unmapped.length === 0,
    invoiceRows: invoice.rows,
    invoiceProblems,
    issuer,
    canIssueInvoices:
      errors.length === 0 && unmapped.length === 0 && invoiceProblems.length === 0,
  }
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
      restaurantCode: v.restaurantCode,
      restaurantName: v.restaurantName,
      price: v.price,
      // 매핑 누락(사업장 미등록)도 계산서를 만들지 않는다. `unmapped`가 이미 알려준다.
      isExcluded: rec?.isExcluded ?? true,
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
    warnings: base.warnings,
    errors: base.errors,
    blocks: [],
    canClose: false,
    invoiceRows: [],
    invoiceProblems: [],
    issuer: null,
    canIssueInvoices: false,
  }
}
