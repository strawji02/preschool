import { describe, it, expect } from 'vitest'
import { cleanInput } from '../preprocessing'
import {
  cleanProductQuery,
  getTokenMatchRatio,
  parsePerPieceGrams,
  comparePerPieceCloseness,
  splitCompoundAffixes,
  tokenize,
  SUPPLIER_BRANDS,
  GENERIC_MODIFIERS,
} from '../token-match'
import { expandWithSynonyms } from '../synonyms'

/**
 * 골든셋 회귀 스위트 (2026-07-04 신설)
 *
 * 배경: 한 품목을 고치면 다른 품목이 회귀하는 문제가 반복됨
 *   (예: "미니" 접두 분리 → "미니크리스피핫도그→핫도그" full match 파괴).
 *
 * 목적: 지금까지 사용자가 보고한 실제 품목들을 "입력 → 기대"로 한 곳에 모아,
 *   어떤 매칭 수정이든 이 파일을 통과해야만 하도록 강제한다.
 *   → 새 수정이 기존 케이스를 깨면 즉시 RED로 드러난다.
 *
 * 규칙: 새 매칭 버그를 고칠 때마다 여기에 케이스를 1개 추가한다.
 *   반드시 실제 함수(cleanProductQuery/getTokenMatchRatio/정렬 비교자)로 검증하고,
 *   DB 수동 재현이나 손계산 시뮬로 대체하지 않는다.
 */
describe('골든셋: 검수 품목명 → 검색어 핵심 토큰', () => {
  const tokens = (q: string) => cleanProductQuery(q).split(/\s+/).filter(Boolean)

  it('계란: N (계란)특란(무항생제) → 계란/특란 보존, 접두 N 제거', () => {
    const t = tokens('N (계란)특란(무항생제)')
    expect(t).toContain('계란')
    expect(t).toContain('특란')
    expect(t).not.toContain('N')
  })

  it('약과: P Oh! 미니쌀약과 → 접미 "약과" 독립 토큰', () => {
    expect(tokens('P Oh! 미니쌀약과')).toContain('약과')
  })

  it('쌈무: 비트쌈무 → 접미 "쌈무" 독립 토큰 (비트가 아니라 쌈무가 키워드)', () => {
    expect(tokens('비트쌈무')).toContain('쌈무')
  })

  it('접두코드: P-술찌 → 술찌 (단일 대문자 접두 제거)', () => {
    expect(cleanInput('P-술찌').primary).toBe('술찌')
  })
})

describe('골든셋: 오탐 방지 (한 수정이 깨면 안 되는 케이스)', () => {
  it('핫도그: 미니크리스피핫도그는 접두 분리 안 됨 → 핫도그 full match 유지', () => {
    const cleaned = cleanProductQuery('크레잇 미니크리스피핫도그(50g*10입 500g/EA)')
    expect(getTokenMatchRatio(cleaned, '핫도그 대상')).toBeGreaterThanOrEqual(1)
  })

  it('닭다짐육: 다짐 접두 분리 안 됨 → 닭 다짐육 후보 매칭 유지', () => {
    const cleaned = cleanProductQuery('닭다짐육 1kg')
    expect(getTokenMatchRatio(cleaned, '닭가슴살 국내산 1KG, 다짐육')).toBeGreaterThanOrEqual(1)
  })

  it('CJ 약어: 두 글자 대문자 접두는 보존', () => {
    expect(cleanInput('CJ만두').primary).toContain('CJ')
  })
})

