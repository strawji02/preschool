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

  // 한국 표기 천단위 콤마 제거 (예: "1,000G" → "1000G")
  // 콤마 뒤에 정확히 3자리 숫자가 오는 경우만 천단위로 간주
  spec = spec.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

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
 * 두 규격 간의 수량 보정 배수를 계산합니다.
 *
 * 거래명세표 규격과 공급사 규격의 단위 용량이 다를 때,
 * 공정한 가격 비교를 위해 필요한 배수를 계산합니다.
 *
 * @param invoiceSpec 거래명세표 규격 문자열 (예: "2KG")
 * @param supplierSpec 공급사 규격 문자열 (예: "1KG")
 * @returns 배수 정보 객체
 *
 * @example
 * calculateVolumeMultiplier("2KG", "1KG")   // { multiplier: 2, autoDetected: true }
 * calculateVolumeMultiplier("500g", "1kg")   // { multiplier: 0.5, autoDetected: true }
 * calculateVolumeMultiplier("1L", "500ml")   // { multiplier: 2, autoDetected: true }
 * calculateVolumeMultiplier("2KG", "500ml")  // { multiplier: 1, autoDetected: false, reason: '단위 불일치' }
 */
export function calculateVolumeMultiplier(
  invoiceSpec: string,
  supplierSpec: string
): { multiplier: number; autoDetected: boolean; reason?: string } {
  const invoiceNorm = normalizeSpec(invoiceSpec)
  const supplierNorm = normalizeSpec(supplierSpec)

  if (!invoiceNorm || !supplierNorm) {
    return { multiplier: 1, autoDetected: false, reason: '규격 파싱 불가' }
  }

  if (invoiceNorm.category !== supplierNorm.category) {
    return { multiplier: 1, autoDetected: false, reason: '단위 불일치' }
  }

  if (supplierNorm.value === 0) {
    return { multiplier: 1, autoDetected: false, reason: '공급사 규격값 0' }
  }

  const multiplier = Math.round((invoiceNorm.value / supplierNorm.value) * 100) / 100
  return { multiplier, autoDetected: true }
}

/**
 * 발주 단위 파싱 결과
 *
 * 거래명세표의 "규격/단위" 컬럼에 KG/EA/PK/BOX 등 발주 단위와
 * 개당 무게·팩당 개수가 혼재된 경우, 1 발주 단위당 무게(g)를 산출합니다.
 */
export interface OrderUnitInfo {
  original: string
  // 발주 단위 타입 (KG / EA / PK / BOX / null)
  unitType: string | null
  // 개당 무게(g) — EA(85g), PK.(개당64g...) 등에서 추출
  perSizeG: number | null
  // 팩/박스당 개수 — PK.(.../30ea) 등에서 추출
  perPackEa: number | null
  // 1 발주 단위당 무게(g). 산출 불가 시 null (예: BOX 무게 미상)
  unitWeightG: number | null
}

// 발주 단위 별칭 → 정규화 타입
const ORDER_UNIT_ALIASES: Array<{ type: string; patterns: RegExp }> = [
  { type: 'KG', patterns: /^\s*kg\b/i },
  { type: 'BOX', patterns: /^\s*(box|박스|상자)\b/i },
  { type: 'PK', patterns: /^\s*(pk|pack|팩)\b/i },
  { type: 'EA', patterns: /^\s*(ea|개|입)\b/i },
]

/**
 * 발주 단위 문자열을 파싱하여 1 발주 단위당 무게(g)를 산출합니다.
 *
 * @param spec 규격/단위 문자열 (예: "KG", "EA(85g)", "PK.(개당60~68g/30ea_국내산)")
 * @returns 발주 단위 정보
 *
 * @example
 * parseOrderUnit("KG")                      // unitType:"KG", unitWeightG:1000
 * parseOrderUnit("EA(85g)")                 // unitType:"EA", perSizeG:85, unitWeightG:85
 * parseOrderUnit("PK.(200g_외국산)")         // unitType:"PK", unitWeightG:200
 * parseOrderUnit("PK.(개당60~68g/30ea)")     // unitType:"PK", perSizeG:64, perPackEa:30, unitWeightG:1920
 * parseOrderUnit("BOX")                     // unitType:"BOX", unitWeightG:null
 */
