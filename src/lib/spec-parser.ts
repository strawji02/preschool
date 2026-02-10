/**
 * 규격 파싱 파이프라인
 *
 * "1kg", "500g", "10개입", "1박스(20개)" 등의 규격 문자열을 파싱하여
 * 정규화된 규격 객체로 변환합니다.
 */

/**
 * 파싱된 규격 정보
 */
export interface ParsedSpec {
  // 원본 문자열
  original: string

  // 주 단위 (외부 포장)
  primaryQuantity?: number // 예: "2박스" → 2
  primaryUnit?: string // 예: "2박스" → "박스"

  // 개별 단위 (내부 포장)
  innerQuantity?: number // 예: "1박스(20개)" → 20
  innerUnit?: string // 예: "1박스(20개)" → "개"

  // 용량/무게
  weight?: number // 숫자 값 (그램 기준)
  weightUnit?: string // 원본 단위 (kg, g 등)

  volume?: number // 숫자 값 (밀리리터 기준)
  volumeUnit?: string // 원본 단위 (L, ml 등)

  // 개수
  count?: number // 예: "10개입" → 10
  countUnit?: string // 예: "10개입" → "개"

  // 파싱 성공 여부
  isValid: boolean
  // 파싱 실패 이유
  parseError?: string
}

/**
 * 단위 변환 맵 (기본 단위로 변환)
 */
const UNIT_CONVERSIONS = {
  // 무게 (g 기준)
  weight: {
    kg: 1000,
    g: 1,
    t: 1_000_000,
    톤: 1_000_000,
    근: 600,
  },
  // 부피 (ml 기준)
  volume: {
    l: 1000,
    L: 1000,
    ml: 1,
    ML: 1,
  },
  // 개수 (개 기준)
  count: {
    개: 1,
    입: 1,
    EA: 1,
    ea: 1,
    수: 1,
  },
  // 포장 단위
  packaging: [
    '박스',
    'BOX',
    'box',
    '상자',
    '망',
    '봉',
    '팩',
    'PACK',
    'pack',
    '캔',
    '병',
    '통',
    '포',
    '세트',
    'SET',
    'set',
  ],
}

/**
 * 무게 단위 정규 표현식
 */
const WEIGHT_REGEX = /(\d+(?:\.\d+)?)\s*(kg|g|t|톤|근)/gi

/**
 * 부피 단위 정규 표현식
 */
const VOLUME_REGEX = /(\d+(?:\.\d+)?)\s*(l|L|ml|ML)/g

/**
 * 개수 단위 정규 표현식
 */
const COUNT_REGEX = /(\d+(?:\.\d+)?)\s*(개|입|EA|ea|수)/gi

/**
 * 포장 단위 정규 표현식 (동적 생성)
 */
