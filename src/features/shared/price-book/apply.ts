/**
 * 세션 기준월 단가로 치환 — docs/systems/comparison.md §9
 *
 * ★ **왜** — `products`가 5/9 이후 갱신되지 않아 8월 단가표와 16.4%(1,235개)가
 * 어긋났다. 그 중 943개는 실제로 올랐는데 낡은 낮은 단가가 남아 **절감액이 과대
 * 계상**된다.
 *
 * ★ **바꾸는 건 단가뿐이다.** 매칭 후보 검색은 `products`(임베딩·search_vector·
 * ppu·규격파싱)로 하고 가격만 그 달 단가표에서 덮는다. 임베딩은 품목명에서
 * 나오고 품목명은 달마다 안 바뀐다 — 월별로 복제할 이유가 없다.
 *
 * ★ **여기는 순수 함수다.** 단가표 조회는 `withPeriodPrices`가 하고, 이 함수는
 * 이미 읽어 온 맵만 받는다. 그래야 DB 없이 테스트할 수 있다.
 */

export interface PricedRow {
  /** 6자리 0채움. 없으면 단가표에서 찾을 수 없다 */
  product_code?: string | null
  standard_price: number
}

/**
 * 기준월 단가로 덮는다.
 *
 * ⚠️ **`lookup`이 null이면 한 건도 건드리지 않는다.** 기존 세션 233개는 지금까지의
 * 절감액을 그대로 유지해야 한다 (2026-08-14 결정) — 이미 제출한 제안서의 숫자가
 * 나중에 바뀌면 안 된다. 배지도 붙이지 않는다.
 *
 * ⚠️ **그 달에 없는 품목을 버리지 않는다** (comparison.md §4 원칙).
 * 원래 단가를 두고 `priceBookMissing`만 세운다 — 버리면 검수자가 손으로도 못
 * 고르고, 0원으로 두면 절감액이 조용히 부풀려진다.
 */
export function applyPeriodPrices<T extends PricedRow>(
  rows: readonly T[],
  lookup: ReadonlyMap<string, { price: number }> | null
): (T & { priceBookMissing?: boolean })[] {
  if (!lookup) return rows.map((r) => ({ ...r }))

  return rows.map((r) => {
    const code = r.product_code ?? ''
    const found = code ? lookup.get(code) : undefined
    return {
      ...r,
      standard_price: found ? found.price : r.standard_price,
      priceBookMissing: !found,
    }
  })
}
