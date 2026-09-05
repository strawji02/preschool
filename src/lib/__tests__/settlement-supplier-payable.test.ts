import { describe, expect, it } from 'vitest'
import { buildSupplierPayableSummary, calculateSupplierPrincipals, type ClosingVenueRow } from '@/features/settlement'

const tax = (total: number) => ({ taxableSupply: total, vat: 0, exempt: 0, total })
function venue(over: Partial<ClosingVenueRow> = {}): ClosingVenueRow {
  return {
    source: 'cj', businessCode: '1', businessName: '유치원', restaurantCode: '1',
    restaurantName: '급식', companyName: '유치원', partnerId: null, partnerName: null,
    isExcluded: false, exclusionReason: null, cost: tax(100), price: tax(120), ...over,
  }
}

describe('공급자 결제대금', () => {
  it('정산제외 원천 매입은 포함하고 외부 사입·계산서 조정 합성행은 제외한다', () => {
    const principals = calculateSupplierPrincipals([
      venue({ cost: tax(100) }),
      venue({ restaurantCode: '본사', isExcluded: true, cost: tax(30) }),
      venue({ restaurantCode: 'manual:x', cost: tax(999) }),
      venue({ restaurantCode: 'invoice-override', cost: tax(777) }),
      venue({ source: 'shinsegae', cost: tax(50) }),
    ])
    expect(principals).toEqual([
      { source: 'cj', amount: 130 },
      { source: 'shinsegae', amount: 50 },
    ])
  })

  it('원금은 잠그고 승인 조정과 건별 지급으로 잔액을 계산한다', () => {
    const summary = buildSupplierPayableSummary({
      principals: [
        { source: 'cj', amount: 12_000_000 },
        { source: 'shinsegae', amount: 8_000_000 },
      ],
      adjustments: [
        { source: 'cj', amount: 100_000, status: 'approved' },
        { source: 'cj', amount: 999_999, status: 'draft' },
      ],
      payments: [
        { source: 'cj', paidDate: '2026-08-10', amount: 5_000_000 },
        { source: 'cj', paidDate: '2026-08-20', amount: 2_000_000 },
        { source: 'shinsegae', paidDate: '2026-08-15', amount: 8_000_000 },
      ],
    })

    expect(summary.rows.find((row) => row.source === 'cj')).toMatchObject({
      principal: 12_000_000,
      adjustment: 100_000,
      payable: 12_100_000,
      paid: 7_000_000,
      outstanding: 5_100_000,
      paymentCount: 2,
    })
    expect(summary.rows.find((row) => row.source === 'shinsegae')?.outstanding).toBe(0)
    expect(summary.totals.outstanding).toBe(5_100_000)
  })

  it('초과 지급은 음수 잔액으로 남겨 오류를 숨기지 않는다', () => {
    const summary = buildSupplierPayableSummary({
      principals: [{ source: 'cj', amount: 100 }],
      adjustments: [],
      payments: [{ source: 'cj', paidDate: '2026-08-10', amount: 120 }],
    })
    expect(summary.rows.find((row) => row.source === 'cj')?.outstanding).toBe(-20)
  })
})
