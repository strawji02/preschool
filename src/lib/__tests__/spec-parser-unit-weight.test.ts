import { describe, it, expect } from 'vitest'
import { parseOrderUnit, ssgUnitWeightG, perPieceGramsFromSpec } from '../spec-parser'

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

  // (2026-07-05) 괄호 밖 주 무게 = 1 발주단위 총량 — 괄호 안은 개당/구성 참고정보
  it('EA 1kg(8±2g,90ea 이상): 1팩(EA)=1kg — 괄호 밖 무게 우선 (개당 8g 아님)', () => {
    const r = parseOrderUnit('EA 1kg(8±2g,90ea 이상)')
    expect(r.unitType).toBe('EA')
    expect(r.unitWeightG).toBe(1000) // 괄호 안 "2g" 오인 방지
  })

  it('EA 2kg(약50개입): 1팩=2kg (괄호 밖 무게 우선)', () => {
    const r = parseOrderUnit('EA 2kg(약50개입)')
    expect(r.unitWeightG).toBe(2000)
  })

  it('회귀: PK.(40g*72ea)는 괄호 밖 무게 없음 → 40×72=2880 유지', () => {
    expect(parseOrderUnit('PK.(40g*72ea)').unitWeightG).toBe(2880)
  })

  it('괄호 없이 개당무게가 먼저 와도 kg 총량 우선: EA 개당±17.3G/1KG/10 → 1000', () => {
    expect(parseOrderUnit('EA 개당±17.3G/1KG/10').unitWeightG).toBe(1000)
  })
})

// (2026-07-05) 신세계 카드 단위중량 — 개수 단위 상품(spec_unit=개/EA)의 개당무게×개수
describe('ssgUnitWeightG — 신세계 상품 단위중량', () => {
  it('무게단위(KG): spec_quantity가 총량 — 계란 대란 1.68KG → 1680', () => {
    expect(ssgUnitWeightG(1.68, 'KG', '1.68KG, 52~60G*30EA')).toBe(1680)
  })
  it('무게단위(G): 모두부 340G → 340', () => {
    expect(ssgUnitWeightG(340, 'G', '340G, 대두 국산')).toBe(340)
  })
  it('개수단위(개): 유정란 15개 × 개당56g(52~60) → 840', () => {
    expect(ssgUnitWeightG(15, '개', '15개, 52~60G/개')).toBe(840)
  })
  it('개수단위(EA): 1EA × 개당200g → 200', () => {
    expect(ssgUnitWeightG(1, 'EA', 'EA, 개당 200g')).toBe(200)
  })
  it('개수단위인데 개당무게 없으면 0', () => {
    expect(ssgUnitWeightG(15, '개', '15개')).toBe(0)
  })
  it('수량/단위 없으면 0', () => {
    expect(ssgUnitWeightG(undefined, 'KG', '1KG')).toBe(0)
  })

  it('perPieceGramsFromSpec: 범위 평균 / 단일 / 없음', () => {
    expect(perPieceGramsFromSpec('52~60G/개')).toBe(56)
    expect(perPieceGramsFromSpec('개당 200g')).toBe(200)
    expect(perPieceGramsFromSpec('15개')).toBeNull()
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

  it('[회귀] 애호박 발주 1.5 KG(약300g_국내산): 괄호 300g 오인 금지, 총무게 1500g', () => {
    // 버그: 단위가 "KG(약300g_국내산)"일 때 괄호 안 참고정보 300g을
    //       단위중량으로 잡아 300×1.5=450g으로 계산하던 문제.
    // 기대: KG 발주단위 = 1000g → 1000×1.5 = 1500g
    const r = parseOrderUnit('KG(약300g_국내산)')
    expect(r.unitType).toBe('KG')
    expect(r.unitWeightG).toBe(1000)
    const qty = 1.5
    expect((r.unitWeightG ?? 0) * qty).toBe(1500)
  })
})
