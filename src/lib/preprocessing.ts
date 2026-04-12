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
  '팔도', '코카콜라', '펩시', '칠성'
]

// 가공 지시어 (괄호 분리에 사용)
const PROCESSING_KEYWORDS = [
  '피제거', '시제거', '깍뚝썰기', '슬라이스', '다진', '채썬', '손질',
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
} {
  // BM25용: 공격적 정규화 (조사 제거, 맞춤법 통일, 동의어 정규화)
  const forKeyword = preprocessKoreanFoodName(name, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: true, // 동의어 정규화 활성화
  })

  // Semantic용: 보수적 정규화 (의미 보존, 동의어 정규화)
  const forSemantic = preprocessKoreanFoodName(name, {
    removeParticles: false, // 조사는 의미에 영향 줄 수 있음
    normalizeSpelling: true, // 맞춤법만 통일
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: true, // 동의어 정규화 활성화
  })

  return { forKeyword, forSemantic }
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
  // 먼저 전처리 (숫자 등 제거)
  const normalized = preprocessKoreanFoodName(query, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
    normalizeSynonyms: false, // 동의어는 expandWithSynonyms에서 처리
  })

  // 동의어 확장
  return expandWithSynonyms(normalized)
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
