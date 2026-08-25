import { describe, expect, it } from 'vitest'
import {
  chooseLearnedDecision,
  mergeLearnedCandidate,
  normalizeComparisonMatchKey,
  type LearnedDecisionEvidence,
} from '@/lib/comparison-match-learning'
import type { SupplierMatch } from '@/types/audit'

const evidence = (
  productId: string,
  confirmations: number,
  scope: LearnedDecisionEvidence['scope'],
): LearnedDecisionEvidence => ({
  productId,
  confirmations,
  scope,
})

describe('비교 매핑 학습', () => {
  it('공백·구분자·대소문자 차이를 같은 매핑 키로 정규화한다', () => {
    expect(normalizeComparisonMatchKey(' CJ_비비고 물만두(1 KG) ')).toBe('cj비비고물만두1kg')
    expect(normalizeComparisonMatchKey('cj / 비비고-물만두 1kg')).toBe('cj비비고물만두1kg')
  })

  it('현재 세션의 일관된 확정 매핑을 가장 먼저 승계한다', () => {
    const selected = chooseLearnedDecision([
      evidence('global-product', 8, 'global'),
      evidence('session-product', 1, 'session'),
    ])

    expect(selected).toMatchObject({ productId: 'session-product', scope: 'session' })
  })

  it('같은 우선순위에서 최다 결정이 동률이면 자동 승계하지 않는다', () => {
    const selected = chooseLearnedDecision([
      evidence('product-a', 2, 'supplier'),
      evidence('product-b', 2, 'supplier'),
    ])

    expect(selected).toBeNull()
  })

  it('공급사별 이력이 없으면 2회 이상 일관된 전역 이력만 사용한다', () => {
    expect(chooseLearnedDecision([evidence('one-off', 1, 'global')])).toBeNull()
    expect(chooseLearnedDecision([evidence('stable', 2, 'global')])).toMatchObject({
      productId: 'stable',
      scope: 'global',
    })
  })

  it('학습 후보를 최상단에 중복 없이 넣고 검수 대기 상태로 표시한다', () => {
    const learned: SupplierMatch = {
      id: 'learned',
      product_name: '과거 확정 상품',
      standard_price: 4200,
      match_score: 1,
    }
    const previous: SupplierMatch[] = [
      { id: 'other', product_name: '기존 1위', standard_price: 4000, match_score: 0.8 },
      { id: 'learned', product_name: '과거 확정 상품', standard_price: 4100, match_score: 0.7 },
    ]

    const result = mergeLearnedCandidate(previous, learned)

    expect(result.map((candidate) => candidate.id)).toEqual(['learned', 'other'])
    expect(result[0].standard_price).toBe(4200)
  })
})
