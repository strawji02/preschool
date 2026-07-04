import { describe, it, expect } from 'vitest'
import { cleanInput, dualNormalize } from '../preprocessing'
import { getStandardTerm, expandWithSynonyms } from '../synonyms'
import { getTokenMatchRatio, MIN_VALID_MATCH_RATIO, cleanProductQuery, parsePerPieceGrams } from '../token-match'

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

  it('파프리카(특품_적색): 언더스코어 구분자 분리 → 적색이 독립 토큰으로 살아남아 빨강 확장', () => {
    // 버그: 괄호 안 "_"가 필드구분자인데 공백변환 안 돼 "특품적색"으로 붙고,
    //   특수문자 제거 단계에서 "_"만 사라져 적색이 소멸 → 적색→빨강 확장 실패 →
    //   파프리카류 중 노랑이 hybrid 점수로 1위 오매칭.
    const d = dualNormalize('파프리카(특품_적색)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).toContain('파프리카')
    expect(tokens).toContain('적색')      // 언더스코어 분리로 독립 토큰 보존
    expect(tokens).not.toContain('특품적색') // 붙은 노이즈 토큰 아님
    expect(expandWithSynonyms('적색')).toContain('빨강')
  })
})

describe('명사 끝음절 "이" 조사 오인 방지 (오이류)', () => {
  it('오이: forKeyword가 "오"로 파괴되지 않고 "오이" 유지', () => {
    expect(dualNormalize('오이').forKeyword).toBe('오이')
    expect(dualNormalize('청오이').forKeyword).toBe('청오이')
  })

  it('가시오이(특품): 오이로 확장돼 신세계 오이류 검색 가능', () => {
    const d = dualNormalize('가시오이(특품)')
    expect(d.forKeyword.split(/\s+/)).toContain('가시오이')
    expect(expandWithSynonyms('가시오이')).toContain('오이')
  })

  it('자른미역/옛날자른미역: 미역으로 확장', () => {
    expect(expandWithSynonyms('자른미역')).toContain('미역')
    expect(expandWithSynonyms('옛날자른미역')).toContain('미역')
  })
})

describe('소고기 부위 상호 대체 — 홍두깨 ↔ 우둔 (사용자 등록 2026-07-04)', () => {
  // 홍두깨살·우둔살은 소 뒷다리 안쪽 저지방 살코기로 결이 곧고,
  // 장조림·육회·산적·육포에 상호 대체 가능. 급식 발주에서 혼용됨.
  it('홍두깨 → 우둔 방향 확장', () => {
    expect(expandWithSynonyms('홍두깨')).toContain('우둔')
    expect(expandWithSynonyms('홍두깨살')).toContain('우둔')
  })

  it('우둔 → 홍두깨 방향 확장 (양방향)', () => {
    expect(expandWithSynonyms('우둔')).toContain('홍두깨')
    expect(expandWithSynonyms('한우우둔')).toContain('홍두깨')
    expect(expandWithSynonyms('소우둔')).toContain('홍두깨')
  })

  it('둘은 같은 표준어로 수렴', () => {
    expect(getStandardTerm('홍두깨')).toBe(getStandardTerm('우둔'))
  })
})

describe('명세서 단일 대문자 접두코드 제거 (N/P/K/S/E/R…) — 사용자 보고 2026-07-04', () => {
  // 신세계 거래명세서는 품목명 앞에 분류/등급 접두코드(단일 대문자)를 붙임:
  //   "N (계란)특란(무항생제)", "P-술찌", "K-[아위카즈]", "E-(친환경)..."
  // 이 접두가 forKeyword 맨 앞 토큰으로 남으면 expandWithCompoundSplitting의
  // slice(0,4)에서 슬롯을 차지해 핵심 등급어(특란/무항생제)를 밀어내고,
  // BM25 OR 쿼리에 'N'|'P'가 들어가 "N 사이다"·"N 콜라" 같은 노이즈를 끌어올림.
  it('N (계란)특란(무항생제): 맨 앞 "N" 제거, 계란/특란 보존', () => {
    const d = dualNormalize('N (계란)특란(무항생제)')
    const tokens = d.forKeyword.split(/\s+/).filter(Boolean)
    expect(tokens).not.toContain('N')       // 단독 노이즈 토큰 제거
    expect(d.forKeyword).not.toMatch(/^N\b/) // 맨 앞 아님
    expect(tokens).toContain('계란')
    expect(tokens).toContain('특란')
    expect(tokens).toContain('무항생제')
  })

  it('P-술찌 / K-아위카즈: 하이픈 접두코드 제거', () => {
    expect(cleanInput('P-술찌').primary).toBe('술찌')
    expect(cleanInput('K-아위카즈').primary.startsWith('K')).toBe(false)
  })

  it('오탐 방지: 두 글자 이상 대문자 약어(CJ 등)는 보존', () => {
    // 'C' 뒤가 대문자 'J'라 단일 접두 아님 → 유지
    expect(cleanInput('CJ만두').primary).toContain('CJ')
  })
})

