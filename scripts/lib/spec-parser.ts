/**
 * 규격(Spec) 파싱 유틸리티
 * CJ와 신세계 형식에 맞춰 규격 정보를 추출
 */

export interface ParsedSpec {
  quantity: number | null
  unit: string | null
  raw: string | null
  parseFailed: boolean
}

/**
 * CJ 상품명에서 규격 추출
 * CJ는 별도 규격 컬럼이 없어 상품명 끝에서 추출
 * 예: "옛날당면(1.5KG/PAC)" -> { quantity: 1.5, unit: 'KG' }
 */
export function parseCJSpec(productName: string): ParsedSpec {
  if (!productName) {
    return { quantity: null, unit: null, raw: null, parseFailed: true }
  }

  // 패턴 1: 숫자+단위/포장단위 형태 - "1.5KG/PAC"
  const pattern1 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\s*\/\s*([A-Za-z]+)\)?$/
  let match = productName.match(pattern1)
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      raw: productName,
      parseFailed: false,
    }
  }

  // 패턴 2: 숫자+단위 포장단위 형태 - "1.5KG PAC"
  const pattern2 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\s+([A-Za-z]+)\)?$/
  match = productName.match(pattern2)
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      raw: productName,
      parseFailed: false,
    }
  }

  // 패턴 3: 괄호 안 숫자+단위 - "(200G)"
  const pattern3 = /\((\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\)$/
  match = productName.match(pattern3)
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      raw: productName,
      parseFailed: false,
    }
  }

  // 패턴 4: 마지막 숫자+단위 - "200G"
  const pattern4 = /(\d+(?:\.\d+)?)\s*([KkGgMmLl]+)\)?$/
  match = productName.match(pattern4)
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
      raw: productName,
      parseFailed: false,
    }
  }

  // 패턴 5: 'x숫자' 형태의 개수 추출 - "10EA" 또는 "x10"
  const pattern5 = /[xX×]\s*(\d+)\s*(?:EA|개)?$/
  match = productName.match(pattern5)
  if (match) {
    return {
      quantity: parseInt(match[1]),
      unit: 'EA',
      raw: productName,
      parseFailed: false,
    }
  }

  return { quantity: null, unit: null, raw: productName, parseFailed: true }
}

/**
 * 신세계 규격 컬럼 파싱
 * 규격 컬럼이 별도로 있어 직접 파싱
 * 예: "45G*20개*6팩" -> { quantity: 5400, unit: 'G' }
 */
export function parseShinsegaeSpec(spec: string): ParsedSpec {
  if (!spec) {
    return { quantity: null, unit: null, raw: null, parseFailed: true }
  }

  spec = spec.trim()

  // 패턴 1: 단순 숫자+단위 - "500G", "1.5KG"
  const pattern1 = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/
  let match = spec.match(pattern1)
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: match[2].toUpperCase(),
      raw: spec,
      parseFailed: false,
    }
  }

  // 패턴 2: 복합 곱셈 형태 - "45G*20개*6팩"
  const pattern2 = /^(\d+(?:[.,]\d+)?)\s*([GgKkMmLl]+)\s*\*\s*(\d+)/
  match = spec.match(pattern2)
  if (match) {
    let baseQty = parseFloat(match[1].replace(',', '.'))
    const unit = match[2].toUpperCase()
    let multiplier = parseInt(match[3])

    // 추가 곱셈 인자들 추출
    const remaining = spec.substring(match[0].length)
    const multPattern = /\*\s*(\d+)/g
    let multMatch: RegExpExecArray | null
    while ((multMatch = multPattern.exec(remaining)) !== null) {
      multiplier *= parseInt(multMatch[1])
    }

    return {
      quantity: baseQty * multiplier,
      unit: unit,
      raw: spec,
      parseFailed: false,
    }
  }

  // 패턴 3: 범위 표현 - "0.8~1.2KG" (평균값 사용)
  const pattern3 = /^(\d+(?:[.,]\d+)?)\s*~\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/
  match = spec.match(pattern3)
  if (match) {
    const min = parseFloat(match[1].replace(',', '.'))
    const max = parseFloat(match[2].replace(',', '.'))
    return {
      quantity: (min + max) / 2,
      unit: match[3].toUpperCase(),
      raw: spec,
      parseFailed: false,
    }
  }

  // 패턴 4: 첫 번째 숫자+단위 추출 (fallback)
  const pattern4 = /(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)/
  match = spec.match(pattern4)
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: match[2].toUpperCase(),
      raw: spec,
      parseFailed: false,
    }
  }

  // 패턴 5: 숫자만 있는 경우 - "500" (단위 없음, EA로 가정)
  const pattern5 = /^(\d+(?:[.,]\d+)?)$/
  match = spec.match(pattern5)
  if (match) {
    return {
      quantity: parseFloat(match[1].replace(',', '.')),
      unit: 'EA',
      raw: spec,
      parseFailed: false,
    }
  }

  return { quantity: null, unit: null, raw: spec, parseFailed: true }
}
