/**
 * 통합 단위 환산 모듈
 *
 * DB 기반 환산 → 기본 환산 폴백 전략으로 "환산불가" 최소화
 */

import { convertPrice as basicConvertPrice, type NormalizedUnit, parseUnitString } from './unitConversion'

/*
  ⚠️ **DB 환산은 여기서 하지 않는다** (2026-08-10).

  전에는 `unit-conversion-db`를 직접 불렀는데, 이 함수를 쓰는 곳이
  `MatchingRow`·`CandidateSelector` **둘 다 클라이언트 컴포넌트**다. 그래서
  service_role로 DB를 붙는 코드가 브라우저 번들에 실렸고(128KB 청크),
  정작 브라우저에는 키가 없어 `supabase-js`가 던지고 매번 폴백됐다.
  **DB 환산은 한 번도 동작한 적이 없다.**

  키 값 자체는 번들에 없었다 — Next가 `NEXT_PUBLIC_` 접두어만 인라인한다.
  그래도 서버 전용 코드를 브라우저에 실을 이유가 없어 끊었다.

  되살리려면 **API 경로로 빼야 한다**(`/api/unit-conversions/factor` 등).
  매칭 결과가 달라지므로 별도 작업으로 다룬다 — `docs/systems/comparison.md`.
*/

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
 * 1. 기본 환산 (kg↔g, L↔ml)
 * 2. 실패 (환산불가)
 *
 * ⚠️ DB 환산은 서버에서만 가능해 빠져 있다 (위 주석 참고).
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

  // Strategy 1: 기본 환산 (kg↔g, L↔ml)
  const basicResult = basicConvertPrice(price, fromUnit, toUnit, toQuantity)
  if (basicResult !== null) {
    return {
      success: true,
      convertedPrice: basicResult,
      method: 'basic',
      message: '기본 환산'
    }
  }

  // Strategy 2: 환산 실패
  return {
    success: false,
    convertedPrice: null,
    method: 'failed',
    message: '환산불가'
  }
}
