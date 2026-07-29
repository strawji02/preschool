import type { SettlementResult } from '../calc/settlement-formula'
import type { NormalizedVenue, TaxBreakdown } from '../parse/types'

/**
 * 영업자별 개별 정산 내역서 (docs/systems/settlement.md §6-2)
 *
 * 담당자가 기존 엑셀과 **1:1로 대조**할 수 있어야 하므로, 근거 파일의
 * `집계표_정산용` 레이아웃을 그대로 재현한다 (2026-07-29 실측).
 *
 * ```
 * 1~2행: 공백
 * 3행:  구분 | 식당명 | 원가(C~G) | 단가(H~L) | 차액(M) | 정산(O~U) | 사업소득(V)
 * 4행:  공급가 세액 금액 면세 합계 × 2 | 적립금 부가세차액 사업자공제 지급액(세전)
 *       사업소득세 지방세 실지급액 | 신고액
 * 5행~: 영업자 블록 = 식당 행들 + `계` 행
 * 끝:   `합계` 행
 * ```
 *
 * 왜 원본 레이아웃을 따르는가: 이 시스템의 첫 사용자는 지금까지 이 엑셀을 손으로
 * 만들던 담당자다. 열 위치가 같으면 결과를 바로 믿을 수 있고, 다르면 매번
 * 대조 비용이 든다. `N`열을 비워 두는 것도 원본과 컬럼 기호를 맞추기 위함이다.
 */

/** 0-based 열 인덱스 — 엑셀 열문자와 1:1 대응 */
export const REPORT_COL = {
  division: 0, // A 구분 (영업자명 / 계 / 합계)
  venue: 1, // B 식당명
  costSupply: 2, // C
  costVat: 3, // D
  costAmount: 4, // E = 공급가 + 세액
  costExempt: 5, // F
  costTotal: 6, // G = 금액 + 면세
  priceSupply: 7, // H
  priceVat: 8, // I
  priceAmount: 9, // J
  priceExempt: 10, // K
  priceTotal: 11, // L
  margin: 12, // M
  blank: 13, // N — 항상 비어 있다 (원본과 컬럼 기호를 맞추기 위한 공백)
  platformFee: 14, // O
  vatDiff: 15, // P
  deduction: 16, // Q (식당 행에서는 메모 자리)
  preTax: 17, // R
  incomeTax: 18, // S
  localTax: 19, // T
  netPay: 20, // U
  declared: 21, // V
} as const

const HEADER_ROW_COUNT = 4
/** 헤더 3행의 0-based 행 번호 */
const GROUP_HEADER_INDEX = 2
/** 헤더 4행의 0-based 행 번호 */
const SUB_HEADER_INDEX = 3

export interface ReportVenueLine {
  /** B열 표기 — `venueDisplayName()`으로 만든다 */
  venueName: string
  cost: TaxBreakdown
  price: TaxBreakdown
  /** Q열에 남기는 메모. 원본은 부가서비스 식당에 `커피차`를 적어 뒀다. */
  memo?: string
}

export interface ReportPartnerBlock {
  /** A열에 들어갈 이름. 정산 제외 블록은 `본사` 같은 구분명이 온다. */
  partnerName: string
  lines: ReportVenueLine[]
  /** 정산 대상이 아니면 null — `계` 행의 정산 열(O~V)을 비운다 */
  settlement: SettlementResult | null
}

export interface SheetMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

export interface SettlementSheet {
  rows: unknown[][]
  merges: SheetMerge[]
}

/**
 * 원본 `집계표_정산용` B열 표기를 재현한다.
 *
 * - CJ는 식당명 자체가 `키즈웰에듀푸드(선경유치원_방과후간식)`처럼 완결된 이름이다.
 * - 신세계는 사업장명과 식당명이 분리돼 있어 합쳐야 한다. 사업장명에 붙는
 *   `EDU)키즈_` 는 신세계 내부 접두라 원본 표기에는 없다.
 */
export function venueDisplayName(venue: NormalizedVenue): string {
  if (venue.source === 'cj') return venue.restaurantName
  const business = venue.businessName.replace(/^EDU\)키즈_/, '')
  return `${business} ${venue.restaurantName}`.trim()
}

