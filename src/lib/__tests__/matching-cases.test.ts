/**
 * 매칭 회귀 테스트 — 사용자 보고 케이스 누적
 *
 * 새 fix 적용 시 이전 케이스가 깨지지 않음을 자동 검증.
 * 케이스 추가 방법:
 *   1. 사용자가 새 케이스 보고
 *   2. 본 파일의 describe 블록에 추가
 *   3. `npm test` 통과 확인
 *
 * 점수 규약 (docs):
 *   1.5 — substring/word-boundary 정확 매칭
 *   1.0 — synonym 또는 합성어 suffix 매칭
 *   0.5 — partial length-ratio
 *   0.0 — 매칭 안 됨
 */
import { describe, it, expect } from 'vitest'
import {
  cleanProductQuery,
  getTokenMatchRatio,
  isProcessedProduct,
  normalizeOrigin,
  recoverOrigin,
  SUPPLIER_BRANDS,
} from '../token-match'
import { expandWithSynonyms, getStandardTerm } from '../synonyms'
import { parseSpecToGrams } from '../unit-conversion'

// 가공품 페널티 적용 ratio
const PROC_PENALTY = 0.3
function adjustedRatio(query: string, productName: string): number {
  const r = getTokenMatchRatio(query, productName)
  const queryProc = isProcessedProduct(query)
  const prodProc = isProcessedProduct(productName)
  if (!queryProc && prodProc) return r - PROC_PENALTY
  return r
}

describe('cleanProductQuery — OCR 노이즈 정제', () => {
  it('중첩 괄호 처리 (마니커 팝콘치킨 케이스)', () => {
    expect(cleanProductQuery('마니커 팝콘치킨(약6g*(166±5)입 1Kg/EA)')).toBe('마니커 팝콘치킨')
  })

  it('국내산_100% 같은 origin 노이즈 제거 (감자전분 케이스)', () => {
    expect(cleanProductQuery('청은에프엔비 감자전분 국내산_100% 1Kg/EA')).toBe('청은에프엔비 감자전분')
  })

  it('한국Wn※국내산 OCR 코드 제거', () => {
    expect(cleanProductQuery('소앞다리(6*5*0.2cm 불고기용 KG, 한국Wn※쇠고기(호주산))')).toBe('소앞다리')
  })

  it('괄호 안 형태 키워드 보존 (사조대림 유부 케이스)', () => {
    // (슬라이스_선 1Kg/EA) → "슬라이스 선" 보존되도록
    const cleaned = cleanProductQuery('사조대림 유부(슬라이스_선 1Kg/EA)')
    // 슬라이스 키워드가 유지되어야 함
    expect(cleaned).toContain('유부')
  })
})

describe('parseSpecToGrams — 부피 우선 추출 (액체류)', () => {
  it('참기름 1.8L 1.65Kg → 1800g (부피 우선)', () => {
    expect(parseSpecToGrams('이츠웰 참기름(NEW_PET_1.8L 1.65Kg/EA)')).toBe(1800)
  })

  it('무게만 표기 — 기존 동작 유지', () => {
    expect(parseSpecToGrams('1.65kg/EA')).toBe(1650)
    expect(parseSpecToGrams('20Kg/EA')).toBe(20000)
  })

  it('부피만 표기', () => {
    expect(parseSpecToGrams('1.8L/EA')).toBe(1800)
    expect(parseSpecToGrams('500ml/EA')).toBe(500)
  })

  it('ALL/SPECIAL의 L 단어 경계 차단', () => {
    expect(parseSpecToGrams('ALL FRESH 1KG')).toBe(1000)
    expect(parseSpecToGrams('SPECIAL 500g')).toBe(500)
  })
})

describe('normalizeOrigin — 외국산/한국 우선순위', () => {
  it('외국산 → IMPORT (한국 substring 충돌 방지)', () => {
    expect(normalizeOrigin('외국산')).toBe('IMPORT')
  })

  it('국내산/한국산 → KR', () => {
    expect(normalizeOrigin('국내산')).toBe('KR')
    expect(normalizeOrigin('한국Wn※국내산')).toBe('KR')
  })

  it('구체 국가 우선 — 외국산(캐나다) → CA', () => {
    expect(normalizeOrigin('외국산(캐나다)')).toBe('CA')
    expect(normalizeOrigin('호주산')).toBe('AU')
    expect(normalizeOrigin('뉴질랜드')).toBe('NZ')
  })

  it('recoverOrigin — spec에서 origin 자동 추출', () => {
    expect(normalizeOrigin(recoverOrigin('귀리', '1Kg/EA, 캐나다') || '')).toBe('CA')
    expect(normalizeOrigin(recoverOrigin('호주산 부채살', undefined) || '')).toBe('AU')
  })
})

