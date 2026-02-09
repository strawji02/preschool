/**
 * 식자재 동의어 사전
 * 검색 및 매칭 시 동의어를 고려하여 더 정확한 결과 제공
 */

/**
 * 식자재 동의어 맵
 * key: 표준 용어, value: 동의어 배열
 */
export const FOOD_SYNONYMS: Record<string, string[]> = {
  // 돼지고기 부위
  돈전지: ['앞다리', '앞다리살', '전지'],
  돈후지: ['뒷다리', '뒷다리살', '후지'],
  돈목살: ['목살'],
  돈삼겹: ['삼겹살', '삼겹'],
  돈등심: ['등심'],
  돈안심: ['안심'],

  // 소고기 부위
  소전지: ['소앞다리'],
  소후지: ['소뒷다리'],
  소등심: ['소등심살'],
  소안심: ['소안심살'],

  // 계란/달걀
  계란: ['달걀', '란', '에그'],
  달걀: ['계란', '란', '에그'],

  // 채소
  양파: ['ONION'],
  감자: ['POTATO', '포테이토'],
  당근: ['CARROT', '캐롯'],
  배추: ['CABBAGE'],
  무: ['RADISH', '무우'],
  대파: ['파', '파대', '쪽파대'],
  고추: ['PEPPER', '풋고추', '청양고추'],
  마늘: ['GARLIC'],
  생강: ['GINGER'],
  깻잎: ['깨잎', '깻잎채소'],

  // 과일
  사과: ['APPLE', '애플'],
  배: ['PEAR'],
  바나나: ['BANANA'],
  딸기: ['STRAWBERRY', '스트로베리'],
  포도: ['GRAPE', '그레이프'],
  수박: ['WATERMELON'],

  // 곡물
  쌀: ['백미', '멥쌀', 'RICE'],
  현미: ['BROWN_RICE', '브라운라이스'],
  찹쌀: ['GLUTINOUS_RICE'],
  밀가루: ['FLOUR', '밀가루'],

  // 조미료
  소금: ['SALT', '천일염', '정제염'],
  설탕: ['SUGAR', '백설탕'],
  간장: ['SOY_SAUCE', '양조간장', '진간장'],
  된장: ['SOYBEAN_PASTE'],
  고추장: ['RED_PEPPER_PASTE'],
  식초: ['VINEGAR'],
  참기름: ['SESAME_OIL'],
  들기름: ['PERILLA_OIL'],

  // 육류 일반
  돼지고기: ['돼지', '돈육', 'PORK'],
  소고기: ['소', '우육', 'BEEF'],
  닭고기: ['닭', '계육', 'CHICKEN'],

  // 해산물
  고등어: ['MACKEREL'],
  갈치: ['HAIRTAIL'],
  명태: ['POLLACK'],
  오징어: ['SQUID'],
  새우: ['SHRIMP'],

  // 가공식품
  두부: ['TOFU', '콩두부'],
  유부: ['FRIED_TOFU'],
  어묵: ['FISH_CAKE'],
}

/**
 * 역방향 동의어 맵 (동의어 → 표준 용어)
 * 자동 생성되어 빠른 검색 지원
 */
export const REVERSE_SYNONYMS: Record<string, string> = (() => {
  const reverse: Record<string, string> = {}

  for (const [standard, synonyms] of Object.entries(FOOD_SYNONYMS)) {
    // 표준 용어도 자기 자신으로 매핑
    reverse[standard] = standard

    // 각 동의어를 표준 용어로 매핑
    for (const synonym of synonyms) {
      reverse[synonym] = standard
    }
  }

  return reverse
})()

/**
 * 주어진 용어를 표준 용어로 변환
 *
 * @param term 검색 용어
 * @returns 표준 용어 (동의어 사전에 없으면 원래 용어 반환)
 *
 * @example
 * getStandardTerm('앞다리') // '돈전지'
 * getStandardTerm('계란') // '계란' (표준 용어)
 * getStandardTerm('알 수 없는 용어') // '알 수 없는 용어' (그대로 반환)
 */
export function getStandardTerm(term: string): string {
  return REVERSE_SYNONYMS[term] || term
}

/**
 * 동의어를 포함한 검색 용어 확장
 *
 * @param term 원래 검색 용어
 * @returns 원래 용어 + 모든 동의어 배열
 *
 * @example
 * expandWithSynonyms('돈전지') // ['돈전지', '앞다리', '앞다리살', '전지']
 * expandWithSynonyms('계란') // ['계란', '달걀', '란', '에그']
 * expandWithSynonyms('알 수 없는 용어') // ['알 수 없는 용어']
 */
export function expandWithSynonyms(term: string): string[] {
  // 표준 용어로 변환
  const standard = getStandardTerm(term)

  // 표준 용어의 동의어 목록 가져오기
  const synonyms = FOOD_SYNONYMS[standard] || []

  // 표준 용어 + 동의어 합치기 (중복 제거)
  return Array.from(new Set([standard, ...synonyms]))
}

/**
 * 두 용어가 동의어 관계인지 확인
 *
 * @param term1 첫 번째 용어
 * @param term2 두 번째 용어
 * @returns 동의어 관계면 true
 *
 * @example
 * areSynonyms('돈전지', '앞다리') // true
 * areSynonyms('계란', '달걀') // true
 * areSynonyms('양파', '감자') // false
 */
export function areSynonyms(term1: string, term2: string): boolean {
  const standard1 = getStandardTerm(term1)
  const standard2 = getStandardTerm(term2)

  // 두 용어의 표준 용어가 같으면 동의어
  return standard1 === standard2
}

/**
 * 텍스트에서 동의어를 표준 용어로 정규화
 *
 * @param text 원래 텍스트
 * @returns 동의어가 표준 용어로 변환된 텍스트
 *
 * @example
 * normalizeText('앞다리 500g') // '돈전지 500g'
 * normalizeText('달걀 10개') // '계란 10개'
 */
export function normalizeText(text: string): string {
  let normalized = text

  // 모든 동의어를 표준 용어로 치환
  for (const [synonym, standard] of Object.entries(REVERSE_SYNONYMS)) {
    if (synonym !== standard) {
      // 단어 경계를 고려한 정규식 (부분 매치 방지)
      const regex = new RegExp(`\\b${synonym}\\b`, 'gi')
      normalized = normalized.replace(regex, standard)
    }
  }

  return normalized
}

/**
 * 동의어 그룹 가져오기
 *
 * @param term 검색 용어
 * @returns 표준 용어와 모든 동의어를 포함하는 배열 (동의어 사전에 없으면 빈 배열)
 *
 * @example
 * getSynonymGroup('앞다리') // ['돈전지', '앞다리', '앞다리살', '전지']
 * getSynonymGroup('알 수 없는 용어') // []
 */
export function getSynonymGroup(term: string): string[] {
  const standard = getStandardTerm(term)

  // 동의어 사전에 없으면 빈 배열 반환
  if (!FOOD_SYNONYMS[standard]) {
    return []
  }

  return [standard, ...(FOOD_SYNONYMS[standard] || [])]
}
