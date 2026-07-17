import { describe, it, expect } from 'vitest'
import { computePartnerProfit, PARTNER_SHARE_RATE } from '../partner-profit'

describe('computePartnerProfit — 영업자(파트너) 예상 손익', () => {
  // 서호 유치원 실측 기준: 신세계 공급 연매출 38,009,604, 원아 90명, 배분율 15%
  //   연 수익 = 38,009,604 × 0.15 = 5,701,440.6 → 5,701,441
  //   월      = 5,701,441 / 12    = 475,120.08 → 475,120
  //   원아당  = 5,701,441 / 90    = 63,349.3  → 63,349
  it('서호 실측: 공급연매출 38,009,604 × 15% → 연 5,701,441 / 월 475,120 / 원아당 63,349', () => {
    const r = computePartnerProfit({ annualSupplyRevenue: 38_009_604, childrenCount: 90 })
    expect(r.annual).toBe(5_701_441)
    expect(r.monthly).toBe(475_120)
    expect(r.perChild).toBe(63_349)
  })

  it('배분율 상수는 15%', () => {
    expect(PARTNER_SHARE_RATE).toBe(0.15)
  })

  it('확장 시나리오 3/5/10곳은 단일 연수익의 배수', () => {
    const r = computePartnerProfit({ annualSupplyRevenue: 38_009_604, childrenCount: 90 })
    const three = r.scenarios.find((s) => s.count === 3)!
    const five = r.scenarios.find((s) => s.count === 5)!
    const ten = r.scenarios.find((s) => s.count === 10)!
    expect(three.annual).toBe(5_701_441 * 3)
    expect(five.annual).toBe(5_701_441 * 5)
    expect(ten.annual).toBe(5_701_441 * 10)
  })

  it('원아 수 0이면 원아당은 0 (division-by-zero 가드)', () => {
    const r = computePartnerProfit({ annualSupplyRevenue: 10_000_000, childrenCount: 0 })
    expect(r.perChild).toBe(0)
    expect(r.annual).toBe(1_500_000)
  })

  it('커스텀 배분율 지원 (예: 20%)', () => {
    const r = computePartnerProfit({ annualSupplyRevenue: 10_000_000, childrenCount: 50, shareRate: 0.2 })
    expect(r.annual).toBe(2_000_000)
    expect(r.monthly).toBe(Math.round(2_000_000 / 12))
    expect(r.perChild).toBe(40_000)
  })
})
