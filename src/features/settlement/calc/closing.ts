import type { PartnerType } from './settlement-formula'
import type { SettlementSource, TaxBreakdown } from '../parse/types'

/**
 * 월 마감 합계 (docs/systems/settlement.md §8, §13).
 *
 * 경영 보고서의 헤드라인 숫자를 만든다. **항등식이 닫히는지**가 검증 기준이다:
 *
 * ```
 * 매출 − 매출원가        = 총마진 M (= 영업자 차액 합계)
 * 총마진 − 영업자 세전 R = 본사 몫 (= 적립금 + 부가세차액 + 공제)
 * 본사 몫 − 마케팅비     = 영업이익
 * ```
 *
 * 순수 함수다. DB·엑셀을 모르고, 그래서 테스트로 고정할 수 있다.
 */

/** 마감 스냅샷의 식당 한 줄 */
export interface ClosingVenueRow {
  source: SettlementSource
  businessCode: string
  businessName: string
  restaurantCode: string
  restaurantName: string
  /** 담당 영업자. 제외 사업장이거나 미배정이면 null */
  partnerId: string | null
  /** 그때의 영업자 이름 — 나중에 이름이 바뀌어도 마감 문서는 그대로여야 한다 */
  partnerName: string | null
  isExcluded: boolean
  exclusionReason: string | null
  cost: TaxBreakdown
  price: TaxBreakdown
}

/** 마감 스냅샷의 영업자 한 줄 — 산식 결과를 그대로 굳힌다 (docs §3) */
export interface ClosingPartnerRow {
  partnerId: string
  partnerName: string
  partnerType: PartnerType
  commissionPercent: number
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
  /** 차액 M */
  margin: number
  /** 적립금 O */
  platformFee: number
  /** 부가세차액 P */
  vatDiff: number
  /** 사업자공제 Q */
  businessDeduction: number
  /** 지급액(세전) R */
  preTax: number
  /** 신고액 V */
  declared: number
  /** 소득세 S */
  incomeTax: number
  /** 지방소득세 T */
  localTax: number
  /** 실지급 U */
  netPay: number
}

export interface ClosingTotals {
  /** 매출 — **정산제외 사업장을 뺀** 단가합계. 계산서를 발행한 금액이다 */
  revenue: number
  /** 매출원가 — 제외 사업장 원가를 뺀 매입합계 */
  costOfSales: number
  /** 마케팅비 — 제외 사업장의 원가 (본사 자체 소비분, docs §13-4) */
  marketingCost: number
  /** 총마진 M = 매출 − 매출원가 */
  grossMargin: number

  /** 적립금 O 합계 */
  platformFee: number
  /** 부가세차액 P 합계 — 영업자에게서 회수한 금액 */
  vatDiff: number
  /** 사업자공제 Q 합계 */
  businessDeduction: number
  /** 영업자 세전 R 합계 */
  partnerPreTax: number
  /** 원천세 = 소득세 + 지방세 합계 */
  withholding: number
  /** 영업자 실지급 U 합계 */
  partnerNetPay: number
  /** 사업소득 신고액 V 합계 */
  declared: number

  /** 본사 몫 = O + P + Q (= 총마진 − 영업자 세전) */
  hqShare: number
  /** 영업이익 = 본사 몫 − 마케팅비 */
  operatingProfit: number

  /** 매출세액 — **계산서 발행분만** */
  salesVat: number
  /** 매입세액 — **제외 사업장까지 전부**. 마케팅비도 공제받는다 */
  purchaseVat: number
  /** 납부할 부가세 = 매출세액 − 매입세액 (음수면 환급) */
  vatPayable: number
  /**
   * 회수한 부가세차액(P) − 납부액. 26년 6월은 905원이고,
   * 이는 본사 마케팅비의 매입세액 공제분이다 — **이상 항목이 아니다** (docs §13-4).
   * 매달 확인만 하고 넘어가면 된다.
   */
  vatDiffGap: number
}

/** 마감 기간 — `YYYY-MM`만 받는다. `26년6월` 같은 표기는 연도가 애매하다. */
export function isValidPeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return false
  const month = Number(m[2])
  return month >= 1 && month <= 12
}

export function closingTotals(
  venues: readonly ClosingVenueRow[],
  partners: readonly ClosingPartnerRow[]
): ClosingTotals {
  let revenue = 0
  let costOfSales = 0
  let marketingCost = 0
  let salesVat = 0
  let purchaseVat = 0

  for (const v of venues) {
    // 매입세액은 제외 사업장까지 전부 센다 — 마케팅비의 매입세액도 공제 대상이다
    purchaseVat += v.cost.vat

    if (v.isExcluded) {
      marketingCost += v.cost.total
      // 제외 사업장은 계산서를 발행하지 않으므로 매출·매출세액에 넣지 않는다
      continue
    }
    // 미배정 사업장도 매출에 넣는다 — 담당자가 없을 뿐 청구는 한다.
    // 빼면 매출이 조용히 줄어든다 (마감은 별도로 차단된다).
    revenue += v.price.total
    costOfSales += v.cost.total
    salesVat += v.price.vat
  }

  const sum = (pick: (p: ClosingPartnerRow) => number): number =>
    partners.reduce((acc, p) => acc + pick(p), 0)

  const platformFee = sum((p) => p.platformFee)
  const vatDiff = sum((p) => p.vatDiff)
  const businessDeduction = sum((p) => p.businessDeduction)
  const partnerPreTax = sum((p) => p.preTax)
  const withholding = sum((p) => p.incomeTax + p.localTax)
  const partnerNetPay = sum((p) => p.netPay)
  const declared = sum((p) => p.declared)

  const grossMargin = revenue - costOfSales
  const hqShare = platformFee + vatDiff + businessDeduction
  const vatPayable = salesVat - purchaseVat

  return {
    revenue,
    costOfSales,
    marketingCost,
    grossMargin,
    platformFee,
    vatDiff,
    businessDeduction,
    partnerPreTax,
    withholding,
    partnerNetPay,
    declared,
    hqShare,
    operatingProfit: hqShare - marketingCost,
    salesVat,
    purchaseVat,
    vatPayable,
    vatDiffGap: vatDiff - vatPayable,
  }
}
