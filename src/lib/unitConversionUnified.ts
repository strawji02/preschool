/**
 * 통합 단위 환산 모듈
 *
 * DB 기반 환산 → 기본 환산 폴백 전략으로 "환산불가" 최소화
 */

import { convertPrice as basicConvertPrice, type NormalizedUnit, parseUnitString } from './unitConversion'
import { getConversionFactor } from './unit-conversion-db'

export interface ConversionResult {
  success: boolean
  convertedPrice: number | null
  method: 'db' | 'basic' | 'failed'
  message?: string
}

/**
 * 통합 가격 환산 함수
 *
 * 전략:
 * 1. 카테고리별 DB 환산 시도 (가장 정확)
 * 2. 범용 DB 환산 시도 (category=null)
 * 3. 기본 환산 폴백 (kg↔g, L↔ml)
 * 4. 실패 (환산불가)
 *
 * @param price 원가격
 * @param fromUnit 원본 단위 (예: "1kg", "망")
 * @param toUnit 변환할 단위 (예: "g")
 * @param toQuantity 변환할 수량 (예: 500)
 * @param category 품목 카테고리 (예: "양파")
 * @returns 환산 결과 객체
 */
export async function convertPriceUnified(
  price: number,
  fromUnit: string,
  toUnit: NormalizedUnit,
  toQuantity: number,
  category?: string | null
): Promise<ConversionResult> {
  const parsed = parseUnitString(fromUnit)
  if (!parsed) {
    return {
      success: false,
      convertedPrice: null,
      method: 'failed',
      message: '단위 파싱 실패'
    }
  }

  // Strategy 1: 카테고리별 DB 환산 (가장 정확)
  if (category) {
    try {
      const dbFactor = await getConversionFactor(category, parsed.unit, toUnit)
      if (dbFactor !== null) {
        const pricePerUnit = price / parsed.quantity
        const convertedPrice = pricePerUnit * dbFactor * toQuantity
        return {
          success: true,
          convertedPrice,
          method: 'db',
          message: `${parsed.unit}→${toUnit}`
        }
      }
    } catch (error) {
      console.warn('DB conversion failed:', error)
    }
  }

  // Strategy 2: 범용 DB 환산 (category=null)
  try {
    const dbFactor = await getConversionFactor(null, parsed.unit, toUnit)
    if (dbFactor !== null) {
      const pricePerUnit = price / parsed.quantity
      const convertedPrice = pricePerUnit * dbFactor * toQuantity
      return {
        success: true,
        convertedPrice,
        method: 'db',
        message: `범용 ${parsed.unit}→${toUnit}`
      }
    }
  } catch (error) {
    console.warn('Generic DB conversion failed:', error)
  }

  // Strategy 3: 기본 환산 폴백 (kg↔g, L↔ml)
  const basicResult = basicConvertPrice(price, fromUnit, toUnit, toQuantity)
  if (basicResult !== null) {
    return {
      success: true,
      convertedPrice: basicResult,
      method: 'basic',
      message: '기본 환산'
    }
  }

  // Strategy 4: 환산 실패
  return {
    success: false,
    convertedPrice: null,
    method: 'failed',
    message: '환산불가'
  }
}
