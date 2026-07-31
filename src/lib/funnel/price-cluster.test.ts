import { describe, it, expect } from 'vitest'
import {
  getCategoryTolerance,
  calculatePriceRange,
  clusterByPrice,
  mergeClusters,
  calculatePriceDeviation,
  type DBProduct,
} from './price-cluster'
import type { InvoiceItem } from './excel-parser'

/**
 * [비교] 단가 범위로 후보 거르기 (docs/systems/comparison.md §4)
 *
 * ★ 원래 `console.log` + `npx tsx` 수동 스크립트였다. 2026-07-31 vitest로 옮겼다.
 * 옮긴 배경은 `price-normalizer.test.ts` 주석 참조.
 *
 * 이 모듈은 `matching.ts`가 쓰는 **운영 코드**다. 범위를 잘못 잡으면 맞는 상품이
 * 후보에서 빠지거나(비교불가), 엉뚱한 상품이 추천된다(오매칭).
 *
 * 품목군마다 허용 오차가 다른 이유: 농산물은 계절 변동이 커서 ±40%까지 같은
 * 물건일 수 있지만, 가공품이 ±40% 차이나면 다른 물건이다.
 */

function item(over: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    rowNumber: 1,
    itemName: '양파',
    spec: '1kg',
    quantity: 10,
    unitPrice: 5000, // 5원/g
    amount: 50000,
    ...over,
  } as InvoiceItem
}

/** 양파 1kg 5000원(=5원/g) 기준, 농산물 ±40% → 3~7원/g */
const 농산물후보: DBProduct[] = [
  { id: '1', name: '양파', spec: '1kg', price: 5000, category: '농산물' }, // 5원/g 내
  { id: '2', name: '양파', spec: '1kg', price: 7000, category: '농산물' }, // 7원/g 내
  { id: '3', name: '양파', spec: '1kg', price: 10000, category: '농산물' }, // 10원/g 외
  { id: '4', name: '양파', spec: '1kg', price: 2000, category: '농산물' }, // 2원/g 외
]

describe('getCategoryTolerance — 품목군별 허용 오차', () => {
  it.each([
    ['농산물', 40],
    ['축산물', 25],
    ['가공품', 20],
    ['알 수 없음', 30],
  ])('%s → ±%i%%', (category, expected) => {
    expect(getCategoryTolerance(category)).toBe(expected)
  })
})

describe('calculatePriceRange — 허용 범위', () => {
  it('47원/g 농산물 → 28.2~65.8', () => {
    const r = calculatePriceRange(47, '농산물')
    expect(r.min).toBeCloseTo(28.2, 1)
    expect(r.max).toBeCloseTo(65.8, 1)
  })

  it('100원/g 축산물 → 75~125', () => {
    expect(calculatePriceRange(100, '축산물')).toMatchObject({ min: 75, max: 125 })
  })

  it('50원/g 가공품 → 40~60', () => {
    expect(calculatePriceRange(50, '가공품')).toMatchObject({ min: 40, max: 60 })
  })
})

describe('clusterByPrice — 범위 내/외 분류', () => {
  it('농산물 ±40%', () => {
    const r = clusterByPrice(item(), 농산물후보)
    expect(r.inRange.map((p) => p.id)).toEqual(['1', '2'])
    expect(r.outRange.map((p) => p.id)).toEqual(['3', '4'])
  })

  it('축산물 ±25% — 더 좁다', () => {
    const r = clusterByPrice(
      item({ itemName: '소고기', spec: '100g', unitPrice: 10000 }), // 100원/g
      [
        { id: '1', name: '소고기', spec: '100g', price: 10000, category: '축산물' },
        { id: '2', name: '소고기', spec: '100g', price: 12000, category: '축산물' },
        { id: '3', name: '소고기', spec: '100g', price: 13000, category: '축산물' },
        { id: '4', name: '소고기', spec: '100g', price: 7000, category: '축산물' },
      ]
    )
    expect(r.inRange).toHaveLength(2)
    expect(r.outRange).toHaveLength(2)
  })

  it('가공품 ±20% — 가장 좁다', () => {
    const r = clusterByPrice(
      item({ itemName: '라면', spec: '120g', unitPrice: 6000 }), // 50원/g
      [
        { id: '1', name: '라면', spec: '120g', price: 6000, category: '가공품' },
        { id: '2', name: '라면', spec: '120g', price: 7000, category: '가공품' },
        { id: '3', name: '라면', spec: '120g', price: 8000, category: '가공품' },
        { id: '4', name: '라면', spec: '120g', price: 4000, category: '가공품' },
      ]
    )
    expect(r.inRange).toHaveLength(2)
    expect(r.outRange).toHaveLength(2)
  })

  it('규격을 못 읽으면 전부 범위 밖 — 버리지 않는다', () => {
    // 후보에서 아예 제외하면 검수자가 손으로도 못 고른다. 순위만 뒤로 민다.
    const r = clusterByPrice(item({ spec: '알수없음' }), 농산물후보)
    expect(r.inRange).toHaveLength(0)
    expect(r.outRange).toHaveLength(농산물후보.length)
  })

  it('후보가 없으면 빈 결과', () => {
    const r = clusterByPrice(item(), [])
    expect(r.inRange).toHaveLength(0)
    expect(r.outRange).toHaveLength(0)
  })
})

describe('mergeClusters — 범위 내를 앞에 둔다', () => {
  it('하나도 버리지 않고 순서만 바꾼다', () => {
    const clustered = clusterByPrice(item(), 농산물후보)
    const merged = mergeClusters(clustered)
    expect(merged).toHaveLength(4)
    expect(merged.slice(0, 2).map((p) => p.id)).toEqual(['1', '2'])
  })
})

describe('calculatePriceDeviation — 편차(%)', () => {
  it('비쌀 때는 양수', () => {
    expect(calculatePriceDeviation(100, 120)).toBe(20)
  })

  it('쌀 때는 음수 — clamp 하지 않는다', () => {
    // 음수를 0으로 만들면 "손해 본 품목"이 안 보인다 (docs §4 per-item 반올림 규칙과 같은 취지)
    expect(calculatePriceDeviation(100, 80)).toBe(-20)
  })
})
