import { describe, it, expect } from 'vitest'
import { canConfirmItem, healConfirmedWithoutMatch } from '../confirm-guard'
import type { ComparisonItem } from '@/types/audit'

function item(o: Partial<ComparisonItem>): ComparisonItem {
  return {
    id: 'x', extracted_name: '품목', extracted_quantity: 1,
    extracted_unit_price: 0, is_confirmed: false, is_excluded: false,
    ...o,
  } as ComparisonItem
}
const ssg = { id: 's', product_name: 'p', standard_price: 100, match_score: 1 } as never
const cj = { id: 'c', product_name: 'p', standard_price: 100, match_score: 1 } as never

describe('canConfirmItem — 확정은 매칭이 있어야만 가능 (A안)', () => {
  it('SHINSEGAE: ssg_match 있으면 확정 가능', () => {
    expect(canConfirmItem(item({ ssg_match: ssg }), 'SHINSEGAE')).toBe(true)
  })
  it('SHINSEGAE: ssg_match 없으면 확정 불가 (핵심 버그)', () => {
    expect(canConfirmItem(item({ ssg_match: undefined }), 'SHINSEGAE')).toBe(false)
    // cj_match만 있어도 SHINSEGAE 확정은 불가
    expect(canConfirmItem(item({ cj_match: cj }), 'SHINSEGAE')).toBe(false)
  })
  it('CJ: cj_match 유무로 판정', () => {
    expect(canConfirmItem(item({ cj_match: cj }), 'CJ')).toBe(true)
    expect(canConfirmItem(item({}), 'CJ')).toBe(false)
  })
  it('supplier 미지정: 아무 매칭이라도 있으면 가능, 없으면 불가', () => {
    expect(canConfirmItem(item({ ssg_match: ssg }))).toBe(true)
    expect(canConfirmItem(item({ cj_match: cj }))).toBe(true)
    expect(canConfirmItem(item({}))).toBe(false)
  })
  it('매칭 전혀 없는 품목(호박잎 케이스)은 어떤 경로로도 확정 불가', () => {
    const noMatch = item({ ssg_match: undefined, cj_match: undefined })
    expect(canConfirmItem(noMatch, 'SHINSEGAE')).toBe(false)
    expect(canConfirmItem(noMatch, 'CJ')).toBe(false)
    expect(canConfirmItem(noMatch)).toBe(false)
  })
})

describe('healConfirmedWithoutMatch — 로드 시 오염 데이터 자가치유', () => {
  it('확정+무매칭+비제외 → 미확정으로 복원 (#109 호박잎)', () => {
    const healed = healConfirmedWithoutMatch([
      item({ id: '109', is_confirmed: true, ssg_match: undefined, cj_match: undefined }),
    ])
    expect(healed[0].is_confirmed).toBe(false)
  })

  it('확정+매칭 있음 → 유지', () => {
    const healed = healConfirmedWithoutMatch([
      item({ id: 'ok', is_confirmed: true, ssg_match: ssg }),
    ])
    expect(healed[0].is_confirmed).toBe(true)
  })

  it('비교불가(is_excluded) 무매칭 확정 → 유지 (정당한 검토 완료)', () => {
    const healed = healConfirmedWithoutMatch([
      item({ id: 'ex', is_confirmed: true, is_excluded: true, ssg_match: undefined }),
    ])
    expect(healed[0].is_confirmed).toBe(true)
  })

  it('멱등 — 두 번 적용해도 동일', () => {
    const once = healConfirmedWithoutMatch([item({ is_confirmed: true })])
    const twice = healConfirmedWithoutMatch(once)
    expect(twice[0].is_confirmed).toBe(false)
  })
})
