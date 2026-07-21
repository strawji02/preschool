/**
 * 영업자(파트너) 손익 산출 — 계약식(제4조) 순수함수 (2026-07-21 재작성)
 *
 * 엑셀 "수익_계산_검증"(정합성_매핑_업무흐름_이익률 검토) 모델을 코드화:
 *
 *   단가 = 원가 × (1 + m)              (m = 단가 마진율)
 *   매입원가 C = 판매가 S ÷ (1 + m)
 *   총마진 = S − C = C·m
 *   갑(플랫폼) 수수료 = C × 5%           (원가 대비, 고정)
 *   을(영업자) 정산금 = 총마진 − 플랫폼수수료 = C × (m − 5%)
 *
 * 즉 영업자 마진은 마진율 m에 연동된다(원가 대비 m−5%, 매출 대비 (m−5%)/(1+m)).
 * 발표자료의 "매출 15%"는 m=20% 근처의 근사치일 뿐, 실제 계약은 마진율 연동이다.
 *
 * 웹앱 맥락: 세션의 신세계 원가 C는 고정(매칭된 상품의 standard_price 합).
 *   보고서 작성자가 공급율(1+m)을 조정하면 판매가 S=C·(1+m)와 유치원 절감(제공 서비스)이
 *   함께 변동한다. 민감도 표는 "작성자가 현재 설정한 공급율"을 중심으로 동적 생성한다.
 */

/** 갑(플랫폼) 수수료율 — 매입원가 대비 5% 고정 (엑셀 B6) */
export const PLATFORM_FEE_RATE = 0.05
/** 민감도 표 단계 폭 (3%p) */
export const SENSITIVITY_STEP = 0.03
/** 중심 기준 상·하 단계 수 (3단계씩 → 총 7행) */
export const SENSITIVITY_HALF_STEPS = 3

/**
 * 영업자 연 정산금 = 원가 × (마진율 − 플랫폼수수료). 원 단위 반올림.
 */
export function partnerSettlement(
  purchaseCost: number,
  marginRate: number,
  platformFeeRate: number = PLATFORM_FEE_RATE,
): number {
  return Math.round(purchaseCost * (marginRate - platformFeeRate))
}

export interface PartnerProfitInput {
  /** 현재 공급율 기준 신세계 판매가(연) = annualSsgCost = C × (1+m) */
  annualSupplyRevenue: number
  /** 현재 공급율 (1+m) — 보고서 작성자가 설정한 값 */
  supplyRate: number
  /** 원아 수 */
  childrenCount: number
  /** 플랫폼 수수료율 (기본 5%) */
  platformFeeRate?: number
}

export interface PartnerProfitResult {
  /** 마진율 m = supplyRate − 1 */
  marginRate: number
  platformFeeRate: number
  /** 매입원가 C = 판매가 ÷ 공급율 */
  purchaseCost: number
  /** 영업자 연 정산금 */
  annual: number
  monthly: number
  perChild: number
  /** 영업자 정산금 / 판매가(매출) */
  revenuePctOfSales: number
}

export function computePartnerProfit(input: PartnerProfitInput): PartnerProfitResult {
  const fee = input.platformFeeRate ?? PLATFORM_FEE_RATE
  const marginRate = input.supplyRate - 1
  const purchaseCost = input.supplyRate !== 0 ? input.annualSupplyRevenue / input.supplyRate : 0
  const annual = partnerSettlement(purchaseCost, marginRate, fee)
  const monthly = Math.round(annual / 12)
  const perChild = input.childrenCount > 0 ? Math.round(annual / input.childrenCount) : 0
  const revenuePctOfSales = input.annualSupplyRevenue > 0 ? annual / input.annualSupplyRevenue : 0
  return { marginRate, platformFeeRate: fee, purchaseCost, annual, monthly, perChild, revenuePctOfSales }
}

export interface MarginSensitivityInput {
  /** 매입원가 C (세션 고정 앵커) */
  purchaseCost: number
  /** 현재 공급율 (1+m) — 표의 중심 */
  currentSupplyRate: number
  /** 원장 현재가(비교가능, 연) — 유치원 제공 서비스 = 현재가 − 판매가 */
  kindergartenCurrentCost: number
  platformFeeRate?: number
  stepPct?: number
  halfSteps?: number
}

export interface MarginSensitivityRow {
  marginRate: number
  supplyRate: number
  /** 유치원 판매가 S = C × (1+m) */
  salePrice: number
  /** 유치원 제공 서비스(절감 환원) = 원장 현재가 − 판매가 */
  kindergartenService: number
  /** 영업자 연 정산금 = C × (m − fee) */
  partnerSettlement: number
  /** 영업자 정산금 / 판매가 */
  partnerPctOfSales: number
  /** 현재 공급율 행 여부 (강조용) */
  isCurrent: boolean
}

/**
 * 현재 공급율을 중심으로 ±stepPct × halfSteps 마진율 시나리오 표를 만든다.
 * 정산금이 0 이하가 되는(마진율 ≤ 플랫폼수수료) 행은 제외한다.
 */
export function computeMarginSensitivity(input: MarginSensitivityInput): MarginSensitivityRow[] {
  const fee = input.platformFeeRate ?? PLATFORM_FEE_RATE
  const step = input.stepPct ?? SENSITIVITY_STEP
  const half = input.halfSteps ?? SENSITIVITY_HALF_STEPS
  const C = input.purchaseCost
  const baseM = input.currentSupplyRate - 1
  const rows: MarginSensitivityRow[] = []
  for (let k = -half; k <= half; k++) {
    // 부동소수 드리프트 방지 — 0.01 단위 반올림
    const marginRate = Math.round((baseM + k * step) * 100) / 100
    if (marginRate <= fee) continue // 영업자 정산금 ≤ 0 → 무의미, 제외
    const supplyRate = 1 + marginRate
    const salePrice = Math.round(C * supplyRate)
    const kindergartenService = Math.round(input.kindergartenCurrentCost) - salePrice
    const settlement = partnerSettlement(C, marginRate, fee)
    const partnerPctOfSales = salePrice > 0 ? settlement / salePrice : 0
    rows.push({
      marginRate,
      supplyRate,
      salePrice,
      kindergartenService,
      partnerSettlement: settlement,
      partnerPctOfSales,
      isCurrent: k === 0,
    })
  }
  return rows
}