export function parseOrderUnit(spec: string): OrderUnitInfo {
  const result: OrderUnitInfo = {
    original: spec,
    unitType: null,
    perSizeG: null,
    perPackEa: null,
    unitWeightG: null,
  }

  if (!spec || spec.trim() === '') {
    return result
  }

  const trimmed = spec.trim()

  // 1. 발주 단위 타입 판별 (문자열 시작 부분 기준)
  for (const { type, patterns } of ORDER_UNIT_ALIASES) {
    if (patterns.test(trimmed)) {
      result.unitType = type
      break
    }
  }

  // 2. 개당 무게 / 개수 추출 — (2026-07-05) 괄호가 없어도 전체 문자열에서 추출한다.
  //   계란판 "30구,52~60g_"(괄호 없음)처럼 개당무게·개수가 괄호 밖에 있는 규격 대응.
  // (2026-07-16) 천단위 콤마 제거 — "2,040g"이 "040→40g"으로 잘려 읽히던 버그 방지.
  //   숫자 사이 콤마만 제거(예: 2,040→2040). 다른 콤마(구분자)는 보존.
  const parseSrc = trimmed.replace(/(\d),(?=\d)/g, '$1')

  // 개당 무게: "52~60g" → 평균 56, "85g" → 85. (범위인지 여부는 총량/개당 판정에 사용)
  let perSizeFromRange = false
  const rangeMatch = parseSrc.match(/(\d+(?:\.\d+)?)\s*[~～\-]\s*(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  if (rangeMatch) {
    result.perSizeG = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2
    perSizeFromRange = true
  } else {
    // g 뒤에 알파벳이 오지 않는 경우만 (kg 오매칭 방지).
    const singleG = parseSrc.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
    if (singleG) {
      result.perSizeG = parseFloat(singleG[1])
    }
  }

  // 팩/판당 개수: "30ea", "30개", "30구"(계란판) — 뒤에 알파벳이 오지 않는 경우
  const eaMatch = parseSrc.match(/(\d+(?:\.\d+)?)\s*(ea|개|입|구)(?![a-z])/i)
  if (eaMatch) {
    result.perPackEa = parseFloat(eaMatch[1])
  }

  // (2026-07-16) 단일 대용량 그램값은 "팩 총량"으로 판정 — "30EA/2,040g"의 2040g은
  //   개당(68g)이 아니라 30알 팩 총량. 개당무게가 범위가 아니고 1000g 이상이면서
  //   개수가 함께 있으면 총량으로 보고 ×개수를 하지 않는다.
  //   (범위 "52~60g"·소량 "40g*72ea"는 개당이므로 영향 없음)
  const perSizeIsPackTotal =
    !perSizeFromRange &&
    result.perSizeG !== null &&
    result.perSizeG >= 1000 &&
    result.perPackEa !== null

  // (2026-07-05) 괄호 밖 kg 총량 — "EA 1kg(8±2g,90ea)"·"EA 개당17.3G/1KG"에서 괄호 밖 "1kg"이
  //   1 발주단위 총 무게. kg는 개당무게로 쓰이는 일이 없어(관례) 최우선 총량으로 택한다.
  const outer = trimmed.replace(/\([^)]*\)/g, ' ')
  const outerKgM = outer.match(/(\d+(?:\.\d+)?)\s*kg(?![a-z])/i)
  const outerKg = outerKgM ? parseFloat(outerKgM[1]) * 1000 : null

  // 3. 1 발주 단위당 무게(g) 산출 — 우선순위: 괄호밖 kg > 개당무게×개수 > 개당무게
  //   "30구,52~60g" → 56×30=1680, "1kg(8±2g,90ea)" → 1000(kg), "EA(85g)" → 85, "PK.(40g*72ea)" → 2880
  if (result.unitType === 'KG') {
    result.unitWeightG = 1000
  } else if (
    result.unitType === 'EA' ||
    result.unitType === 'PK' ||
    result.unitType === 'BOX'
  ) {
    if (outerKg !== null) {
      result.unitWeightG = outerKg
    } else if (perSizeIsPackTotal) {
      // "30EA/2,040g" — 2040g이 팩 총량이므로 ×개수 하지 않음
      result.unitWeightG = result.perSizeG
    } else if (result.perSizeG !== null && result.perPackEa !== null) {
      result.unitWeightG = result.perSizeG * result.perPackEa
    } else if (result.perSizeG !== null) {
      result.unitWeightG = result.perSizeG
    } else {
      result.unitWeightG = null
    }
  }

  return result
}

/**
 * 규격 텍스트에서 "개당 무게(g)"를 추출한다.
 *   "15개, 52~60G/개" → 56 (52~60 평균)
 *   "EA, 개당 200g"   → 200
 *   무게 표기가 없으면 null.
 */
export function perPieceGramsFromSpec(raw: string | null | undefined): number | null {
  if (!raw) return null
  const range = raw.match(/(\d+(?:\.\d+)?)\s*[~～\-]\s*(\d+(?:\.\d+)?)\s*g/i)
  if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2
  const single = raw.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  return single ? parseFloat(single[1]) : null
}

/**
 * 신세계 상품의 1 단위(발주단위) 무게(g)를 산출한다.
 *   - spec_unit이 무게/부피(KG/G/L/ML)면 spec_quantity가 곧 총량
 *   - 개수 단위(개/EA/팩/BOX 등)면 spec_raw의 개당무게 × spec_quantity(개수)
 *     예) 계란 유정란 "15개, 52~60G/개", q=15, u='개' → 56 × 15 = 840g
 *   산출 불가 시 0.
 */
export function ssgUnitWeightG(
  specQuantity: number | null | undefined,
  specUnit: string | null | undefined,
  specRaw: string | null | undefined,
): number {
  if (!specQuantity || !specUnit) return 0
  const u = specUnit.toUpperCase()
  if (u === 'KG' || u === 'L') return specQuantity * 1000
  if (u === 'G' || u === 'ML') return specQuantity
  // 개수 단위 — 개당무게 × 개수
  const per = perPieceGramsFromSpec(specRaw)
  return per ? Math.round(per * specQuantity) : 0
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
