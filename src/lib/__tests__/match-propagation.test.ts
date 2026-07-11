import { describe, it, expect } from 'vitest'
import { normalizeItemName, findPropagationTargets, applyPropagation } from '../match-propagation'
import type { ComparisonItem } from '@/types/audit'

function item(o: {
  id: string; name: string; confirmed?: boolean; excluded?: boolean; matched?: boolean
}): ComparisonItem {
  return {
    id: o.id,
    extracted_name: o.name,
    extracted_quantity: 1,
    extracted_unit_price: 1000,
    ssg_match: o.matched
      ? { id: `p-${o.id}`, product_name: '풀무원 콩나물', standard_price: 800, match_score: 1 }
      : undefined,
    cj_candidates: [],
    ssg_candidates: [],
    is_confirmed: o.confirmed ?? false,
    cj_confirmed: false,
    ssg_confirmed: false,
    savings: { cj: 0, ssg: 0, max: 0 },
    match_status: o.matched ? 'manual_matched' : 'unmatched',
    is_excluded: o.excluded ?? false,
  } as ComparisonItem
}

describe('normalizeItemName', () => {
  it('공백·대소문자 정규화', () => {
    expect(normalizeItemName('  특등급  국산콩나물 ')).toBe('특등급 국산콩나물')
    expect(normalizeItemName('ABC')).toBe('abc')
    expect(normalizeItemName(null)).toBe('')
  })
})

describe('findPropagationTargets — 동일 품목명 미확정만', () => {
  const items = [
    item({ id: 'src', name: '특등급국산콩콩나물_1kg', confirmed: true, matched: true }), // 방금 확정한 source
    item({ id: 'a', name: '특등급국산콩콩나물_1kg' }), // 동일명 미확정 → 대상
    item({ id: 'b', name: '특등급국산콩콩나물_1kg', confirmed: true }), // 이미 확정 → 제외
    item({ id: 'c', name: '특등급국산콩콩나물_1kg', excluded: true }), // 비교불가 → 제외
    item({ id: 'd', name: '특등급국산콩나물_500g' }), // 이름 다름 → 제외
    item({ id: 'e', name: '  특등급국산콩콩나물_1kg  ' }), // 공백만 다름 → 대상
  ]

  it('동일명 미확정·비제외만 대상 (a, e)', () => {
    expect(findPropagationTargets(items, 'src').sort()).toEqual(['a', 'e'])
  })

  it('source가 매칭 없으면 전파 안 함', () => {
    const noMatch = [item({ id: 'src', name: '무', confirmed: true }), item({ id: 'a', name: '무' })]
    expect(findPropagationTargets(noMatch, 'src')).toEqual([])
  })
})

describe('applyPropagation — 매칭 복사 + 확정', () => {
  const items = [
    item({ id: 'src', name: '콩나물', confirmed: true, matched: true }),
    item({ id: 'a', name: '콩나물' }),
    item({ id: 'z', name: '양파' }),
  ]

  it('대상에 source 매칭 복사 + 확정, 나머지 불변', () => {
    const out = applyPropagation(items, 'src', ['a'])
    const a = out.find((x) => x.id === 'a')!
    expect(a.is_confirmed).toBe(true)
    expect(a.ssg_confirmed).toBe(true)
    expect(a.match_status).toBe('manual_matched')
    expect(a.is_excluded).toBe(false)
    expect(a.ssg_match?.id).toBe('p-src')
    expect(a.ssg_match?.standard_price).toBe(800)
    // 무관 품목 불변
    expect(out.find((x) => x.id === 'z')!.is_confirmed).toBe(false)
  })

  it('targetIds 비면 원본 그대로', () => {
    expect(applyPropagation(items, 'src', [])).toBe(items)
  })
})
