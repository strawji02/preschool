/**
 * 분할 신고 검증 (docs/systems/settlement.md §4)
 *
 * 한 영업자의 사업소득을 여러 명 명의로 나눠 신고하는 운영을 지원한다.
 * 배분은 수기 입력이고, **분할 합계 == 신고액(V)** 이 아니면 월 마감을 차단해야 한다.
 *
 * 실제 사례(26년 6월):
 *   이동현 13,490,317 → 이동현 4,490,317 + 김인순 5,000,000 + 이유나 4,000,000
 */

export interface DeclarationSplit {
  /** 신고 명의자 성명 */
  name: string
  /** 배분 금액 */
  amount: number
}

export interface SplitValidationResult {
  /** 분할 금액 합계 */
  total: number
  /** 합계 − 신고액. 양수면 초과, 음수면 부족 */
  diff: number
  /** 마감 가능 여부 — 1원이라도 어긋나면 false */
  valid: boolean
}

/**
 * 분할 합계가 신고액과 정확히 일치하는지 검증한다.
 *
 * 원 단위 정수를 다루므로 오차 허용치를 두지 않는다. 1원 차이도 불일치다 —
 * 세무 신고 금액이라 반올림으로 넘길 수 없다.
 */
export function validateSplitDeclaration(
  declared: number,
  splits: readonly DeclarationSplit[]
): SplitValidationResult {
  const total = splits.reduce((sum, split) => sum + split.amount, 0)
  const diff = total - declared

  return { total, diff, valid: diff === 0 }
}
