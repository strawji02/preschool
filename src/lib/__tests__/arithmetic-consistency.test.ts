/**
 * 산술 정합성 회귀 테스트 (2026-05-17)
 *
 * 사용자 보고: 화면 절감액 ≠ 엑셀 절감액 (40원 차이)
 *  - 화면: categoryStats (per-category Math.round)
 *  - 엑셀: per-row 합계 (F=raw, L=INT)
 *
 * Fix 후 계약:
 *  - 모든 합계는 per-item Math.round 후 합산
 *  - screen monthlyOurCost  ==  Σ Math.round(item.ourTotal_raw)
 *  - screen monthlySsgCost  ==  Σ Math.round(estimateSsgTotal(item) × supplyRate)
 *  - Excel SUM(F)           ==  screen monthlyOurCost
 *  - Excel SUM(L)           ==  screen monthlySsgCost
 *  - Excel SUM(M)           ==  screen monthlySavings
 *
 * 이 테스트는 위 계약을 한 번에 검증. 새 합계/환산 추가 시 동일 패턴으로 추가할 것.
 */
import { describe, it, expect } from 'vitest'
import { computeCategoryStats } from '../../app/calc-food/components/ReportStep/ProposalReport'
import { estimateSsgTotal } from '../unit-conversion'
import type { ComparisonItem } from '@/types/audit'

/** 테스트용 ComparisonItem factory — 산술 입력만 채우고 나머지는 기본값 */
function makeItem(opts: {
  id: string
  name: string
  qty: number
  unit_price: number
  total?: number  // extracted_total_price (없으면 unit_price × qty 사용)
  ssg?: {
    standard_price: number
    spec_quantity?: number | null
    spec_unit?: string | null
    ppu?: number | null
    tax_type?: '과세' | '면세'
    category?: string
  }
}): ComparisonItem {
  return {
    id: opts.id,
    extracted_name: opts.name,
    extracted_quantity: opts.qty,
    extracted_unit_price: opts.unit_price,
    extracted_total_price: opts.total,
    ssg_match: opts.ssg
      ? {
          id: `ssg-${opts.id}`,
          product_name: `ssg-${opts.name}`,
          standard_price: opts.ssg.standard_price,
          match_score: 1.0,
          spec_quantity: opts.ssg.spec_quantity ?? undefined,
          spec_unit: opts.ssg.spec_unit ?? undefined,
          ppu: opts.ssg.ppu ?? undefined,
          tax_type: opts.ssg.tax_type,
          category: opts.ssg.category,
        }
      : undefined,
    cj_candidates: [],
    ssg_candidates: [],
    is_confirmed: false,
    cj_confirmed: false,
    ssg_confirmed: false,
    savings: { cj: 0, ssg: 0, max: 0 },
    match_status: opts.ssg ? 'auto_matched' : 'unmatched',
    is_excluded: false,
  }
}

/** 사용자가 신고한 케이스(40원 차이)에 가까운 fixture — 비정수 raw 값 포함 */
function buildFixtures(): ComparisonItem[] {
  return [
    // 농산 — 매칭됨, raw float total (round 시 다른 결과)
    makeItem({
      id: '1', name: '감자', qty: 3, unit_price: 8267,
      total: 24801.5,  // raw float
      ssg: { standard_price: 7250, spec_quantity: 1, spec_unit: 'KG', category: '농산' },
    }),
    makeItem({
      id: '2', name: '양파', qty: 5, unit_price: 1200.3,
      // total 미지정 → 1200.3 × 5 = 6001.5
      ssg: { standard_price: 1050, spec_quantity: 1, spec_unit: 'KG', category: '농산' },
    }),
    // 축산 — 과세 (10% 부가세 → estimateSsgTotal에 영향)
    makeItem({
      id: '3', name: '돼지고기', qty: 2, unit_price: 18750.7,
      total: 37501.5,
      ssg: { standard_price: 16500, spec_quantity: 1, spec_unit: 'KG', tax_type: '과세', category: '축산' },
    }),
    // 수산 — 매칭됨
    makeItem({
      id: '4', name: '고등어', qty: 4, unit_price: 9500.25,
      total: 38001,
      ssg: { standard_price: 8200, spec_quantity: 1, spec_unit: 'KG', category: '수산' },
    }),
    // 가공·기타 — 매칭됨
    makeItem({
      id: '5', name: '두부', qty: 6, unit_price: 2333.8,
      // total 미지정 → 14002.8
      ssg: { standard_price: 2100, spec_quantity: 1, spec_unit: 'KG', category: '가공·기타' },
    }),
    // 매칭 없음 — 합계에서 ourCost == ssgCost (절감 0)
    makeItem({ id: '6', name: '기타품', qty: 1, unit_price: 5000.4, total: 5000.4 }),
  ]
}

