import { calcSettlement, type PartnerType, type SettlementResult } from '../calc/settlement-formula'
import { loadSettlementMaster } from '../data/master'
import { aggregateByPartner } from '../parse/aggregate'
import { parseCjSheet } from '../parse/cj'
import { parseShinsegaeSheet } from '../parse/shinsegae'
import type { NormalizedVenue } from '../parse/types'
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
  /** 마감 가능 여부 — 누락·오류가 없어야 true */
  canClose: boolean
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
  }
}

function toLine(v: NormalizedVenue) {
  return { venueName: venueDisplayName(v), cost: v.cost, price: v.price }
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
  }
}
