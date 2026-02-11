/**
 * 깔때기(Funnel) 알고리즘 1단계: g당 단가 계산 모듈
 *
 * 규격 문자열에서 중량을 추출하고 g 단위로 정규화하여 g당 단가를 계산합니다.
 */

/**
 * 중량 정보
 */
export interface Weight {
  value: number
  unit: 'g' | 'kg' | 'ml' | 'L' | 'ea'
}

/**
 * 규격 문자열에서 중량 추출 (정규식 기반)
 *
 * @param spec 규격 문자열 (예: '2KG', '500g', '1박스(10kg)')
 * @returns 중량 정보 또는 null (중량 단위가 아닌 경우)
 *
 * @example
 * extractWeight('2KG') // { value: 2, unit: 'kg' }
 * extractWeight('500g') // { value: 500, unit: 'g' }
 * extractWeight('1박스(10kg)') // { value: 10, unit: 'kg' }
 * extractWeight('20개입') // { value: 20, unit: 'ea' }
 */
export function extractWeight(spec: string): Weight | null {
  if (!spec || spec.trim() === '') {
    return null
  }

  // 무게 단위 정규식 (대소문자 구분 없음)
  const weightRegex = /(\d+(?:\.\d+)?)\s*(kg|g|KG|G)/
  const weightMatch = spec.match(weightRegex)

  if (weightMatch) {
    const value = parseFloat(weightMatch[1])
    const unit = weightMatch[2].toLowerCase()
    return { value, unit: unit as 'g' | 'kg' }
  }

  // 부피 단위 정규식
  const volumeRegex = /(\d+(?:\.\d+)?)\s*(l|L|ml|ML)/
  const volumeMatch = spec.match(volumeRegex)

  if (volumeMatch) {
    const value = parseFloat(volumeMatch[1])
    const unit = volumeMatch[2].toLowerCase()
    return { value, unit: (unit === 'l' ? 'L' : 'ml') as 'ml' | 'L' }
  }

  // 개수 단위 정규식
  const countRegex = /(\d+(?:\.\d+)?)\s*(개|입|EA|ea)/
  const countMatch = spec.match(countRegex)

  if (countMatch) {
    const value = parseFloat(countMatch[1])
    return { value, unit: 'ea' }
  }

  return null
}

/**
 * 중량을 g 또는 ml 단위로 정규화
 *
 * @param weight 중량 정보
 * @returns 정규화된 중량 (g 또는 ml)
 *
 * @example
 * normalizeToGram({ value: 2, unit: 'kg' }) // 2000
 * normalizeToGram({ value: 500, unit: 'g' }) // 500
 * normalizeToGram({ value: 10, unit: 'kg' }) // 10000
 * normalizeToGram({ value: 1, unit: 'L' }) // 1000
 * normalizeToGram({ value: 500, unit: 'ml' }) // 500
 * normalizeToGram({ value: 20, unit: 'ea' }) // 20
 */
export function normalizeToGram(weight: Weight): number {
  switch (weight.unit) {
    case 'kg':
      return weight.value * 1000
    case 'g':
      return weight.value
    case 'L':
      return weight.value * 1000
    case 'ml':
      return weight.value
    case 'ea':
      return weight.value
    default:
      return weight.value
  }
}

/**
 * g당 단가 계산 (또는 ml당, ea당)
 *
 * @param price 가격 (원)
 * @param spec 규격 문자열
 * @returns g당 단가 (원/g) 또는 null (중량 단위가 아닌 경우)
 *
 * @example
 * calculatePricePerGram(10000, '2KG') // 5 (원/g)
 * calculatePricePerGram(5000, '500g') // 10 (원/g)
 * calculatePricePerGram(15000, '1박스(10kg)') // 1.5 (원/g)
 * calculatePricePerGram(3000, '20개입') // 150 (원/ea)
 */
export function calculatePricePerGram(price: number, spec: string): number | null {
  const weight = extractWeight(spec)

  if (!weight) {
    return null
  }

  const normalizedWeight = normalizeToGram(weight)

  if (normalizedWeight === 0) {
    return null
  }

  return price / normalizedWeight
}

/**
 * 단가 정보
 */
export interface PricePerUnit {
  /** 단가 (원/단위) */
  pricePerUnit: number
  /** 단위 ('g' | 'ml' | 'ea') */
  unit: 'g' | 'ml' | 'ea'
  /** 정규화된 중량/용량/개수 */
  normalizedQuantity: number
}

/**
 * g당/ml당/ea당 단가 정보 계산 (상세 정보 포함)
 *
 * @param price 가격 (원)
 * @param spec 규격 문자열
 * @returns 단가 정보 또는 null
 *
 * @example
 * calculatePricePerUnit(10000, '2KG')
 * // { pricePerUnit: 5, unit: 'g', normalizedQuantity: 2000 }
 *
 * calculatePricePerUnit(8000, '2L')
 * // { pricePerUnit: 4, unit: 'ml', normalizedQuantity: 2000 }
 */
export function calculatePricePerUnit(price: number, spec: string): PricePerUnit | null {
  const weight = extractWeight(spec)

  if (!weight) {
    return null
  }

  const normalizedQuantity = normalizeToGram(weight)

  if (normalizedQuantity === 0) {
    return null
  }

  const pricePerUnit = price / normalizedQuantity

  // 단위 결정
  let unit: 'g' | 'ml' | 'ea'
  if (weight.unit === 'kg' || weight.unit === 'g') {
    unit = 'g'
  } else if (weight.unit === 'L' || weight.unit === 'ml') {
    unit = 'ml'
  } else {
    unit = 'ea'
  }

  return {
    pricePerUnit,
    unit,
    normalizedQuantity,
  }
}