describe('골든셋: 당근 개당중량 정렬 (실제 정렬 비교자로 검증)', () => {
  // 검수 "당근 개당130~200g"(중앙 165g) → 개당중량 명시 세척당근이
  // 개당중량 없는 컷팅당근보다 위여야 함. (파이썬 시뮬이 아니라 실제 비교자 사용)
  const ITEM_G = parsePerPieceGrams('KG(씻은_개당130∼200g_국내산)') // 165

  it('검수 개당중량이 165로 파싱된다', () => {
    expect(ITEM_G).toBe(165)
  })

  it('세척당근(개당200g 명시) > 컷팅당근(미명시)', () => {
    const cmp = comparePerPieceCloseness(ITEM_G, '1KG, 개당200g이상', '1KG, 2mm 채')
    expect(cmp).toBeLessThan(0) // 음수 = 세척당근(a) 우선
  })

  it('둘 다 개당중량 명시면 근접한 쪽 우선 (200g이 120g보다 165에 가까움)', () => {
    const cmp = comparePerPieceCloseness(ITEM_G, '개당200g이상', '개당120g이상')
    expect(cmp).toBeLessThan(0)
  })

  it('검수가 개당중량 미지정이면 0 (다른 정렬키에 위임)', () => {
    expect(comparePerPieceCloseness(null, '개당200g이상', '1KG')).toBe(0)
  })

  it('세척당근(통짜)이 컷팅당근과 토큰비율 동급 (mig047 대칭 — 정렬 1번서 안 밀림)', () => {
    const item = cleanProductQuery('당근(상)')
    const seuk = getTokenMatchRatio(item, '세척당근 국내산 실온(냉장 권장)')
    const cut = getTokenMatchRatio(item, '컷팅 당근 국내산 냉장')
    expect(seuk).toBe(cut) // 둘 다 "당근" 정확매칭 → 개당중량 정렬이 최종 결정
  })

  it('오탐: 옥수수→수수 suffix 매칭 안 됨 (통짜 분해가 오매칭 유발 안 함)', () => {
    expect(getTokenMatchRatio('수수', '옥수수 국내산')).toBeLessThan(1.5)
  })
})

describe('골든셋: 김(海苔) 통짜 recall (짱구김 → 김)', () => {
  it('검수 "짱구김(식탁용특大)" → "김" 독립 토큰', () => {
    const t = cleanProductQuery('짱구김(식탁용특大)').split(/\s+/).filter(Boolean)
    expect(t).toContain('김')
  })

  it('짱구김 ↔ 재래김: 통짜 분해로 "김" 토큰 매칭 성립 (mig048 대칭)', () => {
    const item = cleanProductQuery('짱구김(식탁용특大)') // "짱구 김 …"
    // "김" 토큰이 생겨 재래김이 매칭 후보가 됨(분해 전 통짜였다면 0). 랭킹 상위는 DB recall이 담당.
    expect(getTokenMatchRatio(item, '재래김 국내산 건냉')).toBeGreaterThan(0)
    expect(getTokenMatchRatio('짱구김', '재래김')).toBe(0) // 통짜끼리는 매칭 안 됨(대조군)
  })

  it('오탐 방지: 튀김은 "튀 김"으로 깨지지 않음', () => {
    expect(splitCompoundAffixes('감자튀김')).toBe('감자튀김')
    expect(splitCompoundAffixes('오징어튀김 국내산 1KG')).toBe('오징어튀김 국내산 1KG')
  })

  it('오탐 방지: 김치·김밥(앞 "김")은 불변', () => {
    expect(splitCompoundAffixes('미역김치')).toBe('미역김치')
    expect(splitCompoundAffixes('김밥')).toBe('김밥')
  })

  it('김밥김(뒤 "김")은 마지막 김만 분리', () => {
    expect(splitCompoundAffixes('구운 김밥김 국내제조')).toBe('구운 김밥 김 국내제조')
  })
})

describe('골든셋: 브랜드 노이즈 제거 (매실청 백설 → 매실청)', () => {
  // route(products/search)의 검색 clean 토큰 필터를 그대로 재현:
  //   meaningful = tokenize(cleanProductQuery(q)).filter(!SUPPLIER_BRANDS && !GENERIC)
  const meaningful = (q: string) =>
    tokenize(cleanProductQuery(q)).filter(
      (t) => !SUPPLIER_BRANDS.has(t) && !GENERIC_MODIFIERS.has(t),
    )

  it('"백설"이 CJ 브랜드로 등록됨', () => {
    expect(SUPPLIER_BRANDS.has('백설')).toBe(true)
  })

  it('매실청 백설 → 검색 키워드는 "매실청" (백설 제외)', () => {
    expect(meaningful('매실청 백설')).toEqual(['매실청'])
  })

  it('오탐 방지: "백설기"(떡)는 통짜라 제거되지 않음', () => {
    // "백설"만 브랜드 토큰 — "백설기"는 별개 토큰이라 유지되어야 함
    expect(meaningful('백설기')).toContain('백설기')
  })
})

describe('골든셋: 동의어 상호 확장', () => {
  it('홍두깨 ↔ 우둔', () => {
    expect(expandWithSynonyms('홍두깨')).toContain('우둔')
    expect(expandWithSynonyms('우둔')).toContain('홍두깨')
  })
})
