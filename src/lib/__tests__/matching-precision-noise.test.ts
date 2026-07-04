import { describe, it, expect } from 'vitest'
import { cleanInput, dualNormalize } from '../preprocessing'
import { getStandardTerm, expandWithSynonyms } from '../synonyms'
import { getTokenMatchRatio, MIN_VALID_MATCH_RATIO } from '../token-match'

/**
 * 매칭 정밀도 회귀 테스트 — 사용자 보고 3케이스 (2026-07-04)
 *
 * BM25는 AND 검색이라 존재하지 않는 노이즈 토큰 하나가 결과를 0으로 만들고,
 * fallback이 무관한 후보를 반환한다. 품위등급 "상/중/하" 노이즈 + 색상 동의어 부재가
 * 다음 오매칭의 근본 원인:
 *   - 쑥갓(상) → 브로컬리 (상이 상온에 매칭 + 쑥갓 검색 0건)
 *   - 양파(상) → 스파게티소스/양파드레싱 (상이 검색 오염)
 *   - 파프리카 적색 → 빨강 파프리카 매칭 실패 (적색≠빨강)
 */
describe('품위등급 노이즈 제거 (상/중/하)', () => {
  it('쑥갓(상): forKeyword에서 "상" 제거, 쑥갓만 남음', () => {
    const d = dualNormalize('쑥갓(상)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('쑥갓')
    expect(tokens).not.toContain('상')
  })

  it('양파(상): forKeyword에서 "상" 제거, 양파만 남음', () => {
    const d = dualNormalize('양파(상)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('양파')
    expect(tokens).not.toContain('상')
  })

  it('cleanInput: "상온"/"중간" 합성어의 상/중은 보존 (단독 토큰만 제거)', () => {
    expect(cleanInput('쑥갓 상온보관').primary).toContain('상온보관')
  })

  it('getTokenMatchRatio: 쑥갓(상) vs 브로컬리 상온 → 임계값 미만 (상↔상온 오매칭 차단)', () => {
    const r = getTokenMatchRatio('쑥갓(상)', '브로컬리 국내산 상온')
    expect(r).toBeLessThan(MIN_VALID_MATCH_RATIO)
  })
})

describe('색상 동의어 (적색→빨강)', () => {
  it('getStandardTerm("적색") === "빨강"', () => {
    expect(getStandardTerm('적색')).toBe('빨강')
  })

  it('파프리카(상)(적색): 등급 "상" 제거 + 적색이 빨강으로 확장돼 빨강파프리카 검색 가능', () => {
    // 검색은 forKeyword 치환이 아니라 동의어 확장(expandWithSynonyms)이 구동.
    // 적색 → [빨강, ...] 확장으로 신세계 "빨강 파프리카"가 후보 풀에 들어옴.
    const d = dualNormalize('파프리카(상)(적색)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('파프리카')
    expect(tokens).not.toContain('상') // 등급 노이즈 제거 (BM25 0건 방지)
    expect(expandWithSynonyms('적색')).toContain('빨강') // 색상 표준어 확장
  })

  it('노랑 동의어: 황색 → 노랑', () => {
    expect(getStandardTerm('황색')).toBe('노랑')
  })
})
