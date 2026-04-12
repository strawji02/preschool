/**
 * 한국어 식품명 전처리 모듈
 *
 * Phase 1 개선: BM25 + Hybrid Search 정확도 향상
 * - 조사 제거 (은/는/이/가/을/를)
 * - 맞춤법 통일
 * - 브랜드명 정규화
 * - 동의어 처리 (돈전지↔앞다리, 계란↔달걀 등)
 * - 불필요한 패턴 제거
 */

import { normalizeText as normalizeSynonyms, expandWithSynonyms } from './synonyms'

// Re-export normalizeText for convenience
export { normalizeText } from './synonyms'

// ========================================
// 입력 클리닝 (Input Cleaning)
// ========================================

// 마케팅/유통 용어 (제거 대상)
const MARKETING_TERMS = [
  '기획절감형', '기획절감', 'FD전용', 'FD', '외식', 'DC', 'VB',
  '기획', '특가', '할인', '프리미엄', '행사', '이벤트',
]

// 맛/종류 수식어 (코어 키워드 추출 시 제거)
const FLAVOR_MODIFIERS = [
  '순한맛', '매운맛', '보통맛', '중간맛', '단맛', '짠맛',
  '그린', '레드', '화이트', '오리지널', '클래식',
]

/**
 * 입력 텍스트 클리닝: 콤마 분리, 괄호 처리, 마케팅 용어 제거, 공백 정규화
 *
 * @param name - 원본 품목명
 * @returns { primary: 주요 품목명, secondary: 부가 설명 }
 *
 * @example
 * cleanInput('토마토스파게티소스,구운마늘과양파') // { primary: '토마토스파게티소스', secondary: '구운마늘과양파' }
 * cleanInput('간편브로컬리(컷 팅)') // { primary: '간편브로컬리컷팅', secondary: '' }
 * cleanInput('백김치,기획절감 형') // { primary: '백김치', secondary: '' }
 */
export function cleanInput(name: string): { primary: string; secondary: string } {
  let cleaned = name.trim()

  // 1. 괄호 내용을 공백 제거 후 본문에 합치기: (컷 팅) → 컷팅
  cleaned = cleaned.replace(/[\(\[](.*?)[\)\]]/g, (_match, content: string) => {
    return content.replace(/\s+/g, '')
  })

  // 2. 콤마로 분리하여 주요 품목 / 부가 설명 분리
  const commaParts = cleaned.split(',').map(p => p.trim()).filter(Boolean)
  let primary = commaParts[0] || cleaned
  let secondary = commaParts.slice(1).join(' ')

  // 3. 마케팅 용어 제거 (primary와 secondary 모두)
  for (const term of MARKETING_TERMS) {
    const regex = new RegExp(term, 'gi')
    primary = primary.replace(regex, '')
    secondary = secondary.replace(regex, '')
  }

  // 4. 단어 내 공백 정규화: '컷 팅' → '컷팅', '스파게티소 스' → '스파게티소스'
  // 한글 음절 사이의 단독 공백을 제거 (2글자 이하 토큰이 한글로만 구성된 경우)
  primary = normalizeIntraWordSpaces(primary)
  secondary = normalizeIntraWordSpaces(secondary)

  // 5. 연속 공백 정리
  primary = primary.replace(/\s+/g, ' ').trim()
  secondary = secondary.replace(/\s+/g, ' ').trim()

  return { primary, secondary }
}

/**
 * 한글 단어 내 불필요한 공백 제거
 * '컷 팅' → '컷팅', '스파게티소 스' → '스파게티소스'
 * 단, '토마토 소스' 처럼 양쪽이 모두 2글자 이상이면 유지
 */
function normalizeIntraWordSpaces(text: string): string {
  // 한글 1글자 + 공백 + 한글 1-2글자 패턴을 결합
  // 예: '컷 팅' (1+2), '소 스' (1+1)
  return text.replace(
    /([\uAC00-\uD7A3]{1})\s+([\uAC00-\uD7A3]{1,2})(?=\s|$|[\uAC00-\uD7A3])/g,
    '$1$2'
  )
}

/**
 * 코어 키워드 추출: 맛/종류 수식어를 제거하여 핵심 상품명 추출
 *
 * @param name - 전처리된 품목명
 * @returns 수식어가 제거된 코어 상품명
 *
 * @example
 * extractCoreKeyword('그린치커리') // '치커리'
 * extractCoreKeyword('순한맛김치') // '김치'
 * extractCoreKeyword('오리지널핫도그') // '핫도그'
 */
