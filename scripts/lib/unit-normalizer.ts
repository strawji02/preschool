/**
 * 단위 정규화 유틸리티
 * 다양한 형태의 단위 표기를 표준 형태로 변환
 */

const UNIT_MAPPING: Record<string, string> = {
  // COUNT (개수)
  'EA': 'EA',
  'ea': 'EA',
  '개': 'EA',
  '마리': 'EA',
  '판': 'EA',
  '입': 'EA',
  '줄': 'EA',
  '조각': 'EA',
  '장': 'EA',
  '미': 'EA',
  '속': 'EA',
  '등': 'EA',
  '근': 'EA',

  // WEIGHT (무게)
  'KG': 'KG',
  'kg': 'KG',
  'Kg': 'KG',
  '키로': 'KG',
  '킬로': 'KG',
  'G': 'G',
  'g': 'G',
  '그램': 'G',

  // PACKAGE (패키지)
  'BOX': 'BOX',
  'box': 'BOX',
  'Box': 'BOX',
  '박스': 'BOX',
  '상': 'BOX',
  'PAC': 'PACK',
  'PACK': 'PACK',
  'pack': 'PACK',
  '팩': 'PACK',
  '봉': 'BAG',
  '포': 'BAG',
  'BAG': 'BAG',
  '통': 'CAN',
  'CAN': 'CAN',
  '캔': 'CAN',
  '병': 'BOTTLE',
  '페트': 'BOTTLE',
  'BOTTLE': 'BOTTLE',
  'BTL': 'BOTTLE',

  // VOLUME (부피)
  'L': 'L',
  'l': 'L',
  '리터': 'L',
  'ML': 'ML',
  'ml': 'ML',
  'Ml': 'ML',
  '밀리': 'ML',
}

/**
 * 원본 단위를 정규화된 단위로 변환
 * @param rawUnit 원본 단위 문자열
 * @returns 정규화된 단위 (매핑에 없으면 대문자로 변환)
 */
export function normalizeUnit(rawUnit: string | null | undefined): string {
  if (!rawUnit) return 'EA'

  const trimmed = rawUnit.trim()
  return UNIT_MAPPING[trimmed] ?? trimmed.toUpperCase()
}

/**
 * 단위 카테고리 반환
 */
export function getUnitCategory(normalizedUnit: string): string {
  const categories: Record<string, string[]> = {
    COUNT: ['EA'],
    WEIGHT: ['KG', 'G'],
    PACKAGE: ['BOX', 'PACK', 'BAG', 'CAN', 'BOTTLE'],
    VOLUME: ['L', 'ML'],
  }

  for (const [category, units] of Object.entries(categories)) {
    if (units.includes(normalizedUnit)) {
      return category
    }
  }
  return 'OTHER'
}
