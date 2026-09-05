import { describe, it, expect } from 'vitest'
import {
  buildCollectionSummary,
  type ClosingPartnerRow,
  type ClosingVenueRow,
  type PayoutRecord,
  type ReceiptAdjustmentRecord,
  type ReceiptRecord,
} from '@/features/settlement'

/**
 * [정산] 수금·지급 관리 (docs §9, §13-3)
 *
 * 발생(청구)과 현금(수금)을 잇는다. 보고서의 "장부상 이익은 났는데 통장에 없다"를
 * 설명하는 쪽이 이것이다.
 *
 * ```
 * 미수금 = 청구합계 − 수금액
 * 미지급 = 실지급액 − 지급완료액
 * 한 영업자의 담당 유치원 전원 입금 완료 → 지급 요청 알림
 * ```
 *
 * ⚠️ **정산제외 사업장은 수금 대상이 아니다.** 계산서를 발행하지 않으므로 받을 돈이
 * 없다. 목록에 넣으면 영원히 미수금으로 남아 "전원 입금 완료"가 되지 않는다.
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

function partner(over: Partial<ClosingPartnerRow> = {}): ClosingPartnerRow {
  return {
    partnerId: 'p-kim',
    partnerName: '김중영',
    partnerType: 'cofounder',
    commissionPercent: 5,
    costTotal: 0,
    costVat: 0,
    priceTotal: 0,
    priceVat: 0,
    margin: 0,
    platformFee: 0,
    vatDiff: 0,
    businessDeduction: 0,
    preTax: 0,
    declared: 0,
    incomeTax: 0,
    localTax: 0,
    netPay: 7_234_037,
    ...over,
  }
}

function receipt(over: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    source: 'cj',
    businessCode: '1005',
    receivedDate: '2026-07-10',
    amount: 1_000,
    note: null,
    ...over,
  }
}

function receiptAdjustment(
  over: Partial<ReceiptAdjustmentRecord> = {}
): ReceiptAdjustmentRecord {
  return {
    source: 'cj',
    businessCode: '1005',
    amount: 14,
    reason: '원단위 입금 차이 승인',
    status: 'approved',
    ...over,
  }
}

describe('buildCollectionSummary — 유치원별 수금', () => {
  it('청구액은 사업장의 식당을 합친 값이다', () => {
    const s = buildCollectionSummary({
      venues: [
        venue({ restaurantCode: '1000', price: { ...zero, total: 2_000 } }),
        venue({ restaurantCode: '1001', price: { ...zero, total: 900 } }),
      ],
      partners: [],
      receipts: [],
      receiptAdjustments: [],
      payouts: [],
    })
    expect(s.venues).toHaveLength(1)
    expect(s.venues[0]).toMatchObject({ billed: 2_900, received: 0, outstanding: 2_900 })
  })

  it('관리자가 승인한 원단위 조정은 청구액을 바꾸지 않고 완납 처리한다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 1_014 } })],
      partners: [],
      receipts: [receipt({ amount: 1_000 })],
      receiptAdjustments: [receiptAdjustment()],
      payouts: [],
    })

    expect(s.venues[0]).toMatchObject({
      billed: 1_014,
      received: 1_000,
      adjusted: 14,
      outstanding: 0,
      isFullyReceived: true,
    })
  })

  it('작성중 조정은 잔액에 반영하지 않는다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 1_014 } })],
      partners: [],
      receipts: [receipt({ amount: 1_000 })],
      receiptAdjustments: [receiptAdjustment({ status: 'draft' })],
      payouts: [],
    })
    expect(s.venues[0]).toMatchObject({ adjusted: 0, outstanding: 14 })
  })

  it('입금 기록이 있으면 수금액에 반영한다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_900 } })],
      partners: [],
      receipts: [receipt({ amount: 2_900, receivedDate: '2026-07-10' })],
      payouts: [],
    })
    expect(s.venues[0]).toMatchObject({
      received: 2_900,
      outstanding: 0,
      receivedDate: '2026-07-10',
      isFullyReceived: true,
    })
  })

  it('부분 수금은 미수금이 남는다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_900 } })],
      partners: [],
      receipts: [receipt({ amount: 1_000 })],
      payouts: [],
    })
    expect(s.venues[0]).toMatchObject({
      received: 1_000,
      outstanding: 1_900,
      isFullyReceived: false,
    })
  })

  it('여러 번 나눠 입금해도 합산한다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_900 } })],
      partners: [],
      receipts: [
        receipt({ amount: 1_000, receivedDate: '2026-07-10' }),
        receipt({ amount: 1_900, receivedDate: '2026-07-20' }),
      ],
      payouts: [],
    })
    expect(s.venues[0]!.received).toBe(2_900)
    expect(s.venues[0]!.outstanding).toBe(0)
    // 마지막 입금일을 보여준다 — 완납 시점이 궁금한 값이다
    expect(s.venues[0]!.receivedDate).toBe('2026-07-20')
  })

  it('초과 입금도 그대로 반영한다 (미수금은 음수)', () => {
    // 조용히 0으로 만들면 잘못 들어온 돈을 못 찾는다
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 1_000 } })],
      partners: [],
      receipts: [receipt({ amount: 1_500 })],
      payouts: [],
    })
    expect(s.venues[0]!.outstanding).toBe(-500)
    expect(s.venues[0]!.isFullyReceived).toBe(true)
  })

  it('정산제외 사업장은 수금 목록에서 뺀다', () => {
    // 계산서를 발행하지 않으므로 받을 돈이 없다. 넣으면 영원히 미수금으로 남는다.
    const s = buildCollectionSummary({
      venues: [
        venue({ price: { ...zero, total: 2_000 } }),
        venue({
          source: 'shinsegae',
          businessCode: '88689',
          isExcluded: true,
          exclusionReason: '마케팅비',
          partnerId: null,
          partnerName: null,
          price: { ...zero, total: 12_925 },
        }),
      ],
      partners: [],
      receipts: [],
      payouts: [],
    })
    expect(s.venues).toHaveLength(1)
    expect(s.venues[0]!.businessCode).toBe('1005')
    expect(s.totals.billed).toBe(2_000)
  })

  it('계산서 상호를 이름으로 쓴다', () => {
    const s = buildCollectionSummary({
      venues: [venue()],
      partners: [],
      receipts: [],
      payouts: [],
    })
    expect(s.venues[0]!.label).toBe('해밀유치원')
  })

  it('미수금이 큰 순으로 정렬한다 — 받아야 할 것부터 본다', () => {
    const s = buildCollectionSummary({
      venues: [
        venue({ businessCode: 'A', price: { ...zero, total: 100 } }),
        venue({ businessCode: 'B', price: { ...zero, total: 300 } }),
        venue({ businessCode: 'C', price: { ...zero, total: 200 } }),
      ],
      partners: [],
      receipts: [receipt({ businessCode: 'B', amount: 300 })],
      payouts: [],
    })
    // B는 완납 → 미수금 0이라 뒤로
    expect(s.venues.map((v) => v.businessCode)).toEqual(['C', 'A', 'B'])
  })
})

describe('buildCollectionSummary — 영업자별 지급', () => {
  it('담당 유치원의 청구·수금을 모은다', () => {
    const s = buildCollectionSummary({
      venues: [
        venue({ businessCode: '1005', price: { ...zero, total: 2_000 } }),
        venue({ businessCode: '1008', price: { ...zero, total: 3_000 } }),
      ],
      partners: [partner()],
      receipts: [receipt({ businessCode: '1005', amount: 2_000 })],
      payouts: [],
    })
    expect(s.partners[0]).toMatchObject({
      partnerName: '김중영',
      venueCount: 2,
      receivedCount: 1,
      billed: 5_000,
      received: 2_000,
      outstanding: 3_000,
      allReceived: false,
    })
  })

  it('담당 유치원 전원 입금 완료면 지급 요청 알림에 올린다 (docs §9)', () => {
    const s = buildCollectionSummary({
      venues: [
        venue({ businessCode: '1005', price: { ...zero, total: 2_000 } }),
        venue({ businessCode: '1008', price: { ...zero, total: 3_000 } }),
      ],
      partners: [partner()],
      receipts: [
        receipt({ businessCode: '1005', amount: 2_000 }),
        receipt({ businessCode: '1008', amount: 3_000 }),
      ],
      payouts: [],
    })
    expect(s.partners[0]!.allReceived).toBe(true)
    expect(s.readyToPay.map((p) => p.partnerName)).toEqual(['김중영'])
  })

  it('이미 지급했으면 알림에서 빠진다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_000 } })],
      partners: [partner({ netPay: 1_000 })],
      receipts: [receipt({ amount: 2_000 })],
      payouts: [{ partnerId: 'p-kim', paidDate: '2026-07-25', amount: 1_000, note: null }],
    })
    expect(s.partners[0]).toMatchObject({ paid: 1_000, unpaid: 0, paidDate: '2026-07-25' })
    expect(s.readyToPay).toEqual([])
  })

  it('일부만 지급했으면 아직 알림에 남는다', () => {
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_000 } })],
      partners: [partner({ netPay: 1_000 })],
      receipts: [receipt({ amount: 2_000 })],
      payouts: [{ partnerId: 'p-kim', paidDate: '2026-07-25', amount: 400, note: null }],
    })
    expect(s.partners[0]).toMatchObject({ paid: 400, unpaid: 600 })
    expect(s.readyToPay).toHaveLength(1)
  })

  it('담당 유치원이 없는 영업자는 지급 알림에 올리지 않는다', () => {
    // 이번 달 담당 매출이 없으면 지급할 것도 없다. 빈 조건을 "전원 완료"로 보면
    // 매달 헛 알림이 뜬다.
    const s = buildCollectionSummary({
      venues: [],
      partners: [partner({ netPay: 1_000 })],
      receipts: [],
      payouts: [],
    })
    expect(s.partners[0]!.allReceived).toBe(false)
    expect(s.readyToPay).toEqual([])
  })

  it('실지급액이 0이면 알림에 올리지 않는다', () => {
    // 세전이 음수여서 0으로 처리된 달 (docs §11)
    const s = buildCollectionSummary({
      venues: [venue({ price: { ...zero, total: 2_000 } })],
      partners: [partner({ netPay: 0 })],
      receipts: [receipt({ amount: 2_000 })],
      payouts: [],
    })
    expect(s.partners[0]!.allReceived).toBe(true)
    expect(s.readyToPay).toEqual([])
  })

  it('미배정 사업장은 어느 영업자에도 넣지 않는다', () => {
    const s = buildCollectionSummary({
      venues: [
        venue({ businessCode: '1005', price: { ...zero, total: 2_000 } }),
        venue({
          businessCode: '9999',
          partnerId: null,
          partnerName: null,
          price: { ...zero, total: 500 },
        }),
      ],
      partners: [partner()],
      receipts: [receipt({ businessCode: '1005', amount: 2_000 })],
      payouts: [],
    })
    expect(s.partners[0]!.venueCount).toBe(1)
    // 그래도 수금 목록·합계에는 남는다 — 청구는 했으니 받아야 한다
    expect(s.venues).toHaveLength(2)
    expect(s.totals.billed).toBe(2_500)
  })
})

describe('buildCollectionSummary — 합계', () => {
  const s = buildCollectionSummary({
    venues: [
      venue({ businessCode: '1005', price: { ...zero, total: 2_000 } }),
      venue({ businessCode: '1008', price: { ...zero, total: 3_000 } }),
    ],
    partners: [partner({ netPay: 1_000 })],
    receipts: [receipt({ businessCode: '1005', amount: 1_500 })],
    payouts: [{ partnerId: 'p-kim', paidDate: '2026-07-25', amount: 400, note: null }],
  })

  it('청구·수금·미수금 합계', () => {
    expect(s.totals.billed).toBe(5_000)
    expect(s.totals.received).toBe(1_500)
    expect(s.totals.outstanding).toBe(3_500)
  })

  it('실지급·지급완료·미지급 합계', () => {
    expect(s.totals.netPay).toBe(1_000)
    expect(s.totals.paid).toBe(400)
    expect(s.totals.unpaid).toBe(600)
  })

  it('빈 입력은 전부 0이다', () => {
    const e = buildCollectionSummary({ venues: [], partners: [], receipts: [], payouts: [] })
    expect(e.totals).toEqual({
      billed: 0,
      received: 0,
      adjusted: 0,
      outstanding: 0,
      netPay: 0,
      paid: 0,
      unpaid: 0,
    })
    expect(e.readyToPay).toEqual([])
  })
})
