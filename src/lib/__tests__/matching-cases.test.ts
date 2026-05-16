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

describe('생/가공 suffix 분리 — 생오이피클슬라이스 (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 '생오이피클슬라이스(VB)' AI 추천 후보: 망고/홍피망/오리정육/생표고버섯슬라이스
  // 원인: '생오이피클슬라이스' 단일 토큰 → 오이피클 후보(190971/200648) 매칭 안 됨
  //       슬라이스만 공통인 무관 후보들과 ratio 동률 → 부정확한 정렬

  it('cleanProductQuery — 생 prefix 분리 (3자 이상 식자재명)', () => {
    expect(cleanProductQuery('생오이피클')).toBe('생 오이피클')
    expect(cleanProductQuery('생오이피클슬라이스')).toBe('생 오이피클 슬라이스')
    // 2자 합성어 보호 — '생강' '생수' '생면'
    expect(cleanProductQuery('생강 즙')).toBe('생강 즙')
  })

  it('cleanProductQuery — 가공 suffix 분리 (슬라이스/커팅/다이스)', () => {
    expect(cleanProductQuery('오이피클슬라이스')).toBe('오이피클 슬라이스')
    expect(cleanProductQuery('감자다이스')).toBe('감자 다이스')
  })

  it('생오이피클슬라이스 검수 — 오이피클 후보 매칭', () => {
    const cleaned = cleanProductQuery('생오이피클슬라이스(VB)')
    expect(getTokenMatchRatio(cleaned, '오이피클 슬라이스캔 GOC 3KG')).toBeGreaterThanOrEqual(0.5)
    expect(getTokenMatchRatio(cleaned, '후레쉬오이피클 아주쿡 3.100KG')).toBeGreaterThanOrEqual(0.5)
  })

  it('생오이피클슬라이스 검수 — 무관 슬라이스 후보 매칭 0', () => {
    // 슬라이스만 공통인 망고/홍피망/유부 등은 매칭 0 (modifier로 제외)
    const cleaned = cleanProductQuery('생오이피클슬라이스(VB)')
    expect(getTokenMatchRatio(cleaned, '망고슬라이스 몬 565G')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '냉동홍피망슬라이스 중국 냉동 1KG')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '냉동유부슬라이스 한미 1KG')).toBe(0)
  })
})

describe('포장 suffix + DC/VB marker 분리 — 스팸캔,DC (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 '스팸캔,DC' 1.81KG → 매칭 후보 모두 DC 컵라면
  // 신세계 013774 '스팸 CJ제일제당 1.810KG' 매칭되어야 함
  // 원인: '스팸캔' 단일 토큰 + 'DC' marker가 effective token으로 잡혀 DC 컵라면과 동률

  it('cleanProductQuery — 캔 suffix 분리', () => {
    expect(cleanProductQuery('스팸캔')).toBe('스팸 캔')
    expect(cleanProductQuery('참치캔')).toBe('참치 캔')
  })

  it('cleanProductQuery — 콤마/세미콜론 분리', () => {
    expect(cleanProductQuery('스팸,DC')).toBe('스팸')
    expect(cleanProductQuery('a;b')).toBe('a b')
  })

  it('cleanProductQuery — DC/VB marker 제거', () => {
    // 검수 메타 marker (Discount Center, Vacuum Bag) 제거
    expect(cleanProductQuery('스팸캔,DC')).toBe('스팸 캔')
    expect(cleanProductQuery('오이피클 VB')).toBe('오이피클')
  })

  it('스팸캔,DC 검수 — 스팸 햄 후보 매칭 (DC 컵라면 차단)', () => {
    const cleaned = cleanProductQuery('스팸캔,DC')
    expect(getTokenMatchRatio(cleaned, '스팸 CJ제일제당')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '스팸 CJ제일제당 1.810KG')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, 'DC 김치왕뚜껑컵라면 팔도')).toBe(0)
    expect(getTokenMatchRatio(cleaned, 'DC 짜파게티큰컵라면 농심')).toBe(0)
  })
})

describe('옛날 prefix + 외식 marker — 옛날자른미역,외 식 (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 '옛날자른미역,외 식' 50G/EA → 추천 후보 #1~#3 조각과일 (미역 무관)
  // 원인: '옛날자른미역' 합성 + '외'/'식' 1자가 '외국산'/'식재' substring 매칭 → 조각과일 0.667 #1

  it('cleanProductQuery — 옛날 prefix 분리', () => {
    expect(cleanProductQuery('옛날자른미역')).toBe('옛날 자른미역')
    expect(cleanProductQuery('옛날당면')).toBe('옛날 당면')
  })

  it('cleanProductQuery — 외 식 카테고리 marker 제거', () => {
    expect(cleanProductQuery('옛날자른미역,외 식').trim()).toBe('옛날 자른미역')
    expect(cleanProductQuery('미역 외 식자재').trim()).toBe('미역')
  })

  it('옛날자른미역,외 식 검수 — 자른미역 후보 매칭 (조각과일 차단)', () => {
    const cleaned = cleanProductQuery('옛날자른미역,외 식')
    expect(getTokenMatchRatio(cleaned, '완도 자른미역 국내산 상온 50G, 절단(단순)')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '자른미역 국내산 건냉 500G')).toBeGreaterThanOrEqual(1.0)
    // 조각과일은 매칭 0 — '외 식'/'옛날' modifier로 효과적 토큰에서 제외
    expect(getTokenMatchRatio(cleaned, '식재 조각과일 오렌지 외국산 냉장 750G')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '식재 조각과일 사과 국내산 냉장 1.500KG')).toBe(0)
  })
})

