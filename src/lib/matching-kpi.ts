/**
 * 매칭 화면 KPI 계산 — 순수함수 (2026-07-21)
 *
 * 기존엔 PrecisionMatchingView 내부 useMemo에서 신세계 견적을 estimateSsgTotal(원가)
 * 그대로 합산 → 공급율(마진 배율) 미반영 → 최종 보고서(공급율 1.25 적용)와 절감액 불일치.
 *
 * 본 함수는 보고서(ProposalReport.computeCategoryStats)와 동일한 per-item 반올림 공식
 *   ssg = Σ round(estimateSsgTotal(item) × supplyRate)
 * 을 적용해 매칭 화면과 보고서의 신세계 견적·절감액을 일치시킨다.
 *   - supplyRate=1.0 → estimateSsgTotal이 항상 정수이므로 기존 동작과 완전 동일
 *   - supplyRate=1.25 → 25% 마진 적용가 (사용자 최종 판매가)
 *
 * 비교불가(is_excluded) 품목은 절감 산출에서 분리한다.
 */
import { estimateSsgTotal } from './unit-conversion'
import type { ComparisonItem } from '@/types/audit'

function getExistingTotal(item: ComparisonItem): number {
  return item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
}

export interface MatchingKpi {
  /** 거래명세표 원본 합계 (비교가능 + 비교불가) */
  grandTotal: number
  /** 비교 가능 품목 기존 합계 */
  includedExisting: number
  includedCount: number
  /** 비교불가 품목 기존 합계 */
  excludedExisting: number
  excludedCount: number
  /** 신세계 견적 (공급율 반영) */
  ssgEstimate: number
  /** 총 절감액 (비교 가능 기준) */
  totalSavings: number
  savingPercent: number
  total: number
  confirmed: number
}

export function computeMatchingKpi(items: ComparisonItem[], supplyRate: number = 1): MatchingKpi {
  const included = items.filter((i) => !i.is_excluded)
  const excluded = items.filter((i) => i.is_excluded)

  const includedExisting = included.reduce((sum, i) => sum + getExistingTotal(i), 0)
  const excludedExisting = excluded.reduce((sum, i) => sum + getExistingTotal(i), 0)
  const grandTotal = includedExisting + excludedExisting

  // 공급율 반영 — 보고서 computeCategoryStats와 동일한 per-item 반올림
  const ssgEstimate = included.reduce(
    (sum, i) => sum + Math.round(estimateSsgTotal(i) * supplyRate),
    0,
  )
  const totalSavings = includedExisting - ssgEstimate
  const savingPercent = includedExisting > 0 ? (totalSavings / includedExisting) * 100 : 0
  const confirmed = included.filter((i) => i.is_confirmed).length

  return {
    grandTotal,
    includedExisting,
    includedCount: included.length,
    excludedExisting,
    excludedCount: excluded.length,
    ssgEstimate,
    totalSavings,
    savingPercent,
    total: items.length,
    confirmed,
  }
}