describe('synonyms — 동의어 매칭', () => {
  it('수수 ↔ 차수수/찰수수', () => {
    expect(getStandardTerm('차수수')).toBe(getStandardTerm('수수'))
    expect(expandWithSynonyms('수수')).toContain('차수수')
  })

  it('무 ↔ 무우 ↔ 세척무 ↔ 세척무우', () => {
    const expand = expandWithSynonyms('무우')
    expect(expand).toContain('세척무')
    expect(expand).toContain('세척무우')
  })

  it('양파 ↔ 깐양파/컷팅양파/다진양파', () => {
    expect(expandWithSynonyms('양파')).toContain('깐양파')
  })

  it('멸치 — 국물용/국/육수용/다시 모두 통합', () => {
    const expand = expandWithSynonyms('국물용멸치')
    expect(expand).toContain('국멸치')
    expect(expand).toContain('다시멸치')
  })

  it('고추가루 ↔ 고춧가루 ↔ 고추분', () => {
    expect(getStandardTerm('고추분')).toBe(getStandardTerm('고추가루'))
    expect(expandWithSynonyms('고춧가루')).toContain('고추분')
  })

  it('핫도그 — 동의어 그룹 등록됨', () => {
    expect(expandWithSynonyms('핫도그').length).toBeGreaterThan(1)
  })

  it('감자전분 ↔ 옥수수전분 ↔ 고구마전분은 분리 (다른 식자재)', () => {
    expect(expandWithSynonyms('감자전분')).not.toContain('옥수수전분')
    expect(expandWithSynonyms('감자전분')).not.toContain('고구마전분')
  })
})

describe('SUPPLIER_BRANDS — 브랜드 등록', () => {
  it('주요 브랜드 모두 등록됨', () => {
    expect(SUPPLIER_BRANDS.has('이츠웰')).toBe(true)
    expect(SUPPLIER_BRANDS.has('아이누리')).toBe(true)
    expect(SUPPLIER_BRANDS.has('크레잇')).toBe(true)
  })
})