const PACKAGING_REGEX = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_CONVERSIONS.packaging.join('|')})`,
  'gi'
)

/**
 * 괄호 안 내용 추출 정규 표현식
 */
const PARENTHESES_REGEX = /\(([^)]+)\)/g

/**
 * 규격 문자열 파싱
 *
 * @param spec 규격 문자열 (예: "1kg", "500g", "10개입", "1박스(20개)")
 * @returns 파싱된 규격 정보
 *
 * @example
 * parseSpec("1kg") // { weight: 1000, weightUnit: "kg", ... }
 * parseSpec("500g") // { weight: 500, weightUnit: "g", ... }
 * parseSpec("10개입") // { count: 10, countUnit: "개", ... }
 * parseSpec("1박스(20개)") // { primaryQuantity: 1, primaryUnit: "박스", innerQuantity: 20, innerUnit: "개", ... }
 * parseSpec("2L") // { volume: 2000, volumeUnit: "L", ... }
 * parseSpec("500ml") // { volume: 500, volumeUnit: "ml", ... }
 */
export function parseSpec(spec: string): ParsedSpec {
  if (!spec || spec.trim() === '') {
    return {
      original: spec,
      isValid: false,
      parseError: '빈 규격 문자열',
    }
  }

  const result: ParsedSpec = {
    original: spec,
    isValid: false,
  }

  try {
    // 1. 괄호 안 내용 추출 (내부 포장)
    const parenthesesMatches = Array.from(spec.matchAll(PARENTHESES_REGEX))
    let innerContent = ''
    let outerContent = spec

    if (parenthesesMatches.length > 0) {
      innerContent = parenthesesMatches[0][1]
      outerContent = spec.replace(PARENTHESES_REGEX, '').trim()
    }

    // 2. 외부 포장 파싱 (주 단위)
    const packagingMatch = outerContent.match(PACKAGING_REGEX)
    if (packagingMatch) {
      const quantity = parseFloat(packagingMatch[1])
      const unit = packagingMatch[2]
      result.primaryQuantity = quantity
      result.primaryUnit = unit
    }

    // 3. 무게 파싱
    const weightMatch = spec.match(WEIGHT_REGEX)
    if (weightMatch) {
      const quantity = parseFloat(weightMatch[1])
      const unit = weightMatch[2].toLowerCase()
      const conversion = UNIT_CONVERSIONS.weight[unit as keyof typeof UNIT_CONVERSIONS.weight]

      if (conversion) {
        result.weight = quantity * conversion
        result.weightUnit = weightMatch[2]
      }
    }

    // 4. 부피 파싱
    const volumeMatch = spec.match(VOLUME_REGEX)
    if (volumeMatch) {
      const quantity = parseFloat(volumeMatch[1])
      const unit = volumeMatch[2]
      const conversion = UNIT_CONVERSIONS.volume[unit as keyof typeof UNIT_CONVERSIONS.volume]

      if (conversion) {
        result.volume = quantity * conversion
        result.volumeUnit = volumeMatch[2]
      }
    }

    // 5. 개수 파싱
    const countMatch = spec.match(COUNT_REGEX)
    if (countMatch) {
      const quantity = parseFloat(countMatch[1])
      const unit = countMatch[2]
      result.count = quantity
      result.countUnit = unit
    }

    // 6. 내부 포장 파싱 (괄호 안)
    if (innerContent) {
      const innerCountMatch = innerContent.match(COUNT_REGEX)
      if (innerCountMatch) {
        result.innerQuantity = parseFloat(innerCountMatch[1])
        result.innerUnit = innerCountMatch[2]
      }

      const innerWeightMatch = innerContent.match(WEIGHT_REGEX)
      if (innerWeightMatch && !result.weight) {
        const quantity = parseFloat(innerWeightMatch[1])
        const unit = innerWeightMatch[2].toLowerCase()
        const conversion = UNIT_CONVERSIONS.weight[unit as keyof typeof UNIT_CONVERSIONS.weight]

        if (conversion) {
          result.weight = quantity * conversion
          result.weightUnit = innerWeightMatch[2]
        }
      }
    }

    // 7. 유효성 검증
    result.isValid =
      result.weight !== undefined ||
      result.volume !== undefined ||
      result.count !== undefined ||
      result.primaryQuantity !== undefined

    if (!result.isValid) {
      result.parseError = '인식 가능한 단위를 찾을 수 없습니다'
    }
  } catch (error) {
    result.isValid = false
    result.parseError = error instanceof Error ? error.message : '파싱 중 오류 발생'
  }

  return result
}

/**
 * 여러 규격 문자열 일괄 파싱
 *
 * @param specs 규격 문자열 배열
 * @returns 파싱 결과 배열
 */
export function parseSpecs(specs: string[]): ParsedSpec[] {
  return specs.map(parseSpec)
}

/**
 * 규격을 표준 형식 문자열로 변환
 *
 * @param parsed 파싱된 규격 정보
 * @returns 표준 형식 문자열
 *
 * @example
 * formatSpec({ weight: 1000, weightUnit: "kg" }) // "1kg"
 * formatSpec({ primaryQuantity: 1, primaryUnit: "박스", innerQuantity: 20, innerUnit: "개" }) // "1박스(20개)"
 */
export function formatSpec(parsed: ParsedSpec): string {
  if (!parsed.isValid) {
    return parsed.original
  }

  const parts: string[] = []

  // 주 단위 (외부 포장)
  if (parsed.primaryQuantity !== undefined && parsed.primaryUnit) {
    parts.push(`${parsed.primaryQuantity}${parsed.primaryUnit}`)
  }

  // 무게
  if (parsed.weight !== undefined && parsed.weightUnit) {
    const quantity =
      parsed.weightUnit.toLowerCase() === 'kg' ? parsed.weight / 1000 : parsed.weight
    parts.push(`${quantity}${parsed.weightUnit}`)
  }

  // 부피
  if (parsed.volume !== undefined && parsed.volumeUnit) {
    const quantity =
      parsed.volumeUnit.toLowerCase() === 'l' ? parsed.volume / 1000 : parsed.volume
    parts.push(`${quantity}${parsed.volumeUnit}`)
  }

  // 개수
  if (parsed.count !== undefined && parsed.countUnit) {
    parts.push(`${parsed.count}${parsed.countUnit}`)
  }

  // 내부 포장
  if (parsed.innerQuantity !== undefined && parsed.innerUnit) {
    const inner = `${parsed.innerQuantity}${parsed.innerUnit}`
    if (parts.length > 0) {
      parts[parts.length - 1] += `(${inner})`
    } else {
      parts.push(inner)
    }
  }

  return parts.join(' ')
}

/**
 * 두 규격이 호환되는지 확인
 *
 * @param spec1 첫 번째 규격
 * @param spec2 두 번째 규격
 * @returns 호환 가능 여부
 *
 * @example
 * areSpecsCompatible(parseSpec("1kg"), parseSpec("500g")) // true (둘 다 무게)
 * areSpecsCompatible(parseSpec("1kg"), parseSpec("1L")) // false (무게 vs 부피)
 */
export function areSpecsCompatible(spec1: ParsedSpec, spec2: ParsedSpec): boolean {
  // 무게 단위끼리 호환
  if (spec1.weight !== undefined && spec2.weight !== undefined) {
    return true
  }

  // 부피 단위끼리 호환
  if (spec1.volume !== undefined && spec2.volume !== undefined) {
    return true
  }

  // 개수 단위끼리 호환
  if (spec1.count !== undefined && spec2.count !== undefined) {
    return true
  }

  return false
}

/**
 * 규격을 기본 단위로 정규화
 *
 * @param spec 규격 문자열
 * @returns 정규화된 값과 단위
 *
 * @example
 * normalizeSpec("1kg") // { value: 1000, unit: "g" }
 * normalizeSpec("2L") // { value: 2000, unit: "ml" }
 * normalizeSpec("10개") // { value: 10, unit: "개" }
 */
export function normalizeSpec(
  spec: string
): { value: number; unit: string; category: 'weight' | 'volume' | 'count' | 'unknown' } | null {
  const parsed = parseSpec(spec)

  if (!parsed.isValid) {
    return null
  }

  // 무게 우선
  if (parsed.weight !== undefined) {
    return { value: parsed.weight, unit: 'g', category: 'weight' }
  }

  // 부피
  if (parsed.volume !== undefined) {
    return { value: parsed.volume, unit: 'ml', category: 'volume' }
  }

  // 개수
  if (parsed.count !== undefined) {
    return { value: parsed.count, unit: '개', category: 'count' }
  }

  return null
}

/**
 * 규격 비교 (정규화된 값 기준)
 *
 * @param spec1 첫 번째 규격
 * @param spec2 두 번째 규격
 * @returns 비교 결과 (-1: spec1 < spec2, 0: 같음, 1: spec1 > spec2, null: 비교 불가)
 */
export function compareSpecs(spec1: string, spec2: string): number | null {
  const normalized1 = normalizeSpec(spec1)
  const normalized2 = normalizeSpec(spec2)

  if (!normalized1 || !normalized2) {
    return null
  }

  // 카테고리가 다르면 비교 불가
  if (normalized1.category !== normalized2.category) {
    return null
  }

  if (normalized1.value < normalized2.value) return -1
  if (normalized1.value > normalized2.value) return 1
  return 0
}
