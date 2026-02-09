/**
 * OCR 결과 데이터 무결성 검증 모듈
 *
 * OCR 추출 데이터의 품질과 유효성을 검증하여
 * 에러/경고/정상 상태를 판단합니다.
 */

import type { ComparisonItem } from '@/types/audit'

/**
 * 검증 레벨
 * - error: 치명적 오류 (빨간색)
 * - warning: 경고 (노란색)
 * - info: 정보성 알림 (파란색)
 * - success: 정상 (녹색)
 */
export type ValidationLevel = 'error' | 'warning' | 'info' | 'success'

/**
 * 검증 결과
 */
export interface ValidationResult {
  level: ValidationLevel
  field: string // 'name' | 'spec' | 'quantity' | 'unit_price' | 'match'
  message: string
  code: string // 에러 코드 (예: 'MISSING_NAME', 'INVALID_PRICE')
}

/**
 * 필드별 검증 결과
 */
export interface FieldValidation {
  name: ValidationResult[]
  spec: ValidationResult[]
  quantity: ValidationResult[]
  unit_price: ValidationResult[]
  match: ValidationResult[]
}

/**
 * 품목 전체 검증 결과
 */
export interface ItemValidation {
  item: ComparisonItem
  results: ValidationResult[]
  fields: FieldValidation
  hasError: boolean
  hasWarning: boolean
  isValid: boolean
}

/**
 * 가격 범위 검증 설정
 */
const PRICE_RANGES = {
  min: 1, // 최소 단가 (1원)
  max: 1_000_000, // 최대 단가 (100만원)
  suspicious_low: 10, // 의심스럽게 낮은 단가 (10원 미만)
  suspicious_high: 100_000, // 의심스럽게 높은 단가 (10만원 초과)
}

/**
 * 수량 범위 검증 설정
 */
const QUANTITY_RANGES = {
  min: 0.001, // 최소 수량
  max: 10_000, // 최대 수량
  suspicious_low: 0.1, // 의심스럽게 낮은 수량
  suspicious_high: 1_000, // 의심스럽게 높은 수량
}

/**
 * 품목명 검증
 */
function validateName(item: ComparisonItem): ValidationResult[] {
  const results: ValidationResult[] = []
  const name = item.extracted_name?.trim()

  // 1. 필수 필드 체크
  if (!name) {
    results.push({
      level: 'error',
      field: 'name',
      message: '품목명이 누락되었습니다',
      code: 'MISSING_NAME',
    })
    return results
  }

  // 2. 길이 체크
  if (name.length < 2) {
    results.push({
      level: 'warning',
      field: 'name',
      message: '품목명이 너무 짧습니다 (2자 미만)',
      code: 'NAME_TOO_SHORT',
    })
  }

  if (name.length > 100) {
    results.push({
      level: 'warning',
      field: 'name',
      message: '품목명이 너무 깁니다 (100자 초과)',
      code: 'NAME_TOO_LONG',
    })
  }

  // 3. 특수문자만으로 구성된 경우
  if (!/[가-힣a-zA-Z0-9]/.test(name)) {
    results.push({
      level: 'error',
      field: 'name',
      message: '유효한 품목명이 아닙니다 (특수문자만 포함)',
      code: 'INVALID_NAME',
    })
  }

  // 4. OCR 오류 패턴 감지
  const ocrErrorPatterns = [
    /[|]{2,}/, // 연속된 파이프 문자
    /[_]{3,}/, // 연속된 언더스코어
    /\s{3,}/, // 연속된 공백
  ]

  for (const pattern of ocrErrorPatterns) {
    if (pattern.test(name)) {
      results.push({
        level: 'warning',
        field: 'name',
        message: 'OCR 인식 오류가 의심됩니다',
        code: 'OCR_ERROR_SUSPECTED',
      })
      break
    }
  }

  return results
}

/**
 * 규격 검증
 */
function validateSpec(item: ComparisonItem): ValidationResult[] {
  const results: ValidationResult[] = []
  const spec = item.extracted_spec?.trim()

  // 규격은 선택 사항이므로 없어도 정상
  if (!spec) {
    return results
  }

  // 1. 길이 체크
  if (spec.length > 50) {
    results.push({
      level: 'warning',
      field: 'spec',
      message: '규격이 너무 깁니다 (50자 초과)',
      code: 'SPEC_TOO_LONG',
    })
  }

  // 2. 유효한 단위 포함 여부 체크
  const validUnits = /\d+\s*(kg|g|ml|l|ea|개|입|봉|박스|box|팩|pack|호|번)/i
  if (!validUnits.test(spec)) {
    results.push({
      level: 'info',
      field: 'spec',
      message: '표준 단위가 포함되지 않았습니다',
      code: 'NO_STANDARD_UNIT',
    })
  }

  return results
}

