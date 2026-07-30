import { describe, it, expect } from 'vitest'
import { rollupByKindergarten, rollupBySource, type ClosingVenueRow } from '@/features/settlement'

/**
 * [정산] 경영 보고서 집계 (docs §13-2 ①)
 *
 * 마감 스냅샷의 **식당 단위** 행을 **유치원 단위**·**공급사 단위**로 묶는다.
 *
 * ⚠️ 정산제외 사업장(본사 마케팅비)은 매출에 넣지 않는다 — 계산서를 발행하지
 * 않으므로 매출이 아니다 (docs §13-4). 대신 따로 세어 보고서에 보여준다.
 */

const zero = { taxableSupply: 0, vat: 0, exempt: 0, total: 0 }

function venue(over: Partial<ClosingVenueRow> = {}): ClosingVenueRow {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: '1000',
    restaurantName: '키즈웰에듀푸드(해밀유치원)',
    companyName: '해밀유치원',
    partnerId: 'p-kim',
    partnerName: '김중영',
    isExcluded: false,
    exclusionReason: null,
    cost: { ...zero },
    price: { ...zero },
    ...over,
  }
}

describe('rollupByKindergarten', () => {
  it('같은 사업장의 식당을 하나로 묶는다', () => {
    const rows = rollupByKindergarten([
      venue({
        restaurantCode: '1000',
        cost: { taxableSupply: 0, vat: 100, exempt: 0, total: 1_000 },
        price: { taxableSupply: 0, vat: 200, exempt: 0, total: 2_000 },
      }),
      venue({
        restaurantCode: '1001',
        cost: { taxableSupply: 0, vat: 50, exempt: 0, total: 500 },
        price: { taxableSupply: 0, vat: 80, exempt: 0, total: 900 },
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'cj',
      businessCode: '1005',
      restaurantCount: 2,
      costTotal: 1_500,
      priceTotal: 2_900,
      margin: 1_400,
    })
  })

  it('원천이 다르면 별개 행이다 — 코드 체계가 다르다', () => {
    const rows = rollupByKindergarten([
      venue({ source: 'cj', businessCode: '1005' }),
      venue({ source: 'shinsegae', businessCode: '1005' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('과세·면세를 나눠 담는다', () => {
    const rows = rollupByKindergarten([
      venue({
        price: { taxableSupply: 33_182_420, vat: 3_318_242, exempt: 65_846_245, total: 102_346_907 },
        cost: { taxableSupply: 0, vat: 2_412_330, exempt: 0, total: 73_999_061 },
      }),
    ])
    expect(rows[0]).toMatchObject({
      priceTaxableSupply: 33_182_420,
      priceVat: 3_318_242,
      priceExempt: 65_846_245,
      costVat: 2_412_330,
    })
  })

  it('마진율은 매출 대비다 (26년 6월 27.7%)', () => {
    const rows = rollupByKindergarten([
      venue({
        cost: { ...zero, total: 73_999_061 },
        price: { ...zero, total: 102_346_907 },
      }),
    ])
    // 28,347,846 / 102,346,907 = 0.27697…
    expect(rows[0]!.marginRate).toBeCloseTo(0.277, 3)
  })

  it('매출이 0이면 마진율은 0이다 (0으로 나누지 않는다)', () => {
    const rows = rollupByKindergarten([venue()])
    expect(rows[0]!.marginRate).toBe(0)
  })

  it('청구액이 큰 순으로 정렬한다 — 보고서는 큰 것부터 본다', () => {
    const rows = rollupByKindergarten([
      venue({ businessCode: 'A', price: { ...zero, total: 100 } }),
      venue({ businessCode: 'B', price: { ...zero, total: 300 } }),
      venue({ businessCode: 'C', price: { ...zero, total: 200 } }),
    ])
    expect(rows.map((r) => r.businessCode)).toEqual(['B', 'C', 'A'])
  })

  it('정산제외 사업장은 따로 표시한다 (매출이 아니다)', () => {
    const rows = rollupByKindergarten([
      venue({ businessCode: '1005', price: { ...zero, total: 2_000 } }),
      venue({
        source: 'shinsegae',
        businessCode: '88689',
        businessName: '키즈웰에듀푸드(본사)',
        companyName: null,
        isExcluded: true,
        exclusionReason: '마케팅비',
        partnerId: null,
        partnerName: null,
        cost: { ...zero, total: 9_955 },
        price: { ...zero, total: 12_925 },
      }),
    ])
    const excluded = rows.find((r) => r.isExcluded)
    expect(excluded).toMatchObject({
      businessCode: '88689',
      exclusionReason: '마케팅비',
      costTotal: 9_955,
    })
    // 계산서 상호가 없으면 원천 사업장명을 보여준다
    expect(excluded!.label).toBe('키즈웰에듀푸드(본사)')
  })

  it('계산서 상호가 있으면 그걸 보여준다 — 원천 사업장명보다 읽기 쉽다', () => {
    const rows = rollupByKindergarten([venue()])
    expect(rows[0]!.label).toBe('해밀유치원')
    expect(rows[0]!.businessName).toBe('키즈웰에듀푸드(해밀유치원)')
  })

  it('담당 영업자 이름을 함께 보여준다', () => {
    const rows = rollupByKindergarten([venue({ partnerName: '김중영' })])
    expect(rows[0]!.partnerName).toBe('김중영')
  })

  it('같은 사업장에 담당자가 섞여 있으면 첫 값을 쓴다', () => {
    // 사업장 = 유치원 1곳이므로 담당자는 하나다. 섞였다면 마스터 불정합이고
    // 마감 게이트에서 이미 걸렸어야 한다 — 보고서가 임의로 판단하지 않는다.
    const rows = rollupByKindergarten([
      venue({ restaurantCode: '1000', partnerName: '김중영' }),
      venue({ restaurantCode: '1001', partnerName: '이동현' }),
    ])
    expect(rows[0]!.partnerName).toBe('김중영')
  })
})

describe('rollupBySource', () => {
  it('공급사별로 매입·매출을 나눈다', () => {
    const r = rollupBySource([
      venue({
        source: 'cj',
        cost: { ...zero, total: 1_000 },
        price: { ...zero, total: 1_500 },
      }),
      venue({
        source: 'shinsegae',
        businessCode: '89890',
        cost: { ...zero, total: 2_000 },
        price: { ...zero, total: 2_600 },
      }),
    ])
    expect(r.cj).toMatchObject({ costTotal: 1_000, priceTotal: 1_500, margin: 500 })
    expect(r.shinsegae).toMatchObject({ costTotal: 2_000, priceTotal: 2_600, margin: 600 })
  })

  it('정산제외 사업장의 매입은 공급사 매입에 포함한다 — 실제로 사온 것이다', () => {
    // 본사 마케팅비도 신세계에서 사온 물건이다. 매입 통계에서 빼면 공급사와
    // 대조가 안 맞는다. 매출만 제외한다.
    const r = rollupBySource([
      venue({
        source: 'shinsegae',
        businessCode: '88689',
        isExcluded: true,
        cost: { ...zero, total: 9_955 },
        price: { ...zero, total: 12_925 },
      }),
    ])
    expect(r.shinsegae.costTotal).toBe(9_955)
    expect(r.shinsegae.priceTotal).toBe(0)
    expect(r.shinsegae.excludedCost).toBe(9_955)
  })

  it('제외된 매출액도 따로 세어 보여준다 — 얼마가 빠졌는지 숫자로 확인할 수 있어야 한다', () => {
    const r = rollupBySource([
      venue({
        source: 'shinsegae',
        businessCode: '88689',
        isExcluded: true,
        cost: { ...zero, total: 9_955 },
        price: { ...zero, total: 12_925 },
      }),
    ])
    expect(r.shinsegae.excludedPrice).toBe(12_925)
  })

  it('제외 사업장이 없으면 제외 금액은 0이다', () => {
    const r = rollupBySource([venue({ price: { ...zero, total: 100 } })])
    expect(r.cj.excludedCost).toBe(0)
    expect(r.cj.excludedPrice).toBe(0)
  })

  it('식당 수를 센다', () => {
    const r = rollupBySource([
      venue({ source: 'cj', restaurantCode: '1000' }),
      venue({ source: 'cj', restaurantCode: '1001' }),
      venue({ source: 'shinsegae', businessCode: '89890', restaurantCode: '01' }),
    ])
    expect(r.cj.restaurantCount).toBe(2)
    expect(r.shinsegae.restaurantCount).toBe(1)
  })

  it('빈 입력도 두 원천을 0으로 돌려준다 — 화면이 분기하지 않게 한다', () => {
    const r = rollupBySource([])
    expect(r.cj.costTotal).toBe(0)
    expect(r.shinsegae.costTotal).toBe(0)
  })
})