export function extractCoreKeyword(name: string): string {
  let core = name.trim()

  for (const modifier of FLAVOR_MODIFIERS) {
    if (core.startsWith(modifier) && core.length > modifier.length) {
      core = core.slice(modifier.length)
    }
  }

  return core.trim()
}

// ========================================
// 복합어 분리 (Compound Word Splitting)
// ========================================

// 접두사 목록: 저장방식, 가공상태, 크기, 형태
const COMPOUND_PREFIXES: { prefix: string; minRemainder: number }[] = [
  // 저장방식 (Storage)
  { prefix: '냉장', minRemainder: 2 },
  { prefix: '냉동', minRemainder: 2 },
  // 가공상태 (Processing)
  { prefix: '깐', minRemainder: 2 },
  { prefix: '썰은', minRemainder: 2 },
  { prefix: '다진', minRemainder: 2 },
  { prefix: '삶은', minRemainder: 2 },
  { prefix: '볶은', minRemainder: 2 },
  { prefix: '구운', minRemainder: 2 },
  { prefix: '데친', minRemainder: 2 },
  { prefix: '간편', minRemainder: 2 },
  { prefix: '전처리', minRemainder: 2 },
  // 크기 (Size)
  { prefix: '미니', minRemainder: 2 },
  { prefix: '대용량', minRemainder: 2 },
  // 형태 (Type modifiers)
  { prefix: '순살', minRemainder: 2 },
  { prefix: '뼈없는', minRemainder: 2 },
  { prefix: '무뼈', minRemainder: 2 },
]

/**
 * 복합어를 접두사 + 본체로 분리
 *
 * @param word - 복합어 (예: '냉장돈후지', '깐감자', '미니깍두기')
 * @returns 분리된 단어 배열 (접두사 + 나머지)
 *
 * @example
 * splitCompoundWord('냉장돈후지') // ['냉장', '돈후지']
 * splitCompoundWord('깐감자') // ['깐', '감자']
 * splitCompoundWord('미니깍두기') // ['미니', '깍두기']
 * splitCompoundWord('냉장한우목심') // ['냉장', '한우목심']
 * splitCompoundWord('감자') // ['감자'] (분리 없음)
 */
export function splitCompoundWord(word: string): string[] {
  for (const { prefix, minRemainder } of COMPOUND_PREFIXES) {
    if (word.startsWith(prefix) && word.length >= prefix.length + minRemainder) {
      const remainder = word.slice(prefix.length)
      return [prefix, remainder]
    }
  }
  return [word]
}

// 맞춤법 통일 매핑
const SPELLING_NORMALIZATION: Record<string, string> = {
  // 초콜릿 계열
  초콜렛: '초콜릿',
  쵸코: '초코',
  쵸콜렛: '초콜릿',
  쵸콜릿: '초콜릿',
  // 커피 계열
  까페: '카페',
  커피: '커피',
  // 음료 계열
  쥬스: '주스',
  쥬우스: '주스',
  // 고기 계열
  돼지: '돼지',
  되지: '돼지',
  소고기: '소고기',
  쇠고기: '소고기',
  // 채소 계열
  가지: '가지',
  까지: '가지',
  빠프리카: '파프리카',
  파프리까: '파프리카',
  // 과일 계열
  파인애플: '파인애플',
  파인애풀: '파인애플',
  파이낸풀: '파인애플',
  // 채소 추가
  브로컬리: '브로콜리',
  // 기타
  라면: '라면',
  라멘: '라면',
  우동: '우동',
  우똥: '우동',
  된장: '된장',
  된쟝: '된장',
  고추장: '고추장',
  고추쟝: '고추장',
}

// 브랜드명 정규화 (대폭 확장)
const BRAND_NORMALIZATION: Record<string, string> = {
  // 식품 대기업
  삼양: '삼양',
  '삼양라면': '삼양',
  농심: '농심',
  오뚜기: '오뚜기',
  CJ: 'CJ',
  씨제이: 'CJ',
  '씨제이제일제당': 'CJ',
  제일제당: 'CJ',
  풀무원: '풀무원',
  대상: '대상',
  샘표: '샘표',
  청정원: '대상',
  종가집: '대상',
  해찬들: '해찬들',
  // 유제품
  남양: '남양',
  매일: '매일',
  서울우유: '서울우유',
  빙그레: '빙그레',
  // 육가공
  사조: '사조',
  동원: '동원',
  동원참치: '동원',
  롯데: '롯데',
  // 라면/스낵
  팔도: '팔도',
  삼양식품: '삼양',
  농심라면: '농심',
  // 음료
  코카콜라: '코카콜라',
  펩시: '펩시',
  칠성: '칠성',
  롯데칠성: '롯데',
  // 기타
  오뚜기식품: '오뚜기',
  대상청정원: '대상',
  청정원대상: '대상',
  오뚜기케찹: '오뚜기',
}