export function buildSettlementSheet(
  blocks: readonly ReportPartnerBlock[]
): SettlementSheet {
  const rows: unknown[][] = [[], []] // 1~2행 공백
  const merges: SheetMerge[] = []

  rows.push(groupHeaderRow(), subHeaderRow())
  merges.push(
    span(GROUP_HEADER_INDEX, REPORT_COL.division, SUB_HEADER_INDEX, REPORT_COL.division),
    span(GROUP_HEADER_INDEX, REPORT_COL.venue, SUB_HEADER_INDEX, REPORT_COL.venue),
    span(GROUP_HEADER_INDEX, REPORT_COL.costSupply, GROUP_HEADER_INDEX, REPORT_COL.costTotal),
    span(GROUP_HEADER_INDEX, REPORT_COL.priceSupply, GROUP_HEADER_INDEX, REPORT_COL.priceTotal),
    span(GROUP_HEADER_INDEX, REPORT_COL.margin, SUB_HEADER_INDEX, REPORT_COL.margin),
    span(GROUP_HEADER_INDEX, REPORT_COL.platformFee, GROUP_HEADER_INDEX, REPORT_COL.netPay)
  )

  const grand = emptyTotals()

  for (const block of blocks) {
    const blockStart = rows.length
    const subtotal = emptyTotals()

    for (const [i, l] of block.lines.entries()) {
      const row: unknown[] = []
      if (i === 0) row[REPORT_COL.division] = block.partnerName
      row[REPORT_COL.venue] = l.venueName
      writeBreakdowns(row, l.cost, l.price)
      if (l.memo) row[REPORT_COL.deduction] = l.memo
      rows.push(row)

      accumulate(subtotal, l)
      accumulate(grand, l)
    }

    // 식당이 2개 이상일 때만 구분 열을 병합한다 (1개면 병합 자체가 성립하지 않는다)
    if (block.lines.length > 1) {
      merges.push(
        span(blockStart, REPORT_COL.division, rows.length - 1, REPORT_COL.division)
      )
    }

    // `계` 행
    const totalRow: unknown[] = []
    totalRow[REPORT_COL.division] = '계'
    writeTotals(totalRow, subtotal)
    if (block.settlement) writeSettlement(totalRow, block.settlement)
    merges.push(span(rows.length, REPORT_COL.division, rows.length, REPORT_COL.venue))
    rows.push(totalRow)

    if (block.settlement) accumulateSettlement(grand, block.settlement)
  }

  // `합계` 행 — 원본은 정산 제외 블록(본사)의 원가·단가까지 포함한다
  const grandRow: unknown[] = []
  grandRow[REPORT_COL.division] = '합계'
  writeTotals(grandRow, grand)
  writeSettlementTotals(grandRow, grand)
  merges.push(span(rows.length, REPORT_COL.division, rows.length, REPORT_COL.venue))
  rows.push(grandRow)

  return { rows, merges }
}

// ── 헤더 ────────────────────────────────────────────────

function groupHeaderRow(): unknown[] {
  const r: unknown[] = []
  r[REPORT_COL.division] = '구분'
  r[REPORT_COL.venue] = '식당명'
  r[REPORT_COL.costSupply] = '원가'
  r[REPORT_COL.priceSupply] = '단가'
  r[REPORT_COL.margin] = '차액'
  r[REPORT_COL.platformFee] = '정산'
  r[REPORT_COL.declared] = '사업소득'
  return r
}

function subHeaderRow(): unknown[] {
  const r: unknown[] = []
  r[REPORT_COL.costSupply] = '공급가'
  r[REPORT_COL.costVat] = '세액'
  r[REPORT_COL.costAmount] = '금액'
  r[REPORT_COL.costExempt] = '면세'
  r[REPORT_COL.costTotal] = '합계'
  r[REPORT_COL.priceSupply] = '공급가'
  r[REPORT_COL.priceVat] = '세액'
  r[REPORT_COL.priceAmount] = '금액'
  r[REPORT_COL.priceExempt] = '면세'
  r[REPORT_COL.priceTotal] = '합계'
  r[REPORT_COL.platformFee] = '적립금'
  r[REPORT_COL.vatDiff] = '부가세차액'
  r[REPORT_COL.deduction] = '사업자공제'
  r[REPORT_COL.preTax] = '지급액(세전)'
  r[REPORT_COL.incomeTax] = '사업소득세'
  r[REPORT_COL.localTax] = '지방세'
  r[REPORT_COL.netPay] = '실지급액'
  r[REPORT_COL.declared] = '신고액'
  return r
}