/**
 * 수량 검증
 */
function validateQuantity(item: ComparisonItem): ValidationResult[] {
  const results: ValidationResult[] = []
  const quantity = item.extracted_quantity

  // 1. 필수 필드 체크
  if (quantity === undefined || quantity === null) {
    results.push({
      level: 'error',
      field: 'quantity',
      message: '수량이 누락되었습니다',
      code: 'MISSING_QUANTITY',
    })
    return results
  }

  // 2. 유효한 숫자인지 체크
  if (typeof quantity !== 'number' || isNaN(quantity)) {
    results.push({
      level: 'error',
      field: 'quantity',
      message: '수량이 유효한 숫자가 아닙니다',
      code: 'INVALID_QUANTITY',
    })
    return results
  }

  // 3. 범위 체크 - 최소값
  if (quantity < QUANTITY_RANGES.min) {
    results.push({
      level: 'error',
      field: 'quantity',
      message: `수량이 너무 작습니다 (최소: ${QUANTITY_RANGES.min})`,
      code: 'QUANTITY_TOO_LOW',
    })
  }

  // 4. 범위 체크 - 최대값
  if (quantity > QUANTITY_RANGES.max) {
    results.push({
      level: 'warning',
      field: 'quantity',
      message: `수량이 매우 큽니다 (${quantity.toLocaleString()})`,
      code: 'QUANTITY_VERY_HIGH',
    })
  }

  // 5. 의심스러운 수량
  if (quantity < QUANTITY_RANGES.suspicious_low) {
    results.push({
      level: 'warning',
      field: 'quantity',
      message: '수량이 의심스럽게 낮습니다',
      code: 'QUANTITY_SUSPICIOUS_LOW',
    })
  }

  if (quantity > QUANTITY_RANGES.suspicious_high) {
    results.push({
      level: 'info',
      field: 'quantity',
      message: '수량이 평균보다 높습니다',
      code: 'QUANTITY_ABOVE_AVERAGE',
    })
  }

  return results
}

/**
 * 단가 검증
 */
function validateUnitPrice(item: ComparisonItem): ValidationResult[] {
  const results: ValidationResult[] = []
  const price = item.extracted_unit_price

  // 1. 필수 필드 체크
  if (price === undefined || price === null) {
    results.push({
      level: 'error',
      field: 'unit_price',
      message: '단가가 누락되었습니다',
      code: 'MISSING_UNIT_PRICE',
    })
    return results
  }

  // 2. 유효한 숫자인지 체크
  if (typeof price !== 'number' || isNaN(price)) {
    results.push({
      level: 'error',
      field: 'unit_price',
      message: '단가가 유효한 숫자가 아닙니다',
      code: 'INVALID_UNIT_PRICE',
    })
    return results
  }

  // 3. 범위 체크 - 최소값
  if (price < PRICE_RANGES.min) {
    results.push({
      level: 'error',
      field: 'unit_price',
      message: `단가가 너무 낮습니다 (최소: ${PRICE_RANGES.min}원)`,
      code: 'PRICE_TOO_LOW',
    })
  }

  // 4. 범위 체크 - 최대값
  if (price > PRICE_RANGES.max) {
    results.push({
      level: 'error',
      field: 'unit_price',
      message: `단가가 비정상적으로 높습니다 (${price.toLocaleString()}원)`,
      code: 'PRICE_TOO_HIGH',
    })
  }

  // 5. 의심스러운 가격
  if (price < PRICE_RANGES.suspicious_low && price >= PRICE_RANGES.min) {
    results.push({
      level: 'warning',
      field: 'unit_price',
      message: '단가가 의심스럽게 낮습니다',
      code: 'PRICE_SUSPICIOUS_LOW',
    })
  }

  if (price > PRICE_RANGES.suspicious_high && price <= PRICE_RANGES.max) {
    results.push({
      level: 'info',
      field: 'unit_price',
      message: '단가가 평균보다 높습니다',
      code: 'PRICE_ABOVE_AVERAGE',
    })
  }

  // 6. 소수점 자리수 체크 (원 단위는 보통 정수)
  if (price % 1 !== 0) {
    results.push({
      level: 'info',
      field: 'unit_price',
      message: '단가에 소수점이 포함되어 있습니다',
      code: 'PRICE_HAS_DECIMAL',
    })
  }

  return results
}