// 브랜드 감지용 키워드 (괄호 분리에 사용)
const BRAND_KEYWORDS = [
  '오뚜기', 'CJ', '제일제당', '삼양', '농심', '대상', '샘표', '청정원', '종가집', '해찬들',
  '풀무원', '동원', '사조', '롯데', '빙그레', '매일', '남양', '서울우유',
  '팔도', '코카콜라', '펩시', '칠성',
  'CJ제일제당',
]

// ========================================
// 서브브랜드 → 제조사 매핑 (Sub-brand → Manufacturer)
// ========================================

/**
 * 서브브랜드(제품 브랜드)를 제조사(공급사)로 매핑
 * 예: 비비고 → CJ제일제당, 햇반 → CJ제일제당
 */
const SUB_BRAND_TO_MANUFACTURER: Record<string, string> = {
  // CJ 계열
  비비고: 'CJ제일제당',
  햇반: 'CJ제일제당',
  고메: 'CJ제일제당',
  백설: 'CJ제일제당',
  다시다: 'CJ제일제당',
  스팸: 'CJ제일제당',
  // 오뚜기 계열
  프레스코: '오뚜기',
  진라면: '오뚜기',
  진짬뽕: '오뚜기',
  // 대상 계열
  청정원: '대상',
  종가집: '대상',
  순창: '대상',
  // 풀무원 계열
  풀무원: '풀무원',
  // 동원 계열
  양반: '동원',
  // 농심 계열
  신라면: '농심',
  안성탕면: '농심',
  너구리: '농심',
  // 삼양 계열
  불닭: '삼양',
  // 사조 계열
  해표: '사조',
}

/**
 * 서브브랜드 키워드 목록 (복합어 분리에 사용)
 * 길이 내림차순 정렬하여 긴 매치 우선
 */
const SUB_BRAND_KEYWORDS = Object.keys(SUB_BRAND_TO_MANUFACTURER)
  .sort((a, b) => b.length - a.length)

// 가공 지시어 (괄호 분리에 사용)
const PROCESSING_KEYWORDS = [
  '피제거', '시제거', '깍뚝썰기', '슬라이스', '다진', '채썬', '손질', '전처리',
  '냉동', '냉장', '실온', '생', '익힌', '데친', '볶은', '튀긴',
  '중간맛', '순한맛', '매운맛', '단맛', '짠맛',
  '국내산', '수입산', '미국산', '호주산', '칠레산', '국산', '수입',
  '기피', '탈피', '거피',
]

// 조사 패턴 (제거할 조사들)
const PARTICLES = ['은', '는', '이', '가', '을', '를', '의', '도', '만', '까지', '부터', '에서', '으로', '로']

/**
 * 괄호 내용 분리 (브랜드, 원산지, 가공상태 추출)
 *
 * @param name - 원본 품목명
 * @returns { core: 핵심 품목명, metadata: 메타정보 }
 *
 * @example
 * separateBrackets('오뚜기 카레(중간맛)') // { core: '카레', metadata: { brand: ['오뚜기'], processing: ['중간맛'] } }
 * separateBrackets('깻잎(국내산) 100g') // { core: '깻잎', metadata: { origin: ['국내산'] } }
 */
