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

/**
 * 지난달 분할 명의를 이번 달 신고액에 맞춰 이어받는다 (docs §4).
 *
 * ★ **명의는 그대로, 금액은 다시 나눈다.** 매달 같은 사람들에게 나눠 신고하는데
 * 신고액은 달마다 다르다. 지난달 금액을 그대로 가져오면 합계가 안 맞아 마감이
 * 막히고, 사용자가 계산기를 두드려야 한다.
 *
 * ⚠️ **합계는 신고액과 1원도 어긋나면 안 된다.** 비율 배분에서 생기는 반올림
 * 차액은 첫 행이 흡수한다. 지난달 합계가 0이면 첫 명의에 전액을 넣는다.
 */
export function carryOverSplits(
  previous: readonly DeclarationSplit[],
  declared: number
): DeclarationSplit[] {
  if (previous.length === 0) return []

  const prevTotal = previous.reduce((sum, s) => sum + s.amount, 0)
  if (prevTotal <= 0) {
    return previous.map((s, i) => ({ name: s.name, amount: i === 0 ? declared : 0 }))
  }

  const out = previous.map((s) => ({
    name: s.name,
    amount: Math.round((s.amount / prevTotal) * declared),
  }))
  const diff = declared - out.reduce((sum, s) => sum + s.amount, 0)
  out[0].amount += diff
  return out
}