/** 화면 monthly 합계를 계약대로 — Σ Math.round(item) */
function computeExpectedMonthlyOur(items: ComparisonItem[]): number {
  return items
    .filter((it) => !it.is_excluded)
    .reduce((s, it) => {
      const raw = it.extracted_total_price ?? it.extracted_unit_price * it.extracted_quantity
      return s + Math.round(raw)
    }, 0)
}
function computeExpectedMonthlySsg(items: ComparisonItem[], supplyRate: number): number {
  return items
    .filter((it) => !it.is_excluded)
    .reduce((s, it) => {
      if (!it.ssg_match) {
        const raw = it.extracted_total_price ?? it.extracted_unit_price * it.extracted_quantity
        return s + Math.round(raw)  // 미매칭은 ourTotal 그대로
      }
      return s + Math.round(estimateSsgTotal(it) * supplyRate)
    }, 0)
}

// ──────────────────────────────────────────────────────────────
// 1. computeCategoryStats — per-item Math.round
// ──────────────────────────────────────────────────────────────
describe('computeCategoryStats — per-item Math.round (2026-05-17)', () => {
  it('각 stat.ourCost / ssgCost / savings는 정수 (소수점 없음)', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    for (const stat of stats) {
      expect(Number.isInteger(stat.ourCost)).toBe(true)
      expect(Number.isInteger(stat.ssgCost)).toBe(true)
      expect(Number.isInteger(stat.savings)).toBe(true)
    }
  })

  it('Σ stat.ourCost == Σ Math.round(item.ourTotal_raw) — supplyRate=1', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const sumOur = stats.reduce((s, c) => s + c.ourCost, 0)
    expect(sumOur).toBe(computeExpectedMonthlyOur(items))
  })

  it('Σ stat.ssgCost == Σ Math.round(estimateSsgTotal × supplyRate) — supplyRate=1', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const sumSsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    expect(sumSsg).toBe(computeExpectedMonthlySsg(items, 1.0))
  })

  it('Σ stat.ssgCost == Σ Math.round(estimateSsgTotal × supplyRate) — supplyRate=1.25 (마진 25%)', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.25)
    const sumSsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    expect(sumSsg).toBe(computeExpectedMonthlySsg(items, 1.25))
  })

  it('is_excluded 품목은 합계에서 제외', () => {
    const items = buildFixtures()
    items[0].is_excluded = true  // 농산 감자 제외
    const stats = computeCategoryStats(items, 1.0)
    const sumOur = stats.reduce((s, c) => s + c.ourCost, 0)
    expect(sumOur).toBe(computeExpectedMonthlyOur(items))
  })

  it('월 절감액 == ourCost - ssgCost (per-item round 합산)', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const sumOur = stats.reduce((s, c) => s + c.ourCost, 0)
    const sumSsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    const expectedSavings = sumOur - sumSsg
    // 카테고리별 savings 합은 (제로 클램핑 없는 한) monthlySavings와 일치
    const sumCategorySavings = stats.reduce((s, c) => s + c.savings, 0)
    expect(sumCategorySavings).toBe(expectedSavings)
  })
})