export function separateBrackets(name: string): {
  core: string
  metadata: {
    brand?: string[]
    origin?: string[]
    processing?: string[]
  }
} {
  const metadata: {
    brand?: string[]
    origin?: string[]
    processing?: string[]
  } = {}

  let core = name.trim()

  // 1. 괄호 내용 추출 및 분류
  const bracketPattern = /[\(\[](.*?)[\)\]]/g
  const matches = [...core.matchAll(bracketPattern)]

  for (const match of matches) {
    const content = match[1].trim()

    // 원산지 판별
    if (content.includes('산') || content.includes('국내') || content.includes('수입')) {
      metadata.origin = metadata.origin || []
      metadata.origin.push(content)
    }
    // 가공 지시어 판별
    else if (PROCESSING_KEYWORDS.some(kw => content.includes(kw))) {
      metadata.processing = metadata.processing || []
      metadata.processing.push(content)
    }
    // 그 외는 가공상태로 간주
    else {
      metadata.processing = metadata.processing || []
      metadata.processing.push(content)
    }
  }

  // 2. 괄호 제거
  core = core.replace(/[\(\[](.*?)[\)\]]/g, ' ')

  // 3. 브랜드명 추출
  for (const brand of BRAND_KEYWORDS) {
    if (core.includes(brand)) {
      metadata.brand = metadata.brand || []
      metadata.brand.push(brand)
      // 브랜드명은 제거하지 않고 유지 (검색 시 유용할 수 있음)
    }
  }

  // 4. 정리
  core = core.replace(/\s+/g, ' ').trim()

  return { core, metadata }
}

/**
 * 한국어 식품명 전처리 메인 함수
 *
 * @param name - 원본 품목명
 * @param options - 전처리 옵션
 * @returns 정규화된 품목명
 */
export function preprocessKoreanFoodName(
  name: string,
  options: {
    removeParticles?: boolean // 조사 제거 (기본: true)
    normalizeSpelling?: boolean // 맞춤법 통일 (기본: true)
    normalizeBrands?: boolean // 브랜드명 정규화 (기본: false)
    removeNumbers?: boolean // 숫자 제거 (기본: true)
    removeSpecialChars?: boolean // 특수문자 제거 (기본: true)
    normalizeSynonyms?: boolean // 동의어 정규화 (기본: true)
    separateBracketsFirst?: boolean // 괄호 분리 (기본: false)
  } = {}
): string {
  const {
    removeParticles = true,
    normalizeSpelling = true,
    normalizeBrands = false,
    removeNumbers = true,
    removeSpecialChars = true,
    normalizeSynonyms: applySynonyms = true,
    separateBracketsFirst = false,
  } = options

  let processed = name.trim()

  // 0-1. 괄호 분리 (선택적)
  if (separateBracketsFirst) {
    const { core } = separateBrackets(processed)
    processed = core
  }

  // 0-2. 동의어 정규화 (가장 먼저 적용)
  if (applySynonyms) {
    processed = normalizeSynonyms(processed)
  }

  // 1. 괄호/대괄호만 제거 (내용은 유지) - 괄호 분리하지 않았을 때만
  if (!separateBracketsFirst) {
    processed = processed.replace(/[()]/g, ' ').replace(/[\[\]]/g, ' ')
  }

  // 2. 쉼표 제거 (예: "감자, 당근" → "감자 당근")
  processed = processed.replace(/,/g, ' ')

  // 3. 숫자+단위 패턴 제거 (1kg, 200g, 500ml 등)
  if (removeNumbers) {
    processed = processed.replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box|호|번|입)/gi, '')
  }

  // 4. 맞춤법 통일
  if (normalizeSpelling) {
    for (const [wrong, correct] of Object.entries(SPELLING_NORMALIZATION)) {
      const regex = new RegExp(wrong, 'g')
      processed = processed.replace(regex, correct)
    }
  }

  // 5. 브랜드명 정규화 (선택적)
  if (normalizeBrands) {
    for (const [variant, standard] of Object.entries(BRAND_NORMALIZATION)) {
      const regex = new RegExp(variant, 'g')
      processed = processed.replace(regex, standard)
    }
  }

  // 6. 조사 제거
  if (removeParticles) {
    // 조사는 단어 끝에 붙으므로 공백 뒤에 오는 조사를 제거
    for (const particle of PARTICLES) {
      // 예: "만두는" → "만두"
      const regex = new RegExp(`${particle}(?=\\s|$)`, 'g')
      processed = processed.replace(regex, '')
    }
  }

  // 7. 남은 숫자 제거
  if (removeNumbers) {
    processed = processed.replace(/\d+/g, '')
  }

  // 8. 특수문자 제거 (한글, 영문, 공백만 유지)
  if (removeSpecialChars) {
    processed = processed.replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
  }

  // 9. 연속 공백 정리 및 trim
  processed = processed.replace(/\s+/g, ' ').trim()

  return processed
}

/**
 * 레거시 호환: 기존 normalizeItemName과 동일한 동작
 */
