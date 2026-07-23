import { describe, it, expect } from 'vitest'
import { resolveInvoiceUnitWeightG } from '../invoice-unit-weight'
import { parseOrderUnit } from '../spec-parser'

function inv(extracted_unit: string, extracted_spec: string, extracted_name = '') {
  return { extracted_unit, extracted_spec, extracted_name }
}

describe('resolveInvoiceUnitWeightG — 규격 우선 파싱 (다양한 명세표)', () => {
  // 사용자 신고 5종 (거래명세서) — extracted_unit이 coarse "EA"여도 규격의 진짜 포장을 신뢰
  it('#48 냉동메밀면 PK.(250g*5ea) → 1250g (250×5)', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'PK.(250g*5ea)'))).toBe(1250)
  })

  it('#120 크레잇 탕수육 PK.(11.5g,85±5ea) → ~977.5g (11.5×85, ±5 무시)', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'PK.(11.5g,85±5ea)'))).toBeCloseTo(977.5, 1)
  })

  it('#34 피양파 KG(개당100g내외) → 1000g (KG 판매)', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'KG(개당100g내외_국내산)'))).toBe(1000)
  })

  it('#57 한입고구마 KG(개당30~80g내외) → 1000g', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'KG(개당30~80g내외_국내산)'))).toBe(1000)
  })

  it('#19 흙감자 KG(개당180~230g) → 1000g', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'KG(개당180~230g_국내산)'))).toBe(1000)
  })

  // 회귀 가드 — 박스포장 "400G*6EA/BOX"는 규격 선두에 단위토큰 없음 → 기존대로 1EA=400g (×6 안 함)
  it('회귀: EA + 400G*6EA/BOX → 400g (박스당 6EA, 곱하지 않음)', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', '400G*6EA/BOX'))).toBe(400)
  })

  it('회귀: EA + EA(85g) 단품 → 85g', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', 'EA(85g)'))).toBe(85)
  })

  it('규격 비어도 unit=KG면 1000g', () => {
    expect(resolveInvoiceUnitWeightG(inv('KG', ''))).toBe(1000)
  })

  // 데이터 형태 견고성 — extracted_spec에 'PK.' 접두가 없어도(250g*5ea) EA 주문 시 곱해야 함
  it('#48 변형: EA + "250g*5ea"(PK. 없음) → 1250g (Xg*Nea는 곱함, /BOX 아님)', () => {
    expect(resolveInvoiceUnitWeightG(inv('EA', '250g*5ea'))).toBe(1250)
  })
  it('#48 변형: unit=PK + "250g*5ea" → 1250g', () => {
    expect(resolveInvoiceUnitWeightG(inv('PK', '250g*5ea'))).toBe(1250)
  })

  // 실제 명세서: 단위 컬럼 없음 + 규격에 보관조건 "[냉동]" 접두 (extracted_unit 비어있음)
  it('#48 원본: unit 없음 + "[냉동] PK.(250g*5ea)" → 1250g', () => {
    expect(resolveInvoiceUnitWeightG(inv('', '[냉동] PK.(250g*5ea)'))).toBe(1250)
  })
  it('#34 원본: unit 없음 + "[실온] KG(개당100g내외_국내산)" → 1000g', () => {
    expect(resolveInvoiceUnitWeightG(inv('', '[실온] KG(개당100g내외_국내산)'))).toBe(1000)
  })
  it('#120 원본: unit 없음 + "[돼지고기(국산) 냉동] PK.(11.5g,85±5ea)" → ~977.5g', () => {
    expect(resolveInvoiceUnitWeightG(inv('', '[돼지고기(국산) 냉동] PK.(11.5g,85±5ea)'))).toBeCloseTo(977.5, 1)
  })
})

describe('parseOrderUnit — perPackEa 오차표기(±) 파싱', () => {
  it('85±5ea → perPackEa 85 (오차 5 무시)', () => {
    expect(parseOrderUnit('PK.(11.5g,85±5ea)').perPackEa).toBe(85)
  })
  it('오차표기 없는 5ea → 5 (기존 동작 유지)', () => {
    expect(parseOrderUnit('PK.(250g*5ea)').perPackEa).toBe(5)
  })
  it('90~100개 → 90 (범위 하한 기준값)', () => {
    expect(parseOrderUnit('PK.(10g,90~100개)').perPackEa).toBe(90)
  })
})