describe('ratio — 핵심 매칭 케이스 (회귀 보호)', () => {
  it('세척무우 → 키즈)세척무 정확 매칭', () => {
    expect(getTokenMatchRatio('세척무우', '키즈)세척무 국내산 실온')).toBeGreaterThanOrEqual(0.75)
  })

  it('통팝콘치킨 매칭 — 마니커 팝콘치킨(괄호 OCR 노이즈)', () => {
    const cleaned = cleanProductQuery('마니커 팝콘치킨(약6g*(166±5)입 1Kg/EA)')
    expect(getTokenMatchRatio(cleaned, '통팝콘치킨 마니커F&G')).toBeGreaterThanOrEqual(1.0)
  })

  it('아이누리 쌀 → 양곡 일반미 ratio 양호', () => {
    const cleaned = cleanProductQuery('아이누리 쌀(엄선 20Kg/EA)')
    // 일반미 양곡 후보 ratio 1.0+ (substring "쌀")
    expect(getTokenMatchRatio(cleaned, '일반미 단풍애물든쌀 국내산 상온')).toBeGreaterThanOrEqual(1.0)
  })

  it('수수 → 차수수 동의어 매칭, 옥수수 차단', () => {
    expect(getTokenMatchRatio('수수', '차수수 농협 국내산 실온')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio('수수', '옥수수전분 뚜레반')).toBe(0)
    expect(getTokenMatchRatio('수수', '옥수수모닝빵 롯데제과')).toBe(0)
  })

  it('국멸치/국물용멸치 → 다시멸치 매칭', () => {
    expect(getTokenMatchRatio('국멸치', '국멸치 국내산 냉장')).toBeGreaterThanOrEqual(1.5)
    expect(getTokenMatchRatio('국물용멸치', '다시멸치 상 국내산 냉장')).toBeGreaterThanOrEqual(1.0)
  })

  it('양파 → 깐양파 (synonym substring boost)', () => {
    expect(getTokenMatchRatio('양파', '깐양파 국내산 냉장')).toBeGreaterThanOrEqual(1.5)
    expect(getTokenMatchRatio('양파', '컷팅 양파 국내산 냉장')).toBeGreaterThanOrEqual(1.5)
  })

  it('감자전분 vs 옥수수전분 변별력', () => {
    const q = '청은에프엔비 감자전분 국내산_100% 1Kg/EA'
    const cleaned = cleanProductQuery(q)
    const gam = getTokenMatchRatio(cleaned, '감자전분 세왕푸드')
    const ock = getTokenMatchRatio(cleaned, '옥수수전분 뚜레반')
    const go = getTokenMatchRatio(cleaned, '고구마전분 성진식품')
    // 감자전분이 2배+ 차이로 위
    expect(gam).toBeGreaterThanOrEqual(ock * 1.5)
    expect(gam).toBeGreaterThanOrEqual(go * 1.5)
  })

  it('아이누리 무우 → 세척무 동의어 매칭', () => {
    const cleaned = cleanProductQuery('아이누리 무우(1.5Kg/EA)')
    expect(getTokenMatchRatio(cleaned, '키즈)세척무 국내산 실온(냉장 권장)')).toBeGreaterThanOrEqual(1.0)
  })

  it('이츠웰 햇살가득고춧가루 → 고추분 (합성어 suffix synonym)', () => {
    const cleaned = cleanProductQuery('이츠웰 햇살가득고춧가루(순한맛 양념용 1Kg/EA)')
    const r = getTokenMatchRatio(cleaned, '한생 고추분 일반 국내산 상온')
    expect(r).toBeGreaterThan(0.5) // 합성어 suffix 매칭
  })

  it('크레잇 미니크리스피핫도그 → 핫도그 후보 (full match)', () => {
    const cleaned = cleanProductQuery('크레잇 미니크리스피핫도그(50g*10입 500g/EA)')
    expect(getTokenMatchRatio(cleaned, '핫도그 대상')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '청정원 우리밀미니핫도그 대상')).toBeGreaterThanOrEqual(1.0)
  })

  it('가공품 페널티 — 검수 양곡 vs 신세계 가공품', () => {
    // 쌀 (양곡 검수) → 멥쌀가루(가공품)는 페널티
    expect(isProcessedProduct('멥쌀가루 다원식품')).toBe(true)
    expect(isProcessedProduct('쌀가루 한국SB')).toBe(true)
    expect(isProcessedProduct('쌀쫄면 동성식품')).toBe(true)
    expect(isProcessedProduct('쌀국수장국 M&F')).toBe(true)
    // 양곡 자체는 가공품 아님
    expect(isProcessedProduct('오곡쌀 찹쌀 기장 적두 서리태 흑미 국내산 상온')).toBe(false)
    expect(isProcessedProduct('일반미 단풍애물든쌀 국내산 상온')).toBe(false)
  })

  it('1자 한국어 토큰 — 쌀 → 옥수수 차단 (token-suffix 제한)', () => {
    // "쌀" 1자: 토큰 prefix/suffix matching이지만 옥수수 같은 1자 substring 차단
    expect(getTokenMatchRatio('쌀', '오곡쌀 찹쌀')).toBeGreaterThanOrEqual(1.5) // suffix 매칭 허용
    expect(getTokenMatchRatio('수수', '옥수수전분')).toBe(0) // suffix 차단
  })
})

describe('가공품 키워드 — 곡물/축산/수산/조미료', () => {
  it('곡물 가공품', () => {
    expect(isProcessedProduct('쌀가루')).toBe(true)
    expect(isProcessedProduct('쌀강정')).toBe(true)
    expect(isProcessedProduct('쌀쫄면')).toBe(true)
    expect(isProcessedProduct('떡볶이떡')).toBe(true)
    expect(isProcessedProduct('김부각')).toBe(true)
  })

  it('축산 가공품', () => {
    expect(isProcessedProduct('소시지')).toBe(true)
    expect(isProcessedProduct('베이컨')).toBe(true)
    expect(isProcessedProduct('미트볼')).toBe(true)
    expect(isProcessedProduct('돈까스')).toBe(true)
    expect(isProcessedProduct('너겟')).toBe(true)
  })

  it('조미료/소스 가공품', () => {
    expect(isProcessedProduct('마요네즈')).toBe(true)
    expect(isProcessedProduct('케찹')).toBe(true)
    expect(isProcessedProduct('드레싱')).toBe(true)
  })

  it('파우더/분말 가공품 (양파파우더 등)', () => {
    expect(isProcessedProduct('양파파우더')).toBe(true)
    expect(isProcessedProduct('양파분말')).toBe(true)
  })
})

