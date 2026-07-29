/**
 * 사업자공제(Q) 상세 — docs/systems/settlement.md §3
 *
 * 산식에서 Q는 "매월 수기 입력 (커피차 등 부가서비스 비용)"이다.
 * 기존 엑셀은 `집계표_정산용` Q열에 `커피차`라고만 적어 뒀고 **금액 내역은 남지 않았다**.
 * 항목을 구조화해 무엇 때문에 얼마가 공제됐는지 남긴다.
 *
 * 항목 합계가 곧 산식의 Q다 — 돈 계산이므로 반올림하지 않고 그대로 더한다.
 */

/** 운영에서 실제로 쓰는 공제 항목 (2026-07-30 확정) */
export const DEDUCTION_CATEGORIES = [
  '커피차',
  '원아 간식',
  '요리실습 재료',
  '대형매트',
  '조리사 대체인력',
] as const

export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number]

export interface DeductionItem {
  /** 공제 항목. 목록 외 값도 허용한다 — 새 항목이 생겨도 코드 수정 없이 기록되게. */
  category: string
  amount: number
  /** 구체 내용 (예: `6월 2회`) */
  note?: string
}

/** 항목 합계 = 산식의 Q */
export function sumDeductionItems(items: readonly DeductionItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

/**
 * 외부 입력(폼·JSON)을 정리한다.
 *
 * 금액 0이나 항목명이 빈 줄은 **버린다** — 화면에서 줄만 추가하고 안 채운 경우다.
 * 이걸 남기면 공제 상세 시트에 빈 줄이 쌓인다.
 * 음수는 허용한다 (환입·정정 여지를 코드가 막지 않도록).
 */
export function normalizeDeductionItems(raw: unknown): DeductionItem[] {
  if (!Array.isArray(raw)) return []

  const out: DeductionItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>

    const category = typeof row.category === 'string' ? row.category.trim() : ''
    if (!category) continue

    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
    if (!Number.isFinite(amount) || amount === 0) continue

    const noteRaw = typeof row.note === 'string' ? row.note.trim() : ''
    out.push(noteRaw ? { category, amount, note: noteRaw } : { category, amount })
  }
  return out
}

export interface PartnerDeductions {
  partnerName: string
  items: DeductionItem[]
}

export interface DeductionSheet {
  rows: unknown[][]
}

/**
 * 내역서에 함께 넣을 `사업자공제 상세` 시트.
 *
 * 왜 필요한가: 화면에서 입력한 항목별 내역이 다운로드하면 사라지면, 다음 달에
 * "지난달 공제 1,696,500이 뭐였지?"를 답할 수 없다. Q 합계만으로는 근거가 남지 않는다.
 */
export function buildDeductionSheet(
  partners: readonly PartnerDeductions[]
): DeductionSheet {
  const rows: unknown[][] = [['영업자', '항목', '금액', '비고']]
  let grand = 0

  for (const p of partners) {
    if (p.items.length === 0) continue // 공제 없는 영업자는 줄을 만들지 않는다

    for (const [i, item] of p.items.entries()) {
      rows.push([
        i === 0 ? p.partnerName : undefined,
        item.category,
        item.amount,
        item.note,
      ])
    }
    const subtotal = sumDeductionItems(p.items)
    rows.push([undefined, '계', subtotal, undefined])
    grand += subtotal
  }

  rows.push(['합계', undefined, grand, undefined])
  return { rows }
}
