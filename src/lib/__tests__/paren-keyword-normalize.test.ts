import { describe, it, expect } from 'vitest'
import { cleanInput, dualNormalize } from '../preprocessing'

/**
 * 괄호 안 핵심 키워드 보존 회귀 테스트
 *
 * 버그: 아워홈 거래명세표 품목 "N (계란)특란(무항생제)"에서
 *   cleanInput이 괄호를 공백 없이 본문에 합쳐 "N 계란특란무항생제"로 붙어버림.
 *   → BM25가 계란/특란/무항생제를 못 쪼개 계란 상품 검색 실패, 엉뚱한 채소가 매칭됨.
 * 기대: 괄호를 공백으로 분리해 "계란", "특란", "무항생제"가 독립 토큰이 되어야 함.
 */
describe('cleanInput — 괄호 안 키워드 공백 분리', () => {
  it('"N (계란)특란(무항생제)": 계란/특란/무항생제가 붙지 않고 분리', () => {
    const { primary } = cleanInput('N (계란)특란(무항생제)')
    // 한 덩어리로 붙으면 안 됨
    expect(primary).not.toContain('계란특란')
    expect(primary).not.toContain('특란무항생제')
    // 각 키워드가 독립 토큰으로 존재
    const tokens = primary.split(/\s+/)
    expect(tokens).toContain('계란')
    expect(tokens).toContain('특란')
  })

  it('"(계란)특란": 앞 괄호 단어와 뒤 단어 분리', () => {
    const { primary } = cleanInput('(계란)특란')
    const tokens = primary.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('계란')
    expect(tokens).toContain('특란')
  })

  it('OCR 단어조각 "(컷 팅)"은 여전히 내부공백 제거해 "컷팅"으로 합침', () => {
    const { primary } = cleanInput('오이슬라이스(컷 팅)')
    // 괄호 내부 공백은 제거 (컷 팅 → 컷팅), 단 이웃 단어와는 공백 분리
    expect(primary).toContain('컷팅')
    expect(primary).not.toContain('컷 팅')
  })
})

describe('dualNormalize — 계란 검색어 보존', () => {
  it('"N (계란)특란(무항생제)" forKeyword에 계란이 독립 토큰으로 포함', () => {
    const d = dualNormalize('N (계란)특란(무항생제)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('계란')
    expect(d.forKeyword).not.toContain('계란특란')
  })
})
