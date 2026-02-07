/**
 * 한국어 식품명 전처리 모듈
 *
 * Phase 1 개선: BM25 + Hybrid Search 정확도 향상
 * - 조사 제거 (은/는/이/가/을/를)
 * - 맞춤법 통일
 * - 브랜드명 정규화
 * - 불필요한 패턴 제거
 */

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

// 브랜드명 정규화 (선택적 - 필요시 활성화)
const BRAND_NORMALIZATION: Record<string, string> = {
  삼양: '삼양',
  '삼양라면': '삼양',
  농심: '농심',
  오뚜기: '오뚜기',
  CJ: 'CJ',
  씨제이: 'CJ',
  풀무원: '풀무원',
}

// 조사 패턴 (제거할 조사들)
const PARTICLES = ['은', '는', '이', '가', '을', '를', '의', '도', '만', '까지', '부터', '에서', '으로', '로']

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
  } = {}
): string {
  const {
    removeParticles = true,
    normalizeSpelling = true,
    normalizeBrands = false,
    removeNumbers = true,
    removeSpecialChars = true,
  } = options

  let processed = name.trim()

  // 1. 괄호/대괄호 내용 제거
  processed = processed.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '')

  // 2. 숫자+단위 패턴 제거 (1kg, 200g, 500ml 등)
  if (removeNumbers) {
    processed = processed.replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box|호|번|입)/gi, '')
  }

  // 3. 맞춤법 통일
  if (normalizeSpelling) {
    for (const [wrong, correct] of Object.entries(SPELLING_NORMALIZATION)) {
      const regex = new RegExp(wrong, 'g')
      processed = processed.replace(regex, correct)
    }
  }

  // 4. 브랜드명 정규화 (선택적)
  if (normalizeBrands) {
    for (const [variant, standard] of Object.entries(BRAND_NORMALIZATION)) {
      const regex = new RegExp(variant, 'g')
      processed = processed.replace(regex, standard)
    }
  }

  // 5. 조사 제거
  if (removeParticles) {
    // 조사는 단어 끝에 붙으므로 공백 뒤에 오는 조사를 제거
    for (const particle of PARTICLES) {
      // 예: "만두는" → "만두"
      const regex = new RegExp(`${particle}(?=\\s|$)`, 'g')
      processed = processed.replace(regex, '')
    }
  }

  // 6. 남은 숫자 제거
  if (removeNumbers) {
    processed = processed.replace(/\d+/g, '')
  }

  // 7. 특수문자 제거 (한글, 영문, 공백만 유지)
  if (removeSpecialChars) {
    processed = processed.replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
  }

  // 8. 연속 공백 정리 및 trim
  processed = processed.replace(/\s+/g, ' ').trim()

  return processed
}

/**
 * 레거시 호환: 기존 normalizeItemName과 동일한 동작
 */
export function normalizeItemNameLegacy(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dual 정규화: BM25 키워드 검색용 + Semantic 검색용
 *
 * BM25용: 조사 제거, 맞춤법 통일 (키워드 매칭 향상)
 * Semantic용: 최소 정규화 (의미 보존)
 */
export function dualNormalize(name: string): {
  forKeyword: string // BM25 검색용
  forSemantic: string // Trigram/Vector 검색용
} {
  // BM25용: 공격적 정규화 (조사 제거, 맞춤법 통일)
  const forKeyword = preprocessKoreanFoodName(name, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
  })

  // Semantic용: 보수적 정규화 (의미 보존)
  const forSemantic = preprocessKoreanFoodName(name, {
    removeParticles: false, // 조사는 의미에 영향 줄 수 있음
    normalizeSpelling: true, // 맞춤법만 통일
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
  })

  return { forKeyword, forSemantic }
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