/**
 * 매칭 상태 검증
 */
function validateMatch(item: ComparisonItem): ValidationResult[] {
  const results: ValidationResult[] = []

  const hasCjMatch = item.cj_match !== undefined
  const hasSsgMatch = item.ssg_match !== undefined
  const hasAnyMatch = hasCjMatch || hasSsgMatch

  // 1. 매칭 없음
  if (!hasAnyMatch) {
    results.push({
      level: 'warning',
      field: 'match',
      message: '매칭된 상품이 없습니다',
      code: 'NO_MATCH',
    })
    return results
  }

  // 2. 매칭 점수 낮음
  if (hasCjMatch && item.cj_match!.match_score < 0.5) {
    results.push({
      level: 'warning',
      field: 'match',
      message: 'CJ 매칭 점수가 낮습니다',
      code: 'LOW_MATCH_SCORE_CJ',
    })
  }

  if (hasSsgMatch && item.ssg_match!.match_score < 0.5) {
    results.push({
      level: 'warning',
      field: 'match',
      message: '신세계 매칭 점수가 낮습니다',
      code: 'LOW_MATCH_SCORE_SSG',
    })
  }

  // 3. 가격 차이 크게 남 (절감 가능성)
  if (item.savings.max > 0) {
    results.push({
      level: 'info',
      field: 'match',
      message: `절감 가능: ${item.savings.max.toLocaleString()}원`,
      code: 'SAVINGS_AVAILABLE',
    })
  }

  return results
}

/**
 * 품목 전체 검증
 *
 * @param item 검증할 품목
 * @returns 검증 결과
 */
export function validateItem(item: ComparisonItem): ItemValidation {
  const nameResults = validateName(item)
  const specResults = validateSpec(item)
  const quantityResults = validateQuantity(item)
  const unitPriceResults = validateUnitPrice(item)
  const matchResults = validateMatch(item)

  const allResults = [...nameResults, ...specResults, ...quantityResults, ...unitPriceResults, ...matchResults]

  const hasError = allResults.some((r) => r.level === 'error')
  const hasWarning = allResults.some((r) => r.level === 'warning')

  return {
    item,
    results: allResults,
    fields: {
      name: nameResults,
      spec: specResults,
      quantity: quantityResults,
      unit_price: unitPriceResults,
      match: matchResults,
    },
    hasError,
    hasWarning,
    isValid: !hasError,
  }
}

/**
 * 여러 품목 일괄 검증
 *
 * @param items 검증할 품목 배열
 * @returns 검증 결과 배열
 */
export function validateItems(items: ComparisonItem[]): ItemValidation[] {
  return items.map(validateItem)
}

/**
 * 검증 결과 요약
 *
 * @param validations 검증 결과 배열
 * @returns 요약 통계
 */
export function summarizeValidation(validations: ItemValidation[]): {
  total: number
  valid: number
  hasError: number
  hasWarning: number
  errorRate: number
  warningRate: number
} {
  const total = validations.length
  const valid = validations.filter((v) => v.isValid && !v.hasWarning).length
  const hasError = validations.filter((v) => v.hasError).length
  const hasWarning = validations.filter((v) => v.hasWarning && !v.hasError).length

  return {
    total,
    valid,
    hasError,
    hasWarning,
    errorRate: total > 0 ? (hasError / total) * 100 : 0,
    warningRate: total > 0 ? (hasWarning / total) * 100 : 0,
  }
}

/**
 * 필드별 최고 심각도 레벨 반환
 *
 * @param results 검증 결과 배열
 * @returns 최고 심각도 레벨
 */
export function getHighestLevel(results: ValidationResult[]): ValidationLevel | null {
  if (results.length === 0) return null

  const levels: ValidationLevel[] = ['error', 'warning', 'info', 'success']

  for (const level of levels) {
    if (results.some((r) => r.level === level)) {
      return level
    }
  }

  return null
}

/**
 * 레벨에 따른 스타일 클래스 반환
 *
 * @param level 검증 레벨
 * @returns Tailwind CSS 클래스 문자열
 */
export function getLevelStyles(level: ValidationLevel | null): string {
  switch (level) {
    case 'error':
      return 'bg-red-50 border-red-300 text-red-900'
    case 'warning':
      return 'bg-yellow-50 border-yellow-300 text-yellow-900'
    case 'info':
      return 'bg-blue-50 border-blue-300 text-blue-900'
    case 'success':
      return 'bg-green-50 border-green-300 text-green-900'
    default:
      return ''
  }
}
