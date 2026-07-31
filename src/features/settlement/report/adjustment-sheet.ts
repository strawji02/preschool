import type { AdjustmentRecord } from '../data/adjustment'

/**
 * 조정 내역 시트 — docs/systems/settlement/조정.md §19
 *
 * 두 군데에 같은 형태로 붙는다:
 * - **정산 내역서** — 영업자에게 "지급액이 왜 줄었는지" 설명한다
 * - **유치원 제공 거래명세표** — "명세표보다 청구액이 왜 적은지" 설명한다
 *
 * 조정은 우리가 판단해서 뺀 것이라, 근거(사유·요청자)가 문서에 남지 않으면
 * 나중에 아무도 설명하지 못한다. 그래서 금액만이 아니라 **사유와 요청자를
 * 그대로 싣는다.**
 */

export interface AdjustmentSheet {
  rows: (string | number)[][]
  /** 청구에서 실제로 빠진 금액 — **제외분만**. 이동은 사업장 합계를 바꾸지 않는다. */
  excludedTotal: number
}

const HEADER = [
  '처리',
  '날짜',
  '식당',
  '이동 대상',
  '상품코드',
  '품목',
  '수량',
  '단위',
  '금액',
  '사유',
  '요청자',
]

/**
 * @param amountById 조정별 금액. 산식(`adjustmentAmount`)이 계산한 값을 그대로 받는다 —
 *   시트가 금액을 다시 계산하면 화면과 문서가 갈라질 수 있다.
 */
export function buildAdjustmentSheet(
  adjustments: readonly AdjustmentRecord[],
  amountById: Record<string, number>
): AdjustmentSheet | null {
  // 빈 시트를 붙이지 않는다 — "조정 내역"이라는 빈 장이 있으면 뭔가 누락된 줄 안다
  if (adjustments.length === 0) return null

  const rows: (string | number)[][] = [HEADER]
  let excludedTotal = 0

  for (const a of adjustments) {
    const amount = amountById[a.id] ?? 0
    if (a.kind === 'exclude') excludedTotal += amount

    rows.push([
      a.kind === 'exclude' ? '정산 제외' : '식당 이동',
      a.itemDate,
      a.restaurantName,
      a.targetRestaurantName ?? '',
      a.productCode,
      a.productName,
      a.quantity,
      a.unit,
      amount,
      a.reason,
      a.requestedBy,
    ])
  }

  rows.push([])
  rows.push(['청구에서 제외된 합계', '', '', '', '', '', '', '', excludedTotal, '', ''])

  return { rows, excludedTotal }
}

/** 열 너비 — 품목·사유가 길어서 넉넉히 준다 */
export const ADJUSTMENT_COL_WIDTHS = [10, 12, 30, 24, 10, 34, 8, 6, 12, 26, 10]
