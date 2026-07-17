/**
 * 영업자(파트너) 예상 손익 산출 — 순수함수
 *
 * 사업 제안서(영업자 모집용) 구조:
 *   파트너는 급식 명세서만 수령·전달하고 나머지 운영(주문·검수·정산·클레임)은 플랫폼 담당.
 *   파트너 수익 = 신세계 공급 연매출 × 배분율(15%).
 *   ("업계 최초 수익의 75% 배분" = 매출 대비 15% 구조)
 *
 * 급식 제안서(원장 제출용)의 절감액과는 별개 흐름:
 *   - 원장:   절감액 → 유치원 부가서비스로 환원
 *   - 파트너: 공급 마진의 15% 배분
 *   두 값은 서로 상충하지 않는다.
 */

/** 파트너 배분율 — 공급 연매출 대비 15% */
export const PARTNER_SHARE_RATE = 0.15

/** 확장 시나리오에 사용할 거래처 수 */
export const PROFIT_SCENARIO_COUNTS = [3, 5, 10] as const

export interface PartnerProfitInput {
  /** 신세계 공급 연매출 (원장이 신세계에 지불하는 연간 금액 = annualSsgCost) */
  annualSupplyRevenue: number
  /** 원아 수 — 원아 1명당 수익 산출용 */
  childrenCount: number
  /** 배분율 (기본 15%) */
  shareRate?: number
}

export interface PartnerProfitScenario {
  count: number
  annual: number
}

export interface PartnerProfitResult {
  /** 배분율 (0~1) */
  shareRate: number
  /** 파트너 연 예상 수익 */
  annual: number
  /** 월 평균 */
  monthly: number
  /** 원아 1명당 연 수익 (원아 0명이면 0) */
  perChild: number
  /** 확장 시나리오 (거래처 N곳) */
  scenarios: PartnerProfitScenario[]
}

/**
 * 파트너 예상 손익 계산.
 * 모든 금액은 원 단위 정수로 반올림한다.
 */
export function computePartnerProfit(input: PartnerProfitInput): PartnerProfitResult {
  const shareRate = input.shareRate ?? PARTNER_SHARE_RATE
  const annual = Math.round(input.annualSupplyRevenue * shareRate)
  const monthly = Math.round(annual / 12)
  const perChild = input.childrenCount > 0 ? Math.round(annual / input.childrenCount) : 0
  const scenarios = PROFIT_SCENARIO_COUNTS.map((count) => ({
    count,
    annual: annual * count,
  }))
  return { shareRate, annual, monthly, perChild, scenarios }
}