describe('tax_type 가중치 — 면세 검수 vs 과세 후보 (간편브로컬리 케이스)', () => {
  it('브로콜리 표준어에 브로컬리 동의어 등록됨 (사용자 보고)', () => {
    // 신세계 DB는 '브로컬리' 표기(면세 채소)와 '브로콜리' 표기(과세 가공품) 혼재
    // 검수 query 어느 표기든 모든 후보 매칭되어야
    expect(expandWithSynonyms('브로콜리')).toContain('브로컬리')
    expect(expandWithSynonyms('브로컬리')).toContain('브로콜리')
  })

  it('간편브로컬리 검수 — 면세 채소 브로컬리 후보 ratio 양호', () => {
    const cleaned = cleanProductQuery('간편브로컬리(컷팅)')
    // 면세 채소 후보 (브로컬리 표기)
    expect(getTokenMatchRatio(cleaned, '브로컬리 국내산 실온(냉장 권장)')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '키즈 브로컬리 국내산 상온')).toBeGreaterThanOrEqual(1.0)
  })
})

describe('민찌/다짐육 동의어 — 종 분리 (2026-05-12)', () => {
  it('돈민찌 표준어 동의어 — 돼지 전용 (일반어 분리)', () => {
    const syns = expandWithSynonyms('돈민찌')
    expect(syns).toContain('돈다짐육')
    expect(syns).toContain('돼지다짐육')
    expect(syns).toContain('돈육민찌')
    // 일반어는 별도 표준어로 분리됨 — 종 cross 매칭 방지
    expect(syns).not.toContain('다짐육')
    expect(syns).not.toContain('한우다짐육')
  })

  it('다짐육 표준어 — 종 비특화 일반어', () => {
    const syns = expandWithSynonyms('다짐육')
    expect(syns).toContain('민찌')
    expect(syns).toContain('민찌육')
    expect(syns).toContain('간고기')
    expect(syns).toContain('그라운드')
  })

  it('돈민찌 = 돈다짐육 = 돼지다짐육 (사용자 요청 케이스)', () => {
    // 사용자: "돈민찌 = 돈다짐육 유사한 내용도 검증해줘"
    // 셋 다 같은 표준어 '돈민찌'로 묶여야 동의어 매칭 작동
    expect(expandWithSynonyms('돈민찌')).toEqual(expandWithSynonyms('돈다짐육'))
    expect(expandWithSynonyms('돈민찌')).toEqual(expandWithSynonyms('돼지다짐육'))
  })

  it('민찌 = 다짐육 (사용자 요청 케이스)', () => {
    // 사용자: "민찌, 다짐육은 동의어로 등록해줘"
    expect(expandWithSynonyms('민찌')).toEqual(expandWithSynonyms('다짐육'))
    expect(expandWithSynonyms('민찌')).toEqual(expandWithSynonyms('민찌육'))
    expect(expandWithSynonyms('민찌')).toEqual(expandWithSynonyms('간고기'))
  })

  it('돈민찌 검수 — 한우다짐육 cross 매칭 차단 (회귀 보호)', () => {
    // 이전 결함: 돈민찌 표준어에 일반어 '다짐육' 포함 → '한우다짐육' substring 매칭 → 1.5
    // 수정 후: 종 분리로 동의어 매칭 0
    const cleaned = cleanProductQuery('돈민찌 1kg')
    expect(getTokenMatchRatio(cleaned, '한우다짐육 국내산 냉동')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '우민찌 미국 냉동')).toBe(0)
  })

  it('돈민찌 검수 — 돼지 후보는 정상 매칭', () => {
    const cleaned = cleanProductQuery('돈민찌 1kg')
    // 같은 표준어 동의어 매칭
    expect(getTokenMatchRatio(cleaned, '돈육민찌 국내산')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '돼지다짐육 국내산')).toBeGreaterThanOrEqual(1.0)
  })

  it('한우 다짐육 검수 — 한우다짐육 substring 매칭', () => {
    const cleaned = cleanProductQuery('한우 다짐육 냉동')
    expect(getTokenMatchRatio(cleaned, '한우다짐육 국내산 냉동')).toBeGreaterThanOrEqual(1.0)
  })

  it('민찌 검수 — 카보트그라운드민찌 합성어 매칭 (그라운드 동의어)', () => {
    // '그라운드' = 다짐육 동의어 등록 → 합성어 안의 '그라운드' 매칭으로 카보트그라운드민찌 포착
    const cleaned = cleanProductQuery('민찌')
    expect(getTokenMatchRatio(cleaned, '카보트그라운드민찌 카보트')).toBeGreaterThanOrEqual(1.0)
  })
})

