import { describe, expect, it } from 'vitest'
import {
  applyManualItems,
  calcSettlement,
  calculateChargeTotal,
  calculateTaxBreakdown,
  validateManualItem,
  type ManualItemRecord,
  type NormalizedVenue,
  type PartnerMapping,
} from '@/features/settlement'

const baseVenue: NormalizedVenue = {
  source: 'cj',
  businessCode: '1005',
  businessName: '키즈웰에듀푸드(해밀유치원)',
  restaurantCode: 'R1',
  restaurantName: '급식재료',
  cost: { taxableSupply: 100_000, vat: 10_000, exempt: 0, total: 110_000 },
  price: { taxableSupply: 130_000, vat: 13_000, exempt: 0, total: 143_000 },
}

const mapping: PartnerMapping = { 'cj:1005': 'partner-1' }

function item(overrides: Partial<ManualItemRecord> = {}): ManualItemRecord {
  return {
    id: 'manual-1',
    period: '2026-08',
    kind: 'billable',
    status: 'approved',
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: null,
    restaurantName: null,
    transactionDate: '2026-08-20',
    deliveryDate: '2026-08-21',
    productName: '김 선물세트',
    invoiceItemName: '선물세트',
    specification: '10봉/세트',
    unit: '세트',
    quantity: 20,
    vendorName: '쿠팡',
    orderNumber: 'ORDER-1',
    purchaseTaxKind: 'taxable',
    purchase: { taxableSupply: 100_000, vat: 10_000, exempt: 0, total: 110_000 },
    chargeTaxKind: 'taxable',
    charge: { taxableSupply: 140_000, vat: 14_000, exempt: 0, total: 154_000 },
    burden: 'venue',
    partnerIncluded: true,
    platformFeeApplies: true,
    invoiceMode: 'separate',
    reason: '명절 선물 요청',
    requestedBy: '해밀유치원',
    duplicateOverrideReason: null,
    createdBy: 'member@example.com',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedBy: 'admin@example.com',
    updatedAt: '2026-08-20T01:00:00.000Z',
    approvedBy: 'admin@example.com',
    approvedAt: '2026-08-20T01:00:00.000Z',
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    evidence: [],
    ...overrides,
  }
}

describe('calculateTaxBreakdown', () => {
  it('과세 총액을 공급가와 부가세로 분리한다', () => {
    expect(calculateTaxBreakdown(110_000, 'taxable')).toEqual({
      taxableSupply: 100_000,
      vat: 10_000,
      exempt: 0,
      total: 110_000,
    })
  })

  it('면세 총액은 전부 면세 금액으로 둔다', () => {
    expect(calculateTaxBreakdown(95_000, 'exempt')).toEqual({
      taxableSupply: 0,
      vat: 0,
      exempt: 95_000,
      total: 95_000,
    })
  })
})

describe('calculateChargeTotal', () => {
  it('기존 정산의 마진율 정의(마진/청구가)로 청구 총액을 자동 계산한다', () => {
    expect(calculateChargeTotal(80_000, 20)).toBe(100_000)
  })

  it('사용할 수 없는 금액이나 100% 이상 마진율은 0으로 막는다', () => {
    expect(calculateChargeTotal(-1, 20)).toBe(0)
    expect(calculateChargeTotal(80_000, 100)).toBe(0)
  })
})

describe('validateManualItem', () => {
  it('금액 합계와 과세구분이 어긋나면 마감을 막을 오류를 돌려준다', () => {
    const broken = item({
      purchase: { taxableSupply: 100_000, vat: 9_000, exempt: 1, total: 110_000 },
    })
    expect(validateManualItem(broken)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('매입 금액 합계'),
        expect.stringContaining('매입 과세구분'),
      ])
    )
  })

  it('존재하지 않는 정산월을 거절한다', () => {
    expect(validateManualItem(item({ period: '2026-13' }))).toContain(
      '정산월이 올바르지 않습니다.'
    )
  })
})