export function normalizeItemNameLegacy(name: string): string {
  return name
    .replace(/[()]/g, ' ')
    .replace(/[\[\]]/g, ' ')
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dual 정규화: BM25 키워드 검색용 + Semantic 검색용
 *
 * BM25용: 조사 제거, 맞춤법 통일, 동의어 정규화 (키워드 매칭 향상)
 * Semantic용: 최소 정규화 (의미 보존)
 */
export function dualNormalize(name: string): {
  forKeyword: string // BM25 검색용
  forSemantic: string // Trigram/Vector 검색용
  coreKeyword: string // 수식어 제거된 코어 키워드 (fallback용)
} {
  // 0. 입력 클리닝 (콤마 분리, 괄호 처리, 마케팅 용어 제거)
  const { primary } = cleanInput(name)

  // BM25용: 공격적 정규화 (조사 제거, 맞춤법 통일, 동의어 정규화)
  const forKeyword = preprocessKoreanFoodName(primary, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: true, // 동의어 정규화 활성화
  })

  // Semantic용: 보수적 정규화 (의미 보존, 동의어 정규화)
  const forSemantic = preprocessKoreanFoodName(primary, {
    removeParticles: false, // 조사는 의미에 영향 줄 수 있음
    normalizeSpelling: true, // 맞춤법만 통일
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: true, // 동의어 정규화 활성화
  })

  // 코어 키워드: 맛/종류 수식어 제거 (fallback 검색용)
  const coreKeyword = extractCoreKeyword(forKeyword)

  return { forKeyword, forSemantic, coreKeyword }
}

/**
 * 검색 쿼리 확장: 동의어를 포함한 모든 검색 용어 생성
 *
 * @param query - 원본 검색 쿼리
 * @returns 동의어가 확장된 검색 용어 배열
 *
 * @example
 * expandSearchQuery('앞다리') // ['돈전지', '앞다리', '앞다리살', '전지']
 * expandSearchQuery('계란 10개') // 전처리 후 ['계란', '달걀', '란', '에그']
 */
export function expandSearchQuery(query: string): string[] {
  // 0. 입력 클리닝
  const { primary } = cleanInput(query)

  // 먼저 전처리 (숫자 등 제거)
  const normalized = preprocessKoreanFoodName(primary, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: false, // 동의어는 expandWithSynonyms에서 처리
  })

  // 복합어 분리 후 각 부분에 대해 동의어 확장
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const allTerms = new Set<string>()

  for (const token of tokens) {
    const parts = splitCompoundWord(token)
    for (const part of parts) {
      const expanded = expandWithSynonyms(part)
      for (const term of expanded) {
        allTerms.add(term)
      }
    }
    // 원본 토큰도 포함 (복합어 자체가 DB에 있을 수 있음)
    allTerms.add(token)
  }

  return Array.from(allTerms)
}

/**
 * 품목명 유사도 점수 (간단한 휴리스틱)
 *
 * Phase 1에서는 사용하지 않지만, 향후 필터링에 활용 가능
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  const norm1 = preprocessKoreanFoodName(name1)
  const norm2 = preprocessKoreanFoodName(name2)

  // 간단한 Jaccard 유사도
  const chars1 = new Set(norm1.replace(/\s/g, '').split(''))
  const chars2 = new Set(norm2.replace(/\s/g, '').split(''))

  const intersection = new Set([...chars1].filter((c) => chars2.has(c)))
  const union = new Set([...chars1, ...chars2])

  if (union.size === 0) return 0

  return intersection.size / union.size
}

// ========================================
// 규격(spec)에서 브랜드 추출 + 복합 브랜드명 분리
// ========================================

/**
 * 규격(spec) 문자열에서 브랜드/제조사명 추출
 *
 * 거래명세표의 규격 필드에 브랜드명이 포함되어 있는 경우가 많음
 * 예: "오뚜기 1KG", "CJ 2KG" → 브랜드명 추출
 *
 * @param spec - 규격 문자열
 * @returns 발견된 브랜드명 (없으면 null)
 *
 * @example
 * extractBrandFromSpec('오뚜기 1KG') // '오뚜기'
 * extractBrandFromSpec('CJ제일제당 2KG') // 'CJ제일제당'
 * extractBrandFromSpec('1KG') // null
 */
export function extractBrandFromSpec(spec: string): string | null {
  if (!spec || spec.trim() === '') return null

  const cleaned = spec.trim()

  // 1. 직접 브랜드 키워드 매칭 (BRAND_KEYWORDS + 서브브랜드)
  for (const brand of BRAND_KEYWORDS) {
    if (cleaned.includes(brand)) {
      return brand
    }
  }

  // 2. 서브브랜드 매칭 → 제조사 반환
  for (const subBrand of SUB_BRAND_KEYWORDS) {
    if (cleaned.includes(subBrand)) {
      return SUB_BRAND_TO_MANUFACTURER[subBrand]
    }
  }

  return null
}

