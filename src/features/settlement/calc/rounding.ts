/**
 * 정산 산식의 반올림 헬퍼.
 *
 * ⚠️ 산식은 실제 운영 엑셀 수식에서 추출한 것이므로 **Excel과 동일한 시맨틱**이어야 한다.
 * Excel의 ROUNDDOWN/ROUNDUP은 **0을 기준**으로 절단/확대한다:
 *   ROUNDDOWN(-3642, -1) = -3640   (0 방향)
 *   ROUNDUP(-3642, -1)   = -3650   (0 반대방향)
 * JS `Math.floor`/`Math.ceil`은 −∞/+∞ 방향이라 음수에서 결과가 달라진다. 그대로 쓰면 안 된다.
 *
 * @see docs/systems/settlement.md §3
 */

/** Excel `ROUNDUP(value, -1)` — 10원 단위 올림 (0 반대방향) */
export function roundUpTo10(value: number): number {
  const sign = value < 0 ? -1 : 1
  return sign * Math.ceil(Math.abs(value) / 10) * 10
}

/** Excel `ROUNDDOWN(value, -1)` — 10원 단위 내림 (0 방향 절단) */
export function roundDownTo10(value: number): number {
  return Math.trunc(value / 10) * 10
}

/**
 * `amount × percent%` 를 10원 단위로 올림. 적립금(O) 계산용.
 *
 * `amount * percent / 100` 을 먼저 부동소수로 만들지 않고 정수 분자를 유지한 뒤 나눈다.
 * 원 단위 금액에서 경계값(예: 정확히 x.05원)이 FP 오차로 뒤집히는 것을 막기 위함.
 */
export function percentRoundUpTo10(amount: number, percent: number): number {
  const numerator = amount * percent // 정수 입력이면 정수
  if (numerator === 0) return 0
  const sign = numerator < 0 ? -1 : 1
  const abs = Math.abs(numerator)
  // ceil(abs / 1000) — 정수 나눗셈으로 정확히
  return sign * Math.ceil(abs / 1000) * 10
}

/** `amount × percent%` 를 10원 단위로 내림. 소득세·지방소득세 계산용. */
export function percentRoundDownTo10(amount: number, percent: number): number {
  const numerator = amount * percent
  return Math.trunc(numerator / 1000) * 10
}