// ── 누적 ────────────────────────────────────────────────

interface Totals {
  costSupply: number
  costVat: number
  costExempt: number
  priceSupply: number
  priceVat: number
  priceExempt: number
  platformFee: number
  vatDiff: number
  deduction: number
  preTax: number
  incomeTax: number
  localTax: number
  netPay: number
  declared: number
}

function emptyTotals(): Totals {
  return {
    costSupply: 0,
    costVat: 0,
    costExempt: 0,
    priceSupply: 0,
    priceVat: 0,
    priceExempt: 0,
    platformFee: 0,
    vatDiff: 0,
    deduction: 0,
    preTax: 0,
    incomeTax: 0,
    localTax: 0,
    netPay: 0,
    declared: 0,
  }
}

function accumulate(t: Totals, l: ReportVenueLine): void {
  t.costSupply += l.cost.taxableSupply
  t.costVat += l.cost.vat
  t.costExempt += l.cost.exempt
  t.priceSupply += l.price.taxableSupply
  t.priceVat += l.price.vat
  t.priceExempt += l.price.exempt
}

function accumulateSettlement(t: Totals, s: SettlementResult): void {
  t.platformFee += s.platformFee
  t.vatDiff += s.vatDiff
  t.deduction += s.businessDeduction
  t.preTax += s.preTax
  t.incomeTax += s.incomeTax
  t.localTax += s.localTax
  t.netPay += s.netPay
  t.declared += s.declared
}

// ── 셀 쓰기 ─────────────────────────────────────────────

function writeBreakdowns(row: unknown[], cost: TaxBreakdown, price: TaxBreakdown): void {
  row[REPORT_COL.costSupply] = cost.taxableSupply
  row[REPORT_COL.costVat] = cost.vat
  row[REPORT_COL.costAmount] = cost.taxableSupply + cost.vat
  row[REPORT_COL.costExempt] = cost.exempt
  row[REPORT_COL.costTotal] = cost.total

  row[REPORT_COL.priceSupply] = price.taxableSupply
  row[REPORT_COL.priceVat] = price.vat
  row[REPORT_COL.priceAmount] = price.taxableSupply + price.vat
  row[REPORT_COL.priceExempt] = price.exempt
  row[REPORT_COL.priceTotal] = price.total

  row[REPORT_COL.margin] = price.total - cost.total
}

function writeTotals(row: unknown[], t: Totals): void {
  const cost: TaxBreakdown = {
    taxableSupply: t.costSupply,
    vat: t.costVat,
    exempt: t.costExempt,
    total: t.costSupply + t.costVat + t.costExempt,
  }
  const price: TaxBreakdown = {
    taxableSupply: t.priceSupply,
    vat: t.priceVat,
    exempt: t.priceExempt,
    total: t.priceSupply + t.priceVat + t.priceExempt,
  }
  writeBreakdowns(row, cost, price)
}

function writeSettlement(row: unknown[], s: SettlementResult): void {
  row[REPORT_COL.platformFee] = s.platformFee
  row[REPORT_COL.vatDiff] = s.vatDiff
  row[REPORT_COL.deduction] = s.businessDeduction
  row[REPORT_COL.preTax] = s.preTax
  row[REPORT_COL.incomeTax] = s.incomeTax
  row[REPORT_COL.localTax] = s.localTax
  row[REPORT_COL.netPay] = s.netPay
  row[REPORT_COL.declared] = s.declared
}

function writeSettlementTotals(row: unknown[], t: Totals): void {
  row[REPORT_COL.platformFee] = t.platformFee
  row[REPORT_COL.vatDiff] = t.vatDiff
  row[REPORT_COL.deduction] = t.deduction
  row[REPORT_COL.preTax] = t.preTax
  row[REPORT_COL.incomeTax] = t.incomeTax
  row[REPORT_COL.localTax] = t.localTax
  row[REPORT_COL.netPay] = t.netPay
  row[REPORT_COL.declared] = t.declared
}

function span(r1: number, c1: number, r2: number, c2: number): SheetMerge {
  return { s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }
}

export { HEADER_ROW_COUNT }