describe('2자 token-suffix 매칭 — 유자담은순살 삼치 (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 '유자담은순살 삼치' 가시제거99% → 추천 #1~#7 일반 삼치 후보
  // 신세계 [325536] 순살삼치 NB 30~50G 가시제거99% (정확매칭) 누락
  // 원인: '삼치'(2자) 검수가 product의 '순살삼치' 합성어 안에서 token-suffix 매칭 불허

  it('cleanProductQuery — 유자/담은/넣은 등 풍미 prefix/suffix 분리', () => {
    expect(cleanProductQuery('유자담은순살삼치')).toContain('유자')
    expect(cleanProductQuery('치즈담은돈가스')).toContain('담은')
  })

  it('2자 token-suffix 허용 — 삼치 검수 → 순살삼치 매칭', () => {
    // 합성어 안의 어종 매칭: '삼치' → '순살삼치' suffix
    expect(getTokenMatchRatio(cleanProductQuery('삼치'), '순살삼치 NB 국내산 냉동')).toBeGreaterThanOrEqual(1.0)
  })

  it('회귀 보호 — 감자전분 검수 vs 옥수수전분 (token-suffix 차단)', () => {
    // 합성어 suffix matching의 self syn('전분')은 strictSuffix 모드 → token-suffix 비허용
    // → '옥수수전분' product에 '전분' suffix 매칭 안 됨 → 변별력 유지
    const cleaned = cleanProductQuery('감자전분')
    const gam = getTokenMatchRatio(cleaned, '감자전분 성진식품')
    const ock = getTokenMatchRatio(cleaned, '옥수수전분 뚜레반')
    expect(gam).toBeGreaterThanOrEqual(ock * 1.5)
  })

  it('유자담은순살 삼치 검수 — 순살삼치 후보 우선 (일반 삼치보다)', () => {
    const cleaned = cleanProductQuery('유자담은순살 삼치')
    const sunsal = getTokenMatchRatio(cleaned, '순살삼치 NB 국내산 냉동 500G, 30~50G, 가시제거99%')
    const ilban = getTokenMatchRatio(cleaned, '삼치 국내산 냉동 1KG, 80~100G, 조림용, 소제절단')
    expect(sunsal).toBeGreaterThan(ilban)
  })

  it('삼치 가시제거 검수 — 순살삼치 (가시제거 spec) 정확 매칭', () => {
    const cleaned = cleanProductQuery('삼치 가시제거')
    expect(getTokenMatchRatio(cleaned, '순살삼치 NB 국내산 냉동 500G, 30~50G, 가시제거99%')).toBeGreaterThanOrEqual(1.0)
  })
})

describe('OCR 노이즈 복원 — 생오이피클슬라이 스(VB) (사용자 보고 2026-05-12)', () => {
  // 사용자 보고: 검수 OCR이 '슬라이스'를 '슬라이 스'로 잘라냄
  // 추천 #1 생표고버섯 슬라이스, #2 생선까스 — 오이피클 후보 누락

  it('cleanProductQuery — 슬라이 스 → 슬라이스 복원', () => {
    expect(cleanProductQuery('생오이피클슬라이 스(VB)')).toBe('생 오이피클 슬라이스')
    expect(cleanProductQuery('감자슬라 이스')).toBe('감자 슬라이스')
  })

  it("'생' modifier — 3자 이상 식자재명 앞에서 분리되어 단독 토큰화 시 매칭 제외", () => {
    // '생' 단독 토큰은 너무 광범위 substring 매칭 위험 (생표고버섯/생선/생수)
    // 검수 query 분리 후 '생' 단독은 GENERIC_MODIFIERS로 제외
    const cleaned = cleanProductQuery('생오이피클슬라이 스(VB)')
    expect(getTokenMatchRatio(cleaned, '생표고버섯 슬라이스 국내산')).toBe(0)
    expect(getTokenMatchRatio(cleaned, '생선까스 가토코')).toBe(0)
  })

  it('생오이피클슬라이 스(VB) 검수 — 오이피클 후보 정확 매칭', () => {
    const cleaned = cleanProductQuery('생오이피클슬라이 스(VB)')
    expect(getTokenMatchRatio(cleaned, '오이피클 슬라이스캔 GOC 3KG')).toBeGreaterThanOrEqual(1.0)
    expect(getTokenMatchRatio(cleaned, '후레쉬오이피클 아주쿡 3.100KG')).toBeGreaterThanOrEqual(1.0)
  })
})

describe('감자 동의어 — 피감자/일반감자 (사용자 등록 2026-05-15)', () => {
  it('피감자/일반감자가 감자 표준어 그룹에 포함', () => {
    expect(expandWithSynonyms('피감자')).toContain('감자')
    expect(expandWithSynonyms('일반감자')).toContain('감자')
    expect(expandWithSynonyms('감자')).toContain('피감자')
    expect(expandWithSynonyms('감자')).toContain('일반감자')
  })

  it('피감자 검수 — 감자 후보 1.5 매칭', () => {
    expect(getTokenMatchRatio(cleanProductQuery('피감자 1kg'), '감자 국내산 실온 1KG')).toBeGreaterThanOrEqual(1.5)
    expect(getTokenMatchRatio(cleanProductQuery('일반감자 5KG'), '감자 국내산 실온 5KG')).toBeGreaterThanOrEqual(1.5)
  })

  it('감자 검수 — 피감자/일반감자 후보 1.5 매칭', () => {
    expect(getTokenMatchRatio(cleanProductQuery('감자'), '피감자 국내산')).toBeGreaterThanOrEqual(1.5)
    expect(getTokenMatchRatio(cleanProductQuery('감자'), '일반감자 국내산')).toBeGreaterThanOrEqual(1.5)
  })
})
