import { roundDownTo10 } from './rounding'

/**
 * 계산서 원단위 절사 (docs/systems/settlement.md §6-2).
 *
 * 일부 유치원은 **계산서 총액을 10원 단위로** 받는다. 원 단위가 남으면 회계
 * 처리에서 걸린다는 요청이다 (26년 7월 — 해밀·나래).
 *
 * ★ 기준 (2026-07-31 확정, **세무사 협의로 바뀔 수 있음**)
 *   ① 절사 대상은 **공급가 + 세액을 합친 총액**
 *   ② **계산서 한 장씩 각각** — 유치원 합계를 절사하지 않는다
 *   ③ 차액은 **부가세(세액)에서** 뺀다
 *   ④ 정산(영업자 지급)은 **원값 그대로** — 차액은 본사 몫에서 흡수한다
 *
 * ③을 `mode`로 뽑아 둔 이유: 세무사가 "공급가에서 빼라"고 하면 설정만 바꾸면
 * 되고 코드는 그대로다. `settlement_issuer.invoice_rounding_mode`에 있다.
 *
 * ⚠️ **어느 모드든 `공급가 + 세액 = 총액`은 반드시 성립한다.** 여기가 깨지면
 * 홈택스 업로드가 통째로 반려된다.
 */

/** 차액을 어디서 뺄지 */
export type InvoiceRoundingMode = 'vat' | 'supply'

export interface RoundedInvoice {
  supply: number
  vat: number
  /** 절사 후 총액. 항상 10의 배수 */
  total: number
  /** 깎인 금액 (원). 0 이상 */
  diff: number
}

export function applyInvoiceRounding(
  row: { supply: number; vat: number },
  mode: InvoiceRoundingMode,
  enabled: boolean
): RoundedInvoice {
  const total = row.supply + row.vat

  if (!enabled) {
    return { supply: row.supply, vat: row.vat, total, diff: 0 }
  }

  const rounded = roundDownTo10(total)
  const diff = total - rounded
  if (diff === 0) {
    return { supply: row.supply, vat: row.vat, total, diff: 0 }
  }

  if (mode === 'supply') {
    return { supply: row.supply - diff, vat: row.vat, total: rounded, diff }
  }

  // 기본: 세액에서 뺀다. 공급가는 실제 거래금액이라 건드리지 않는다.
  //
  // 단, **면세는 세액이 0**이라 뺄 게 없다. 세액을 음수로 만들면 홈택스가
  // 거부하므로, 모자란 만큼은 공급가에서 뺀다 — 총액을 맞추는 쪽이 우선이다.
  const fromVat = Math.min(row.vat, diff)
  return {
    supply: row.supply - (diff - fromVat),
    vat: row.vat - fromVat,
    total: rounded,
    diff,
  }
}
