import { describe, it, expect } from 'vitest'
import { computeMatchingKpi } from '../matching-kpi'
import { estimateSsgTotal } from '../unit-conversion'
import type { ComparisonItem } from '@/types/audit'

/** 테스트용 최소 ComparisonItem 팩토리 */
function makeItem(o: Partial<ComparisonItem> & { extracted_quantity: number }): ComparisonItem {
  return {
    id: Math.random().toString(36).slice(2),
    extracted_name: '품목',
    extracted_spec: '1kg',
    extracted_unit: 'EA',
    extracted_unit_price: 0,
    extracted_total_price: null,
    is_confirmed: true,
    is_excluded: false,
    ...o,
  } as ComparisonItem
}

const ssg = (standard_price: number, spec_quantity: number, spec_unit: string) => ({
  standard_price, spec_quantity, spec_unit, ppu: null, tax_type: '면세' as const,
})

describe('computeMatchingKpi — 매칭 KPI (공급율 반영)', () => {
  const items: ComparisonItem[] = [
    // 비교 가능 2건 (매칭됨)
    makeItem({ extracted_total_price: 100_000, extracted_quantity: 10, ssg_match: ssg(8_000, 1, 'KG') as never }),
    makeItem({ extracted_total_price: 50_000, extracted_quantity: 5, ssg_match: ssg(9_000, 1, 'KG') as never }),
    // 비교불가 1건
    makeItem({ extracted_total_price: 30_000, extracted_quantity: 3, is_excluded: true, ssg_match: ssg(7_000, 1, 'KG') as never }),
  ]
  const included = items.filter((i) => !i.is_excluded)

  it('supplyRate=1.0 → 기존 동작(원가)과 완전 일치', () => {
    const kpi = computeMatchingKpi(items, 1.0)
    const rawSsg = included.reduce((s, i) => s + estimateSsgTotal(i), 0)
    expect(kpi.ssgEstimate).toBe(rawSsg)
    expect(kpi.includedExisting).toBe(150_000)
    expect(kpi.excludedExisting).toBe(30_000)
    expect(kpi.grandTotal).toBe(180_000)
    expect(kpi.totalSavings).toBe(150_000 - rawSsg)
    expect(kpi.includedCount).toBe(2)
    expect(kpi.excludedCount).toBe(1)
  })

  it('supplyRate=1.25 → 보고서 공식(Σ round(estimateSsgTotal × rate))과 동일', () => {
    const kpi = computeMatchingKpi(items, 1.25)
    // ProposalReport.computeCategoryStats와 동일한 per-item 반올림 공식
    const reportSsg = included.reduce((s, i) => s + Math.round(estimateSsgTotal(i) * 1.25), 0)
    expect(kpi.ssgEstimate).toBe(reportSsg)
    expect(kpi.totalSavings).toBe(150_000 - reportSsg)
  })

  it('공급율 상향 시 신세계 견적↑·절감액↓ (사용자 관찰과 일치)', () => {
    const raw = computeMatchingKpi(items, 1.0)
    const marked = computeMatchingKpi(items, 1.25)
    expect(marked.ssgEstimate).toBeGreaterThan(raw.ssgEstimate)
    expect(marked.totalSavings).toBeLessThan(raw.totalSavings)
  })

  it('기본 supplyRate는 1 (인자 생략 시 원가)', () => {
    const kpi = computeMatchingKpi(items)
    const rawSsg = included.reduce((s, i) => s + estimateSsgTotal(i), 0)
    expect(kpi.ssgEstimate).toBe(rawSsg)
  })
})
