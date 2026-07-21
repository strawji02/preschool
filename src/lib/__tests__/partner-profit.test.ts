import { describe, it, expect } from 'vitest'
import {
  computePartnerProfit,
  computeMarginSensitivity,
  partnerSettlement,
  PLATFORM_FEE_RATE,
} from '../partner-profit'

describe('partnerSettlement — 계약식(제4조): 원가 × (m − 플랫폼 5%)', () => {
  it('플랫폼 수수료 상수는 5%', () => {
    expect(PLATFORM_FEE_RATE).toBe(0.05)
  })

  // 엑셀 "마진율 민감도"(S=1억 고정) D23:D26 검증 — C=S/(1+m), 정산금=C×(m−5%)
  it('엑셀 제4조 값과 일치 (S=1억, m 변동)', () => {
    const S = 100_000_000
    const cases = [
      { m: 0.15, expected: 8_695_652 }, // C=86,956,522 × 0.10
      { m: 0.20, expected: 12_500_000 }, // C=83,333,333 × 0.15
      { m: 0.25, expected: 16_000_000 }, // C=80,000,000 × 0.20
      { m: 0.30, expected: 19_230_769 }, // C=76,923,077 × 0.25
    ]
    for (const { m, expected } of cases) {
      const C = S / (1 + m)
      expect(partnerSettlement(C, m)).toBe(expected)
    }
  })

  it('마진율이 플랫폼 수수료(5%) 이하면 정산금 0 이하', () => {
    expect(partnerSettlement(80_000_000, 0.05)).toBe(0)
    expect(partnerSettlement(80_000_000, 0.03)).toBeLessThan(0)
  })
})

describe('computePartnerProfit — 세션 원가 고정, 현재 공급율 기준', () => {
  // 서호: 현재판매가 S=38,009,604 (공급율 1.25) → 원가 C=30,407,683.2, m=0.25
  //   정산금 = C×(0.25−0.05)=C×0.20 = 6,081,536.6 → 6,081,537
  it('서호 25% 기준: 연 정산금 6,081,537 / 매출대비 16.0%', () => {
    const r = computePartnerProfit({
      annualSupplyRevenue: 38_009_604,
      supplyRate: 1.25,
      childrenCount: 90,
    })
    expect(r.marginRate).toBeCloseTo(0.25, 10)
    expect(r.annual).toBe(6_081_537)
    expect(r.monthly).toBe(Math.round(6_081_537 / 12))
    expect(r.perChild).toBe(Math.round(6_081_537 / 90))
    expect(r.revenuePctOfSales).toBeCloseTo(0.16, 3)
  })

  it('공급율이 바뀌면 정산금도 연동 (동적 중심)', () => {
    const at25 = computePartnerProfit({ annualSupplyRevenue: 38_009_604, supplyRate: 1.25, childrenCount: 90 })
    const at34 = computePartnerProfit({ annualSupplyRevenue: 40_746_295, supplyRate: 1.34, childrenCount: 90 })
    // 34%가 25%보다 정산금 큼
    expect(at34.annual).toBeGreaterThan(at25.annual)
  })
})

describe('computeMarginSensitivity — 현재 공급율 중심 ±3%×3단계', () => {
  const C = 38_009_604 / 1.25 // 서호 원가 30,407,683.2
  const rows = computeMarginSensitivity({
    purchaseCost: C,
    currentSupplyRate: 1.25,
    kindergartenCurrentCost: 42_653_952,
  })

  it('현재 25% 중심으로 16~34% (7단계) 생성', () => {
    const margins = rows.map((r) => Math.round(r.marginRate * 100))
    expect(margins).toEqual([16, 19, 22, 25, 28, 31, 34])
    expect(rows.find((r) => r.isCurrent)!.marginRate).toBeCloseTo(0.25, 10)
  })

  it('중심 25% 행: 판매가 38,009,604 / 유치원 제공 4,644,348 / 영업자 6,081,537', () => {
    const cur = rows.find((r) => r.isCurrent)!
    expect(cur.salePrice).toBe(38_009_604)
    expect(cur.kindergartenService).toBe(4_644_348)
    expect(cur.partnerSettlement).toBe(6_081_537)
    expect(cur.partnerPctOfSales).toBeCloseTo(0.16, 3)
  })

  it('trade-off: 마진↑ → 영업자↑·유치원 서비스↓', () => {
    const m16 = rows[0]
    const m34 = rows[rows.length - 1]
    expect(m34.partnerSettlement).toBeGreaterThan(m16.partnerSettlement)
    expect(m34.kindergartenService).toBeLessThan(m16.kindergartenService)
  })

  it('중심이 동적으로 이동 (공급율 1.30 → 21~39%)', () => {
    const r = computeMarginSensitivity({
      purchaseCost: C,
      currentSupplyRate: 1.30,
      kindergartenCurrentCost: 42_653_952,
    })
    const margins = r.map((x) => Math.round(x.marginRate * 100))
    expect(margins).toEqual([21, 24, 27, 30, 33, 36, 39])
  })

  it('정산금이 0 이하가 되는 낮은 마진 행은 제외', () => {
    const r = computeMarginSensitivity({
      purchaseCost: C,
      currentSupplyRate: 1.10, // base 10% → 1,4,7,10,13,16,19% 중 ≤5%는 제외
      kindergartenCurrentCost: 42_653_952,
    })
    expect(r.every((x) => x.marginRate > PLATFORM_FEE_RATE)).toBe(true)
  })
})