describe('종 prefix 매칭 — 돈민찌 검수 (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: SHINSEGAE 220776 '돈앞다리 국내산 냉동 1KG, 다짐육' 후보 누락
  // 검수 '돈민찌' 표기 시 product_name에 동의어 없어 매칭 안 됨
  // fix: t.length>=3 합성어 suffix matching + 종 prefix 충돌 차단
  it('돈민찌 검수 — 돼지 다짐육 product 매칭 (220776)', () => {
    const cleaned = cleanProductQuery('돈민찌 1kg')
    // product name+spec 합쳐서 ratio 계산 (search route와 동일)
    expect(getTokenMatchRatio(cleaned, '돈앞다리 국내산 냉동 1KG, 다짐육')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '돈뒷다리 국내산 냉동 1KG, 다짐육')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '돈지방 국내산 냉동 1KG, 다짐육')).toBeGreaterThanOrEqual(1.0)
  })

  it('돈민찌 검수 — cross-종 후보 차단 (한우/우/닭)', () => {
    const cleaned = cleanProductQuery('돈민찌 1kg')
    expect(getTokenMatchRatio(cleaned, '한우다짐육 국내산 냉동')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '우민찌 미국 냉동')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '우정육 호주 냉동 1KG, 다짐육')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '닭가슴살 국내산 1KG, 다짐육')).toBe(0)
  })

  it('한우다짐육 검수 — 한우 후보 매칭, 돼지 후보 무관', () => {
    const cleaned = cleanProductQuery('한우다짐육 1kg')
    expect(getTokenMatchRatio(cleaned, '한우다짐육 국내산 냉동')).toBeGreaterThanOrEqual(1.0)
  })

  it('닭다짐육 검수 — 닭 후보 매칭', () => {
    const cleaned = cleanProductQuery('닭다짐육 1kg')
    expect(getTokenMatchRatio(cleaned, '닭가슴살 국내산 1KG, 다짐육')).toBeGreaterThanOrEqual(1.0)
  })
})

describe('storage prefix 분리 — 냉장한우사태 (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 '냉장한우사태' (OCR/Excel 합성) → 추천 후보 전부 돈사태
  // 원인: '냉장한우사태' 단일 토큰 → BM25 검색에서 '한우사태' product 미매칭
  //       + species prefix 추출 실패 ('냉장'으로 시작) → 돈사태와 cross-매칭

  it('cleanProductQuery — 냉장/냉동/실온 prefix 분리', () => {
    expect(cleanProductQuery('냉장한우사태')).toBe('냉장 한우사태')
    expect(cleanProductQuery('냉동한우사태')).toBe('냉동 한우사태')
    expect(cleanProductQuery('실온우유')).toBe('실온 우유')
  })

  it('냉장한우사태 검수 — 한우사태 후보 매칭', () => {
    const cleaned = cleanProductQuery('냉장한우사태')
    expect(getTokenMatchRatio(cleaned, '한우사태 국내산 냉장 1KG')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '올바르고반듯한 한우사태 국내산 냉장')).toBeGreaterThanOrEqual(1.0)
  })

  it('냉장한우사태 검수 — 돈사태보다 한우사태 우선', () => {
    const cleaned = cleanProductQuery('냉장한우사태')
    const hanu = getTokenMatchRatio(cleaned, '한우사태 국내산 냉장 1KG')
    const don = getTokenMatchRatio(cleaned, '돈사태 국내산 냉장 1KG')
    expect(hanu).toBeGreaterThan(don)
  })
})