/**
 * 서브브랜드가 포함된 복합 품목명 분리
 *
 * 비비고물만두 → ['비비고', '물만두'] + manufacturer: 'CJ제일제당'
 * 프레스코스파게티 → ['프레스코', '스파게티'] + manufacturer: '오뚜기'
 *
 * @param name - 품목명
 * @returns { parts: 분리된 부분, manufacturer: 제조사명 | null }
 */
export function splitBrandCompound(name: string): {
  parts: string[]
  manufacturer: string | null
} {
  const cleaned = name.trim()

  for (const subBrand of SUB_BRAND_KEYWORDS) {
    if (cleaned.startsWith(subBrand) && cleaned.length > subBrand.length) {
      const remainder = cleaned.slice(subBrand.length)
      return {
        parts: [subBrand, remainder],
        manufacturer: SUB_BRAND_TO_MANUFACTURER[subBrand],
      }
    }
  }

  return { parts: [cleaned], manufacturer: null }
}

/**
 * 품목명 + 규격에서 검색 힌트 추출
 *
 * 규격 필드의 브랜드 정보와 품목명의 서브브랜드를 결합하여
 * 검색에 활용할 추가 키워드를 생성
 *
 * @param itemName - 품목명
 * @param spec - 규격 문자열 (optional)
 * @returns { searchTerms: 추가 검색 키워드[], manufacturer: 제조사명 | null }
 *
 * @example
 * extractSearchHints('프레스코스파게티(건면)', '오뚜기 1KG')
 * // { searchTerms: ['스파게티', '오뚜기'], manufacturer: '오뚜기' }
 *
 * extractSearchHints('비비고물만두', '')
 * // { searchTerms: ['물만두', 'CJ제일제당'], manufacturer: 'CJ제일제당' }
 */
export function extractSearchHints(
  itemName: string,
  spec?: string
): {
  searchTerms: string[]
  manufacturer: string | null
} {
  const hints: string[] = []
  let manufacturer: string | null = null

  // 1. 규격에서 브랜드 추출
  if (spec) {
    const specBrand = extractBrandFromSpec(spec)
    if (specBrand) {
      manufacturer = specBrand
      hints.push(specBrand)
    }
  }

  // 2. 품목명에서 서브브랜드 분리
  const { parts, manufacturer: nameMfr } = splitBrandCompound(itemName)
  if (nameMfr) {
    // 서브브랜드가 발견되면 본체(상품명)를 힌트에 추가
    if (parts.length > 1) {
      hints.push(parts[1]) // 본체 상품명 (예: '물만두')
    }
    // 규격에서 제조사를 못 찾았으면 서브브랜드 기반 제조사 사용
    if (!manufacturer) {
      manufacturer = nameMfr
      hints.push(nameMfr)
    }
  }

  return {
    searchTerms: [...new Set(hints)],
    manufacturer,
  }
}

/**
 * 카테고리 키워드 추출 (Phase 3 준비)
 *
 * 식품 카테고리별 핵심 키워드 추출
 */
export function extractCategoryKeywords(name: string): string[] {
  const normalized = preprocessKoreanFoodName(name)
  const keywords: string[] = []

  // 카테고리 패턴
  const categories: Record<string, RegExp[]> = {
    고기: [/돼지/, /소/, /닭/, /삼겹/, /목살/, /등심/, /안심/, /갈비/],
    채소: [/배추/, /상추/, /시금치/, /깻잎/, /양파/, /파/, /마늘/, /고추/, /가지/, /오이/],
    과일: [/사과/, /배/, /포도/, /귤/, /오렌지/, /바나나/, /딸기/, /수박/, /참외/],
    유제품: [/우유/, /치즈/, /요거트/, /요구르트/, /버터/, /생크림/],
    가공식품: [/라면/, /과자/, /빵/, /케이크/, /쿠키/, /사탕/, /초콜릿/],
    조미료: [/소금/, /설탕/, /식초/, /간장/, /된장/, /고추장/, /참기름/, /식용유/],
    만두: [/만두/, /교자/, /왕만두/],
  }

  for (const [category, patterns] of Object.entries(categories)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        keywords.push(category)
        break
      }
    }
  }

  return keywords
}
