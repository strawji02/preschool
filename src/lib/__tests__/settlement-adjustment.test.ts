import { describe, it, expect } from 'vitest'
import {
  adjustmentAmount,
  adjustmentVenueKey,
  applyAdjustments,
  defaultAdjustmentReason,
  type StoredAdjustment,
} from '@/features/settlement/calc/adjustment'
import type { CjStatementItem } from '@/features/settlement/parse/cj-statement'
import type { NormalizedVenue } from '@/features/settlement/parse/types'

/**
 * [정산] 품목 단위 조정 (docs/systems/settlement/조정.md §18)
 *
 * ★ 왜 필요한가 — CJ 집계표가 **먼저 확정된 뒤에** 영업파트너의 본인부담 요청이 온다.
 * 집계표를 매번 재발행받으면 마감이 CJ 일정에 묶이므로, 원천은 그대로 두고
 * **우리 쪽에 조정으로 기록**한다. 원천(사실)과 조정(정책)이 분리돼 남는다.
 *
 * 26년 7월 실제 3건:
 *   ① 아름솔 7/6 명품 순두부 13,840  정산제외(본인부담)
 *   ② 아름솔 7/8 사과 12개 중 9개    방과후간식으로 이동
 *   ③ 우성  7/6 백김치 13,270       정산제외(본인부담)
 *
 * ★ **단가에서만 뺀다.** 품목별 원가를 알 수 없고(역산 0/14 확인, §5-2), 물건은
 * 이미 납품돼 원가는 CJ에 그대로 나간다. 그래서 차액 M이 줄어 **영업파트너가
 * 부담**하고, 적립금 O는 원가 기준이라 불변이라 **본사는 부담하지 않는다**.
 */

function item(over: Partial<CjStatementItem> = {}): CjStatementItem {
  return {
    date: '2026-07-06',
    businessName: '키즈웰(아름솔)',
    restaurantName: '키즈웰(아름솔)',
    productCode: '386323',
    productName: '명품 순두부(3Kg/EA)',
    origin: '',
    unit: 'EA',
    quantity: 1,
    unitPrice: 13840,
    tax: { taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 },
    ...over,
  }
}

/** 사과 — 12개 @25,100, 면세 */
const 사과 = item({
  date: '2026-07-08',
  productCode: '260294',
  productName: '아이누리 사과(1Kg/EA)',
  quantity: 12,
  unitPrice: 25100,
  tax: { taxableSupply: 0, vat: 0, exempt: 301200, total: 301200 },
})

/** 과세 품목 — 2개 @1,190 = 2,380 + 부가세 238 */
const 부침가루 = item({
  productCode: '100358',
  productName: '백설 부침가루(1Kg/EA)',
  quantity: 2,
  unitPrice: 1190,
  tax: { taxableSupply: 2380, vat: 238, exempt: 0, total: 2618 },
})

function venue(restaurantName: string, price: NormalizedVenue['price']): NormalizedVenue {
  return {
    source: 'cj',
    businessCode: '1013',
    businessName: '키즈웰(아름솔)',
    restaurantCode: '1000',
    restaurantName,
    cost: { taxableSupply: 0, vat: 0, exempt: 1000000, total: 1000000 },
    price,
  }
}

function adj(over: Partial<StoredAdjustment> = {}): StoredAdjustment {
  return {
    id: 'a1',
    kind: 'exclude',
    businessName: '키즈웰(아름솔)',
    restaurantName: '키즈웰(아름솔)',
    itemDate: '2026-07-06',
    productCode: '386323',
    quantity: 1,
    targetRestaurantName: null,
    reason: '본인부담 요청',
    requestedBy: '김영수',
    ...over,
  }
}

describe('adjustmentAmount — 조정 금액', () => {
  it('전량 제외는 원천 라인 금액을 그대로 쓴다 — 반올림 오차가 없어야 한다', () => {
    expect(adjustmentAmount(item(), 1)).toEqual({
      taxableSupply: 0,
      vat: 0,
      exempt: 13840,
      total: 13840,
    })
  })

  it('★ 12개 중 9개 — 단가 × 수량', () => {
    // 25,100 × 9 = 225,900. 원천에서 단가×주문량=공급가가 2,006행 전부 정확함을 확인했다.
    expect(adjustmentAmount(사과, 9)).toEqual({
      taxableSupply: 0,
      vat: 0,
      exempt: 225900,
      total: 225900,
    })
  })

  it('과세 품목은 부가세도 함께 뺀다 — 부가세 = 과세공급가 ÷ 10', () => {
    // 원천 실측: 과세공급가가 항상 10의 배수이고 부가세는 정확히 그 1/10이다
    expect(adjustmentAmount(부침가루, 1)).toEqual({
      taxableSupply: 1190,
      vat: 119,
      exempt: 0,
      total: 1309,
    })
  })

  it('소수 수량(KG)은 10원 단위로 맞춘다', () => {
    const 돈앞다리 = item({
      unit: 'KG',
      quantity: 2.3,
      unitPrice: 15230,
      tax: { taxableSupply: 0, vat: 0, exempt: 35029, total: 35029 },
    })
    // 15,230 × 0.5 = 7,615 → 10원 반올림 7,620 (원천 금액이 늘 10의 배수라 그 관례를 따른다)
    expect(adjustmentAmount(돈앞다리, 0.5).exempt).toBe(7620)
  })
})

