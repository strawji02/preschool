import { describe, it, expect } from 'vitest'
import { buildExcelModel } from '../excel-utils'
import type { ComparisonItem } from '@/types/audit'

/**
 * 엑셀 3단 모델 정합성 (2026-07-05 신설)
 *   ① 비교가능(확정&비제외) 소계 = 화면 절감 산정 대상
 *   ② 비교불가(미확정||비교불가) 별도 소계
 *   ③ 거래명세표 총액 = ①기존 + ②기존 = 전체 품목 기존금액 합 (누락 0)
 */
function makeItem(o: {
  id: string; name: string; qty: number; unit_price: number; total?: number
  confirmed?: boolean; excluded?: boolean
  ssg?: { standard_price: number; spec_quantity?: number; spec_unit?: string; category?: string }
}): ComparisonItem {
  return {
    id: o.id,
    extracted_name: o.name,
    extracted_quantity: o.qty,
    extracted_unit_price: o.unit_price,
    extracted_total_price: o.total,
    ssg_match: o.ssg
      ? {
          id: `ssg-${o.id}`,
          product_name: `ssg-${o.name}`,
          standard_price: o.ssg.standard_price,
          match_score: 1,
          spec_quantity: o.ssg.spec_quantity,
          spec_unit: o.ssg.spec_unit,
          category: o.ssg.category,
        }
      : undefined,
    cj_candidates: [],
    ssg_candidates: [],
    is_confirmed: o.confirmed ?? (o.ssg != null),
    cj_confirmed: false,
    ssg_confirmed: false,
    savings: { cj: 0, ssg: 0, max: 0 },
    match_status: o.ssg ? 'manual_matched' : 'unmatched',
    is_excluded: o.excluded ?? false,
  } as ComparisonItem
}

describe('buildExcelModel — 3단 분류·정합성', () => {
  const items = [
    // 비교가능 (확정 + 매칭): 기존 1000, 신세계 600
    makeItem({ id: 'a', name: '감자', qty: 1, unit_price: 1000, total: 1000, confirmed: true,
      ssg: { standard_price: 600, spec_quantity: 1, spec_unit: 'KG', category: '농산' } }),
    // 미확정 (매칭 있으나 confirmed=false): 기존 800
    makeItem({ id: 'b', name: '당근', qty: 1, unit_price: 800, total: 800, confirmed: false,
      ssg: { standard_price: 500, spec_quantity: 1, spec_unit: 'KG', category: '농산' } }),
    // 비교불가 (is_excluded): 기존 500
    makeItem({ id: 'c', name: '파리바게뜨빵', qty: 1, unit_price: 500, total: 500, confirmed: true, excluded: true }),
  ]

  it('비교가능은 확정&비제외 1건만', () => {
    const m = buildExcelModel(items, 1)
    expect(m.comparable).toHaveLength(1)
    expect(m.comparable[0].name).toBe('감자')
  })

  it('비교불가 = 미확정 + 비교불가 = 2건', () => {
    const m = buildExcelModel(items, 1)
    expect(m.excluded).toHaveLength(2)
  })

  it('비교가능 소계: 절감은 비교가능만 (미확정·비교불가 오염 없음)', () => {
    const m = buildExcelModel(items, 1)
    expect(m.comparableSums.existing).toBe(1000)
    expect(m.comparableSums.applied).toBe(600)
    expect(m.comparableSums.savings).toBe(400)
  })

  it('비교불가 소계 = 미확정800 + 비교불가500 = 1300', () => {
    const m = buildExcelModel(items, 1)
    expect(m.excludedExisting).toBe(1300)
  })

  it('거래명세표 총액 = 비교가능 + 비교불가 = 전체 기존금액 합 (누락 0)', () => {
    const m = buildExcelModel(items, 1)
    expect(m.grandExisting).toBe(2300)
    const allExisting = items.reduce((s, it) => s + Math.round(it.extracted_total_price!), 0)
    expect(m.grandExisting).toBe(allExisting)
  })

  it('공급율 적용 — applied = round(신세계 × rate)', () => {
    const m = buildExcelModel(items, 1.25)
    expect(m.comparableSums.applied).toBe(Math.round(600 * 1.25)) // 750
    expect(m.comparableSums.savings).toBe(1000 - 750)
  })

  it('비교불가 행은 신세계 정보 null (신세계 칸 공란 처리용)', () => {
    const m = buildExcelModel(items, 1)
    expect(m.excluded.every((r) => r.ssg === null || r.name === '당근')).toBe(true)
    const bppang = m.excluded.find((r) => r.name === '파리바게뜨빵')!
    expect(bppang.ssg).toBeNull()
    expect(bppang.existing).toBe(500)
  })
})
