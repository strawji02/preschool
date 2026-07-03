import { describe, it, expect } from 'vitest'
import { parseOrderUnit } from '../spec-parser'

/**
 * 발주 단위(KG/EA/PK/BOX)별 "1 발주 단위당 무게(g)" 계산 테스트
 *
 * 남산성모유치원 아워홈 거래명세표의 규격/단위 혼재 케이스 기반.
 * 목적: 총 발주 무게 및 kg당 단가를 산출하기 위한 단위 환산.
 */
describe('parseOrderUnit — 발주 단위별 단위당 무게', () => {
  it('KG: 1발주단위 = 1000g', () => {
    const r = parseOrderUnit('KG')
    expect(r.unitType).toBe('KG')
    expect(r.unitWeightG).toBe(1000)
  })

  it('KG(약300g_국내산): 괄호는 참고정보, 발주단위는 여전히 1kg=1000g', () => {
    const r = parseOrderUnit('KG(약300g_국내산)')
    expect(r.unitType).toBe('KG')
    expect(r.unitWeightG).toBe(1000)
  })

  it('EA(85g): 1개당 85g', () => {
    const r = parseOrderUnit('EA(85g)')
    expect(r.unitType).toBe('EA')
    expect(r.perSizeG).toBe(85)
    expect(r.unitWeightG).toBe(85)
  })

  it('PK.(200g_외국산): 1팩당 200g', () => {
    const r = parseOrderUnit('PK.(200g_외국산)')
    expect(r.unitType).toBe('PK')
    expect(r.unitWeightG).toBe(200)
  })

  it('PK.(개당60~68g/30ea_국내산): 개당 평균64g × 30ea = 1920g/팩', () => {
    const r = parseOrderUnit('PK.(개당60~68g/30ea_국내산)')
    expect(r.unitType).toBe('PK')
    expect(r.perSizeG).toBe(64) // (60+68)/2
    expect(r.perPackEa).toBe(30)
    expect(r.unitWeightG).toBe(1920) // 64 × 30
  })

  it('BOX: 무게 불명 → unitWeightG null', () => {
    const r = parseOrderUnit('BOX')
    expect(r.unitType).toBe('BOX')
    expect(r.unitWeightG).toBeNull()
  })

  it('빈 문자열: unitType null, unitWeightG null', () => {
    const r = parseOrderUnit('')
    expect(r.unitType).toBeNull()
    expect(r.unitWeightG).toBeNull()
  })
})

describe('parseOrderUnit — 총 무게 / kg당 단가 산출 helper', () => {
  it('닭다리살(냉장) KG 9.5개 × 20080원: 총무게 9500g, kg당 20080', () => {
    const r = parseOrderUnit('KG')
    const qty = 9.5
    const totalPrice = 190760
    const totalWeightG = (r.unitWeightG ?? 0) * qty
    expect(totalWeightG).toBe(9500)
    const pricePerKg = totalPrice / (totalWeightG / 1000)
    expect(Math.round(pricePerKg)).toBe(20080)
  })

  it('계란 PK.(개당60~68g/30ea) 5팩: 총무게 9600g', () => {
    const r = parseOrderUnit('PK.(개당60~68g/30ea_국내산)')
    const qty = 5
    const totalWeightG = (r.unitWeightG ?? 0) * qty
    expect(totalWeightG).toBe(9600) // 1920 × 5
  })
})
