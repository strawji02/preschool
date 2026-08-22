import { percentRoundDownTo10, percentRoundUpTo10 } from './rounding'

/**
 * 정산 산식 (docs/systems/settlement.md §3)
 *
 * ```
 * 차액(총마진)  M = 단가합계 − 원가합계                    ← 총액(세액 포함) 기준
 * 적립금(플랫폼) O = ROUNDUP((원가합계 − 원가세액) × 5%, -1)
 * 부가세차액     P = 단가세액 − 원가세액                   ← 영업자 전액 부담
 * 사업자공제     Q = 매월 수기 입력 (커피차 등 부가서비스)
 * 지급액(세전)   R = M − O − P − Q
 * 신고액         V = 코파운더 → R + O / 일반 파트너 → R
 * 소득세         S = ROUNDDOWN(V × 3%, -1)
 * 지방소득세     T = ROUNDDOWN(S × 10%, -1)
 * 실지급         U = R − S − T                            ← 세전에서 차감
 * ```
 *
 * 집계 단위는 **영업자 → 유치원(사업장)×식당**이고, 위 산식은 영업자별 합계 기준이다.
 */

/** 코파운더는 적립금(O)을 사업소득 신고액에 포함한다. 신규 등록자는 전부 'partner'. */
export type PartnerType = 'cofounder' | 'partner'

/** 소득세율 3% — 사업소득 원천징수 */
const INCOME_TAX_PERCENT = 3
/** 지방소득세율 10% — 소득세의 10% */
const LOCAL_TAX_PERCENT = 10
/** 기본 플랫폼 수수료율 5% (영업자별 개별 설정 가능) */
export const DEFAULT_COMMISSION_PERCENT = 5

export interface PlatformFeeInput {
  /** 원가합계 (세액 포함) */
  costTotal: number
  /** 원가세액 */
  costVat: number
  /** 수수료율 %. 기본 5 */
  commissionPercent?: number
  /**
   * 품목별 적립금 제외가 있을 때 사용할 공급가 기준액.
   * 생략하면 기존 규칙대로 `costTotal - costVat`을 쓴다.
   */
  platformFeeBaseSupply?: number
}

/**
 * 적립금(O) = ROUNDUP((원가합계 − 원가세액) × 수수료율, -1)
 *
 * **공급가 기준**이라는 점이 중요하다 — 총액이 아니라 세액을 뺀 금액에 곱한다.
 */
export function calcPlatformFee({
  costTotal,
  costVat,
  commissionPercent = DEFAULT_COMMISSION_PERCENT,
  platformFeeBaseSupply,
}: PlatformFeeInput): number {
  const supplyBase = platformFeeBaseSupply ?? costTotal - costVat
  return percentRoundUpTo10(supplyBase, commissionPercent)
}

export interface WithholdingInput {
  /** 지급액(세전) R */
  preTax: number
  /** 적립금 O — 코파운더의 신고액 산정에 쓰인다 */
  platformFee: number
  partnerType: PartnerType
}

export interface WithholdingResult {
  /** 신고액 V */
  declared: number
  /** 소득세 S */
  incomeTax: number
  /** 지방소득세 T */
  localTax: number
  /** 실지급 U */
  netPay: number
}

/**
 * 신고액(V) → 소득세(S) → 지방소득세(T) → 실지급(U).
 *
 * 두 가지를 혼동하지 말 것:
 * - **세금 계산 기준**은 신고액 V (코파운더는 적립금 포함)
 * - **차감 대상**은 세전 R (적립금은 실지급에 더해지지 않는다)
 *
 * 신고액이 0 이하일 때는 원천징수하지 않는다. 산식을 그대로 적용하면 음수 세금이
 * 나오는데 그건 의미가 없다. 단, 세전이 음수일 때의 처리(0 처리/이월/경고)는
 * docs §11의 **미결 사항**이므로 이 함수는 음수 세전을 그대로 통과시킨다.
 */
export function calcWithholding({
  preTax,
  platformFee,
  partnerType,
}: WithholdingInput): WithholdingResult {
  const declared = partnerType === 'cofounder' ? preTax + platformFee : preTax

  const incomeTax =
    declared > 0 ? percentRoundDownTo10(declared, INCOME_TAX_PERCENT) : 0
  const localTax = incomeTax > 0 ? percentRoundDownTo10(incomeTax, LOCAL_TAX_PERCENT) : 0

  return {
    declared,
    incomeTax,
    localTax,
    netPay: preTax - incomeTax - localTax,
  }
}

export interface SettlementInput extends PlatformFeeInput {
  /** 단가합계 (세액 포함) — 유치원 청구 기준 */
  priceTotal: number
  /** 단가세액 */
  priceVat: number
  partnerType: PartnerType
  /** 사업자공제 Q — 매월 수기 입력. 기본 0 */
  businessDeduction?: number
}

export interface SettlementResult extends WithholdingResult {
  /** 차액(총마진) M */
  margin: number
  /** 적립금 O */
  platformFee: number
  /** 부가세차액 P */
  vatDiff: number
  /** 사업자공제 Q */
  businessDeduction: number
  /**
   * 산식 그대로의 세전 지급액. **음수일 수 있다.**
   * 이월 정책이 정해지면 이 값을 쓴다.
   */
  preTaxRaw: number
  /** 실제 적용된 세전 지급액 R. 음수면 0으로 처리된다. */
  preTax: number
  /** 사람이 확인해야 하는 사항. 비어 있어야 정상. */
  warnings: string[]
}

/**
 * 원천 합계 → 실지급까지 전체 파이프라인.
 *
 * 세전이 음수면 **0으로 처리하고 경고**한다 (2026-07-29 확정, docs §11).
 * 받을 게 없는 달이므로 신고할 사업소득도 없다고 본다 — 코파운더라도 적립금을
 * 신고액에 넣지 않는다. 원래 음수값은 `preTaxRaw`에 남겨 두므로,
 * 나중에 이월 정책이 정해지면 여기서 이어가면 된다.
 */
export function calcSettlement(input: SettlementInput): SettlementResult {
  const {
    costTotal,
    costVat,
    priceTotal,
    priceVat,
    partnerType,
    businessDeduction = 0,
    commissionPercent,
    platformFeeBaseSupply,
  } = input

  const margin = priceTotal - costTotal
  const platformFee = calcPlatformFee({
    costTotal,
    costVat,
    commissionPercent,
    platformFeeBaseSupply,
  })
  const vatDiff = priceVat - costVat
  const preTaxRaw = margin - platformFee - vatDiff - businessDeduction

  const warnings: string[] = []
  const base = { margin, platformFee, vatDiff, businessDeduction, preTaxRaw }

  if (preTaxRaw < 0) {
    // 조용히 0으로 만들면 담당자가 적자를 알아채지 못한다. 반드시 경고를 남긴다.
    warnings.push(
      `세전 지급액이 음수(-${Math.abs(preTaxRaw).toLocaleString()}원)여서 0으로 처리했습니다. 원가·단가와 사업자공제를 확인하세요.`
    )
    return {
      ...base,
      preTax: 0,
      declared: 0,
      incomeTax: 0,
      localTax: 0,
      netPay: 0,
      warnings,
    }
  }

  return {
    ...base,
    preTax: preTaxRaw,
    ...calcWithholding({ preTax: preTaxRaw, platformFee, partnerType }),
    warnings,
  }
}
