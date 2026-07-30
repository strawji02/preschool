/**
 * 사업자등록번호 검증 (docs/systems/settlement.md §14-4)
 *
 * 계산서에 그대로 찍히는 번호라 오타가 나면 발행이 실패하거나 엉뚱한 사업자에게 간다.
 * 국세청 체크섬으로 **입력 시점에** 막는다.
 *
 * 규칙: 가중치 `[1,3,7,1,3,7,1,3,5]`를 앞 9자리에 곱하고,
 * **9번째 자리 × 5의 십의 자리를 추가로 더한** 뒤
 * `(10 − 합 % 10) % 10` 이 마지막 자리(검증번호)와 같아야 한다.
 *
 * 실측(2026-07-30): 26년 6월 실제 17개(유치원 16 + 본사) 전부 통과,
 * 한 자리 오타 1,530가지 **100% 검출**.
 *
 * ⚠️ 체크섬은 **형식 검증**이다. 실제로 존재하는 사업자인지, 폐업했는지는 알 수 없다.
 * 그건 국세청 진위확인 API(공공데이터포털)가 필요하고 현재는 쓰지 않는다.
 */

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const

/** 하이픈·공백 등 숫자가 아닌 문자를 모두 제거한다 */
export function normalizeBizRegNo(input: string): string {
  return input.replace(/\D/g, '')
}

export function isValidBizRegNo(input: string): boolean {
  const digits = normalizeBizRegNo(input)
  if (digits.length !== 10) return false

  const d = [...digits].map(Number)

  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += d[i]! * WEIGHTS[i]!
  }
  // 9번째 자리에 5를 곱한 값의 십의 자리를 한 번 더 더한다.
  // 이 단계를 빼면 절반 정도가 잘못 통과한다.
  sum += Math.floor((d[8]! * 5) / 10)

  return (10 - (sum % 10)) % 10 === d[9]
}

/** 화면 표시용 `831-05-03575`. 10자리가 아니면 입력 중일 수 있으니 원본을 돌려준다. */
export function formatBizRegNo(input: string): string {
  const digits = normalizeBizRegNo(input)
  if (digits.length !== 10) return input
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}