describe('applyManualItems', () => {
  it('승인된 유치원 청구 건을 계산서·재무·파트너 정산에 함께 반영한다', () => {
    const result = applyManualItems([baseVenue], [item()], mapping)

    expect(result.errors).toEqual([])
    expect(result.applied).toHaveLength(1)
    expect(result.financialVenues.reduce((s, v) => s + v.cost.total, 0)).toBe(220_000)
    expect(result.financialVenues.reduce((s, v) => s + v.price.total, 0)).toBe(297_000)
    expect(result.settlementVenues.reduce((s, v) => s + v.cost.total, 0)).toBe(220_000)
    expect(result.invoiceItems).toHaveLength(1)
    expect(result.invoiceItems[0].charge.total).toBe(154_000)
  })

  it('파트너 미포함 청구 건은 유치원 계산서와 회사 재무에만 반영한다', () => {
    const result = applyManualItems(
      [baseVenue],
      [item({ partnerIncluded: false })],
      mapping
    )

    expect(result.financialVenues.reduce((s, v) => s + v.price.total, 0)).toBe(297_000)
    expect(result.settlementVenues.reduce((s, v) => s + v.price.total, 0)).toBe(143_000)
    expect(result.invoiceItems).toHaveLength(1)
  })

  it('파트너 부담 서비스는 유치원에 청구하지 않고 파트너 공제에 더한다', () => {
    const service = item({
      kind: 'partner_service',
      burden: 'partner',
      charge: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
      partnerIncluded: false,
      platformFeeApplies: false,
    })
    const result = applyManualItems([baseVenue], [service], mapping)

    expect(result.invoiceItems).toEqual([])
    expect(result.partnerDeductions).toEqual({ 'partner-1': 110_000 })
    expect(result.financialVenues.reduce((s, v) => s + v.cost.total, 0)).toBe(220_000)
    expect(result.settlementVenues.reduce((s, v) => s + v.cost.total, 0)).toBe(110_000)
  })

  it('적립금 미적용 건의 원가 공급가를 파트너별 제외 기준으로 돌려준다', () => {
    const result = applyManualItems(
      [baseVenue],
      [item({ platformFeeApplies: false })],
      mapping
    )
    expect(result.platformFeeExcludedBase).toEqual({ 'partner-1': 100_000 })
  })

  it('작성중·취소 건은 어떤 산출물에도 반영하지 않는다', () => {
    const result = applyManualItems(
      [baseVenue],
      [item({ id: 'draft', status: 'draft' }), item({ id: 'cancelled', status: 'cancelled' })],
      mapping
    )
    expect(result.applied).toEqual([])
    expect(result.financialVenues).toEqual([baseVenue])
    expect(result.settlementVenues).toEqual([baseVenue])
  })

  it('정산제외 사업장에는 유치원 청구·파트너 부담을 연결할 수 없다', () => {
    const excludedMapping: PartnerMapping = { 'cj:1005': null }
    const billable = applyManualItems([baseVenue], [item()], excludedMapping)
    const partnerService = applyManualItems(
      [baseVenue],
      [item({ kind: 'partner_service', burden: 'partner', partnerIncluded: false })],
      excludedMapping
    )
    expect(billable.errors.join(' ')).toContain('정산제외 사업장')
    expect(partnerService.errors.join(' ')).toContain('정산제외 사업장')
    expect(billable.applied).toEqual([])
    expect(partnerService.applied).toEqual([])
  })
})

describe('외부 사입 적립금 기준', () => {
  it('품목별 미적용 금액을 뺀 공급가 기준으로만 적립금을 계산한다', () => {
    const result = calcSettlement({
      costTotal: 220_000,
      costVat: 20_000,
      priceTotal: 297_000,
      priceVat: 27_000,
      partnerType: 'partner',
      platformFeeBaseSupply: 100_000,
    })
    expect(result.platformFee).toBe(5_000)
  })
})
