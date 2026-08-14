import { describe, it, expect } from 'vitest'
import { applyPeriodPrices } from '@/features/shared/price-book/apply'

/**
 * [비교] 세션 기준월 단가로 치환 (docs/systems/comparison.md §9)
 *
 * ★ **왜 필요한가** — `products`가 5/9 이후 갱신되지 않아 8월 단가표와 대조하니
 * **16.4%(1,235개)가 틀렸다.** 그 중 943개는 실제로 올랐는데 낡은 낮은 단가가
 * 남아 있어 **절감액이 과대 계상**된다.
 *
 * ★ **여기서 바꾸는 건 단가뿐이다.** 매칭 후보 검색은 `products`(임베딩·
 * search_vector)로 하고, 가격만 그 달 단가표에서 덮는다. 임베딩은 품목명에서
 * 나오고 품목명은 달마다 안 바뀐다 — 월별로 복제할 이유가 없다.
 *
 * ⚠️ **`period`가 없으면 한 건도 건드리지 않는다.** 기존 세션 233개는 지금까지의
 * 절감액을 그대로 유지해야 한다 (2026-08-14 결정) — 이미 제출한 제안서의 숫자가
 * 나중에 바뀌면 안 된다.
 */

const rows = [
  { product_code: '902769', product_name: '무농약 찹쌀', standard_price: 8000 },
  { product_code: '017392', product_name: '세척당근', standard_price: 2340 },
  { product_code: '999999', product_name: '단종품', standard_price: 5000 },
  { product_code: null, product_name: '코드없음', standard_price: 100 },
]

/** 8월 단가표 — 902769는 올랐고, 017392는 그대로, 999999는 카탈로그에 없다 */
const august = new Map([
  ['902769', { price: 8140 }],
  ['017392', { price: 2340 }],
])

describe('applyPeriodPrices — 기준월 단가로 덮기', () => {
  it('기준월이 없으면 한 건도 건드리지 않는다', () => {
    const out = applyPeriodPrices(rows, null)
    expect(out.map((r) => r.standard_price)).toEqual([8000, 2340, 5000, 100])
    // ⚠️ 배지도 붙이지 않는다 — 기존 화면에 없던 표시가 생기면 안 된다
    expect(out.every((r) => r.priceBookMissing === undefined)).toBe(true)
  })

  it('그 달 단가로 덮는다', () => {
    const out = applyPeriodPrices(rows, august)
    expect(out[0].standard_price).toBe(8140) // 8,000 → 8,140 (올랐다)
    expect(out[1].standard_price).toBe(2340) // 그대로
  })

  it('그 달에 없는 품목은 원래 값을 두고 표시만 남긴다', () => {
    const out = applyPeriodPrices(rows, august)
    // ⚠️ 후보에서 버리지 않는다 (comparison.md §4) — 버리면 검수자가 손으로도 못 고른다
    expect(out[2].standard_price).toBe(5000)
    expect(out[2].priceBookMissing).toBe(true)
    expect(out[0].priceBookMissing).toBe(false)
  })

  it('품목코드가 없으면 찾을 수 없으니 표시한다', () => {
    const out = applyPeriodPrices(rows, august)
    expect(out[3].standard_price).toBe(100)
    expect(out[3].priceBookMissing).toBe(true)
  })

  it('원본 배열을 바꾸지 않는다', () => {
    const copy = rows.map((r) => ({ ...r }))
    applyPeriodPrices(rows, august)
    expect(rows).toEqual(copy)
  })

  it('빈 단가표는 전부 미확인으로 둔다 — 조용히 0원이 되면 안 된다', () => {
    const out = applyPeriodPrices(rows, new Map())
    expect(out.map((r) => r.standard_price)).toEqual([8000, 2340, 5000, 100])
    expect(out.every((r) => r.priceBookMissing === true)).toBe(true)
  })
})