describe('cleanProductQuery 괄호 안 식자재어 보존 (AI 추천 후보 경로) — 사용자 보고 2026-07-04', () => {
  // AI 추천 후보(/api/products/search)는 search_term_raw로 cleanProductQuery 결과를 씀.
  // 기존엔 괄호 안을 통째 삭제해 "N (계란)특란(무항생제)" → "N 특란"으로
  // 핵심어(계란/무항생제)가 소실되고 접두 N만 남아 trigram이 "N 콜라/사이다"로 감.
  // cleanInput(명세서 재분석 경로)은 이미 괄호 내용을 보존하도록 고쳤으나
  // cleanProductQuery(AI후보 경로)는 구식이라 두 경로가 불일치했음.
  it('N (계란)특란(무항생제): 괄호 안 식자재어(계란) 보존, 접두 N 제거', () => {
    const r = cleanProductQuery('N (계란)특란(무항생제)')
    expect(r).toContain('계란')          // 핵심 식자재어 보존 (기존엔 소실 → 콜라/사이다 오매칭)
    expect(r).toContain('특란')          // 크기등급 보존
    expect(r.split(/\s+/)).not.toContain('N') // 접두 단독 노이즈 제거
    // '무항생제'는 GENERIC_MODIFIER라 raw에서 빠져도 매칭 무해 (ratio 계산서 제외 대상)
  })

  it('숫자 포함 spec 괄호는 계속 제거 (회귀 방지)', () => {
    // 용량/규격 괄호는 노이즈이므로 기존대로 제거
    const r = cleanProductQuery('세척당근(특품 200~280g/개)')
    expect(r).toContain('당근')
    expect(r).not.toMatch(/200|280/)
  })
})

describe('parsePerPieceGrams 개당중량 파싱 (원산지·중량 랭킹) — 사용자 요청 2026-07-04', () => {
  // 당근 검수 "KG(씻은_개당130∼200g_국내산)"의 개당중량과
  // 후보 "1KG, 개당120g이상"/"개당200g이상"의 근접도로 랭킹.
  it('개당 범위(130~200g)는 중앙값 반환', () => {
    expect(parsePerPieceGrams('KG(씻은_개당130∼200g_국내산)')).toBe(165)
    expect(parsePerPieceGrams('개당 60~68g/30ea')).toBe(64)
  })

  it('개당 단일값(120g이상)은 그 값', () => {
    expect(parsePerPieceGrams('1KG, 개당120g이상')).toBe(120)
    expect(parsePerPieceGrams('1KG, 개당200g이상')).toBe(200)
  })

  it('"개당" 키워드 없으면 null (총중량/용량 오인 방지)', () => {
    expect(parsePerPieceGrams('1KG')).toBeNull()
    expect(parsePerPieceGrams('1KG, 250G 이상')).toBeNull()
    expect(parsePerPieceGrams('')).toBeNull()
  })
})

describe('cleanProductQuery 통짜 합성어 분해 (검수측, 상품 mig 047과 대칭) — 사용자 보고 2026-07-04', () => {
  // "미니쌀약과"가 통짜라 "약과" 검색어가 안 생겨 trigram이 "미니 감자핫도그"·"미니 농심"
  // 같은 미니 제품을 끌어올림. 상품 search_vector는 분해했으나 검수 검색어는 통짜였음.
  it('P Oh! 미니쌀약과: 접미 품목어 "약과"가 독립 토큰으로 분리', () => {
    const r = cleanProductQuery('P Oh! 미니쌀약과')
    expect(r.split(/\s+/)).toContain('약과')  // 핵심 품목어 독립 → 약과 상품 BM25 매칭
  })

  it('미니쌀약과: 접미 "약과" 분리 (미니쌀 약과)', () => {
    const r = cleanProductQuery('미니쌀약과')
    expect(r.split(/\s+/)).toContain('약과')
  })

  it('오탐 방지: 미니크리스피핫도그는 접미 분리 안 됨 (핫도그 full match 보존)', () => {
    // 접두 분리를 넣지 않으므로 핫도그 통짜 매칭이 그대로 유지되어야 함
    const cleaned = cleanProductQuery('크레잇 미니크리스피핫도그(50g*10입 500g/EA)')
    expect(getTokenMatchRatio(cleaned, '핫도그 대상')).toBeGreaterThanOrEqual(1)
  })
})