describe('applyAdjustments — 정산에 반영', () => {
  const 아름솔본체 = venue('키즈웰(아름솔)', {
    taxableSupply: 100000,
    vat: 10000,
    exempt: 500000,
    total: 610000,
  })
  const 방과후 = venue('키즈웰(아름솔)_방과후간식', {
    taxableSupply: 0,
    vat: 0,
    exempt: 200000,
    total: 200000,
  })

  it('조정이 없으면 그대로', () => {
    const r = applyAdjustments([아름솔본체], [item()], [])
    expect(r.venues[0].price).toEqual(아름솔본체.price)
    expect(r.errors).toEqual([])
  })

  it('★ 제외 — 단가에서만 뺀다. 원가는 그대로다', () => {
    const r = applyAdjustments([아름솔본체], [item()], [adj()])
    expect(r.errors).toEqual([])
    expect(r.venues[0].price).toEqual({
      taxableSupply: 100000,
      vat: 10000,
      exempt: 500000 - 13840,
      total: 610000 - 13840,
    })
    // 원가는 손대지 않는다 — 물건은 납품됐고 CJ에 그대로 지불한다
    expect(r.venues[0].cost).toEqual(아름솔본체.cost)
  })

  it('★ 이동 — 사업장 합계가 변하지 않는다', () => {
    const move = adj({
      kind: 'move',
      itemDate: '2026-07-08',
      productCode: '260294',
      quantity: 9,
      targetRestaurantName: '키즈웰(아름솔)_방과후간식',
    })
    const r = applyAdjustments([아름솔본체, 방과후], [사과], [move])
    expect(r.errors).toEqual([])

    const before = 아름솔본체.price.total + 방과후.price.total
    const after = r.venues[0].price.total + r.venues[1].price.total
    expect(after).toBe(before) // 사업장 합계 불변 → 정산 총액·계산서 금액 불변

    expect(r.venues[0].price.exempt).toBe(500000 - 225900)
    expect(r.venues[1].price.exempt).toBe(200000 + 225900)
  })

  it('원천에 없는 품목은 오류 — 조용히 넘기면 엉뚱한 금액이 빠진다', () => {
    const r = applyAdjustments([아름솔본체], [item()], [adj({ productCode: '999999' })])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('찾지 못했습니다')
    expect(r.venues[0].price).toEqual(아름솔본체.price) // 반영하지 않는다
  })

  it('원천 수량을 넘으면 오류', () => {
    const r = applyAdjustments([아름솔본체], [사과], [
      adj({ itemDate: '2026-07-08', productCode: '260294', quantity: 13 }),
    ])
    expect(r.errors[0]).toContain('수량')
  })

  it('같은 품목의 조정 합이 원천 수량을 넘으면 오류', () => {
    const half = adj({ itemDate: '2026-07-08', productCode: '260294', quantity: 7 })
    const r = applyAdjustments([아름솔본체], [사과], [
      { ...half, id: 'a1' },
      { ...half, id: 'a2' },
    ])
    expect(r.errors[0]).toContain('수량')
  })

  it('이동 대상 식당이 없으면 오류', () => {
    const move = adj({
      kind: 'move',
      itemDate: '2026-07-08',
      productCode: '260294',
      quantity: 9,
      targetRestaurantName: '키즈웰(아름솔)_없는식당',
    })
    const r = applyAdjustments([아름솔본체], [사과], [move])
    expect(r.errors[0]).toContain('이동할 식당')
  })

  it('제외한 식당이 venues에 없으면 오류', () => {
    const r = applyAdjustments([방과후], [item()], [adj()])
    expect(r.errors[0]).toContain('식당')
  })
})

/**
 * 조정 입력 기본값 (docs §18-3)
 *
 * ★ **왜 기본값이 필요한가.** 2026-08-01에 실제로 막혔다. 요청자·사유가 빈 칸이면
 * 저장 버튼이 비활성인데, 화면에는 회색 안내문(`김영수`, `정산제외 요청(본인부담)`)이
 * 떠 있어 **이미 입력된 것처럼 보인다.** 눌러도 아무 일이 없고 이유도 안 보였다.
 *
 * 말일 다섯 시간 안에 혼자 조정을 몰아 넣는 상황이라, 매번 같은 값을 타이핑하게
 * 두면 그 자체가 비용이다. 골랐으면 채워져 있어야 한다.
 */
describe('조정 입력 기본값', () => {
  it('식당 키가 반영 로직과 같은 규칙이어야 한다', () => {
    // 이 키로 담당 영업자를 찾아 요청자에 채운다. 규칙이 갈리면 엉뚱한 사람이 들어간다.
    expect(adjustmentVenueKey('키즈웰(아름솔)', '키즈웰(아름솔)_방과후간식')).toBe(
      '키즈웰(아름솔)|키즈웰(아름솔)_방과후간식'
    )
  })

  it('처리 종류에 따라 사유 기본값이 다르다', () => {
    expect(defaultAdjustmentReason('exclude')).toBe('정산제외 요청(본인부담)')
    expect(defaultAdjustmentReason('move')).toBe('식당 이동 요청')
  })
})