// ──────────────────────────────────────────────────────────────
// 2. 엑셀 export 정합성 — 화면 vs 엑셀 SUM 동일
// ──────────────────────────────────────────────────────────────
// excel-utils의 내부 함수 직접 import 불가 (file scope) — 동일 로직 재현하여 계약 검증
describe('Excel export 합계 == 화면 합계 (per-row Math.round 계약)', () => {
  /** excel-utils.existingTotal과 동일 로직 — 변경 시 두 파일 함께 수정 */
  function existingTotal(it: ComparisonItem): number {
    return Math.round(it.extracted_total_price ?? it.extracted_unit_price * it.extracted_quantity)
  }
  /** excel-utils.shinsegaePriceAmount의 amount 부분 — estimateSsgTotal 사용 */
  function ssgAmount(it: ComparisonItem): number | null {
    return it.ssg_match ? estimateSsgTotal(it) : null
  }

  it('Excel SUM(F) == screen monthlyOurCost', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const screenMonthlyOur = stats.reduce((s, c) => s + c.ourCost, 0)
    // Excel: 각 row F = Math.round(item), summary = Σ F
    const excelSumF = items
      .filter((it) => !it.is_excluded)
      .reduce((s, it) => s + existingTotal(it), 0)
    expect(excelSumF).toBe(screenMonthlyOur)
  })

  it('Excel SUM(L) == screen monthlySsgCost — supplyRate=1', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const screenMonthlySsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    // Excel: 각 row L = ROUND($L$2*K, 0), summary cache = Σ Math.round(ssg.amount × supplyRate)
    const excelSumL = items
      .filter((it) => !it.is_excluded)
      .reduce((s, it) => {
        const amt = ssgAmount(it)
        if (amt === null) {
          // 미매칭 — L 셀은 빈 문자열, screen은 ourTotal로 카운트 (computeCategoryStats 라인 참고)
          return s + existingTotal(it)
        }
        return s + Math.round(amt * 1.0)
      }, 0)
    expect(excelSumL).toBe(screenMonthlySsg)
  })

  it('Excel SUM(L) == screen monthlySsgCost — supplyRate=1.25', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.25)
    const screenMonthlySsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    const excelSumL = items
      .filter((it) => !it.is_excluded)
      .reduce((s, it) => {
        const amt = ssgAmount(it)
        if (amt === null) return s + existingTotal(it)
        return s + Math.round(amt * 1.25)
      }, 0)
    expect(excelSumL).toBe(screenMonthlySsg)
  })

  it('Excel SUM(M)=SUM(F)-SUM(L) == screen monthlySavings', () => {
    const items = buildFixtures()
    const stats = computeCategoryStats(items, 1.0)
    const screenSavings =
      stats.reduce((s, c) => s + c.ourCost, 0) - stats.reduce((s, c) => s + c.ssgCost, 0)
    const excelSumF = items
      .filter((it) => !it.is_excluded)
      .reduce((s, it) => s + existingTotal(it), 0)
    const excelSumL = items
      .filter((it) => !it.is_excluded)
      .reduce((s, it) => {
        const amt = ssgAmount(it)
        if (amt === null) return s + existingTotal(it)
        return s + Math.round(amt * 1.0)
      }, 0)
    expect(excelSumF - excelSumL).toBe(screenSavings)
  })
})

// ──────────────────────────────────────────────────────────────
// 3. 회귀 가드 — raw float을 그대로 합산하지 못하게
// ──────────────────────────────────────────────────────────────
describe('회귀 가드 — raw float 합산 금지', () => {
  it('비정수 raw total이 있어도 모든 합계는 정수', () => {
    const items: ComparisonItem[] = [
      makeItem({
        id: 'a', name: '품목A', qty: 1, unit_price: 100.7,
        total: 100.7,
        ssg: { standard_price: 90, spec_quantity: 1, spec_unit: 'KG' },
      }),
      makeItem({
        id: 'b', name: '품목B', qty: 3, unit_price: 33.4,
        // total 미지정 → 100.2
        ssg: { standard_price: 30, spec_quantity: 1, spec_unit: 'KG' },
      }),
    ]
    const stats = computeCategoryStats(items, 1.0)
    const sumOur = stats.reduce((s, c) => s + c.ourCost, 0)
    const sumSsg = stats.reduce((s, c) => s + c.ssgCost, 0)
    expect(Number.isInteger(sumOur)).toBe(true)
    expect(Number.isInteger(sumSsg)).toBe(true)
    // 추가 가드 — 합계는 round(100.7) + round(100.2) = 101 + 100 = 201
    expect(sumOur).toBe(201)
  })
})
