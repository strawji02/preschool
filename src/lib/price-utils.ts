/**
 * 가격 처리 유틸리티 (부가세 포함)
 */

export type TaxType = 'taxed' | 'tax-free' // 과세 / 면세
export type VatIncluded = boolean // VAT 포함 여부

/**
 * 가격을 비교 가능한 정규화된 형태로 변환
 *
 * @param price 원래 가격
 * @param taxType 과세 구분 ('taxed' | 'tax-free')
 * @param vatIncluded VAT 포함 여부
 * @returns 정규화된 가격 (VAT 포함 기준)
 *
 * @example
 * // 과세 품목, VAT 별도 10,000원 → 11,000원
 * normalizePrice(10000, 'taxed', false) // 11000
 *
 * // 과세 품목, VAT 포함 11,000원 → 11,000원
 * normalizePrice(11000, 'taxed', true) // 11000
 *
 * // 면세 품목, 10,000원 → 10,000원 (VAT 무관)
 * normalizePrice(10000, 'tax-free', false) // 10000
 */
export function normalizePrice(price: number, taxType: TaxType, vatIncluded: VatIncluded): number {
  // 면세 품목은 VAT 적용 안 함
  if (taxType === 'tax-free') {
    return price
  }

  // 과세 품목이고 VAT 별도인 경우 10% 추가
  if (taxType === 'taxed' && !vatIncluded) {
    return price * 1.1
  }

  // 과세 품목이고 VAT 포함인 경우 그대로 반환
  return price
}

/**
 * VAT를 제외한 공급가액 계산
 *
 * @param price 가격
 * @param taxType 과세 구분
 * @param vatIncluded VAT 포함 여부
 * @returns 공급가액 (VAT 제외)
 */
export function getSupplyPrice(price: number, taxType: TaxType, vatIncluded: VatIncluded): number {
  // 면세 품목은 전액이 공급가액
  if (taxType === 'tax-free') {
    return price
  }

  // 과세 품목이고 VAT 포함인 경우 VAT 제거
  if (taxType === 'taxed' && vatIncluded) {
    return price / 1.1
  }

  // 과세 품목이고 VAT 별도인 경우 그대로 공급가액
  return price
}

/**
 * VAT 금액 계산
 *
 * @param price 가격
 * @param taxType 과세 구분
 * @param vatIncluded VAT 포함 여부
 * @returns VAT 금액
 */
export function getVatAmount(price: number, taxType: TaxType, vatIncluded: VatIncluded): number {
  // 면세 품목은 VAT 없음
  if (taxType === 'tax-free') {
    return 0
  }

  const supplyPrice = getSupplyPrice(price, taxType, vatIncluded)
  return supplyPrice * 0.1
}

/**
 * 두 가격을 비교 (부가세 고려)
 *
 * @param price1 첫 번째 가격
 * @param taxType1 첫 번째 과세 구분
 * @param vatIncluded1 첫 번째 VAT 포함 여부
 * @param price2 두 번째 가격
 * @param taxType2 두 번째 과세 구분
 * @param vatIncluded2 두 번째 VAT 포함 여부
 * @returns 차액 (price1 - price2, 정규화된 기준)
 *
 * @example
 * // 과세 VAT별도 10,000원 vs 과세 VAT포함 11,000원
 * comparePrices(10000, 'taxed', false, 11000, 'taxed', true) // 0 (동일)
 *
 * // 과세 VAT별도 10,000원 vs 면세 10,000원
 * comparePrices(10000, 'taxed', false, 10000, 'tax-free', false) // 1000 (과세가 더 비쌈)
 */
export function comparePrices(
  price1: number,
  taxType1: TaxType,
  vatIncluded1: VatIncluded,
  price2: number,
  taxType2: TaxType,
  vatIncluded2: VatIncluded
): number {
  const normalized1 = normalizePrice(price1, taxType1, vatIncluded1)
  const normalized2 = normalizePrice(price2, taxType2, vatIncluded2)
  return normalized1 - normalized2
}

/**
 * 가격 차이를 퍼센트로 계산
 *
 * @param price1 비교 대상 가격
 * @param taxType1 비교 대상 과세 구분
 * @param vatIncluded1 비교 대상 VAT 포함 여부
 * @param basePrice 기준 가격
 * @param baseTaxType 기준 과세 구분
 * @param baseVatIncluded 기준 VAT 포함 여부
 * @returns 가격 차이 퍼센트 (양수면 비쌈, 음수면 저렴)
 *
 * @example
 * // 기준가 10,000원 대비 11,000원은 10% 비쌈
 * getPriceDifferencePercent(11000, 'taxed', true, 10000, 'taxed', true) // 10
 */
export function getPriceDifferencePercent(
  price1: number,
  taxType1: TaxType,
  vatIncluded1: VatIncluded,
  basePrice: number,
  baseTaxType: TaxType,
  baseVatIncluded: VatIncluded
): number {
  const normalized1 = normalizePrice(price1, taxType1, vatIncluded1)
  const normalizedBase = normalizePrice(basePrice, baseTaxType, baseVatIncluded)

  if (normalizedBase === 0) return 0

  return ((normalized1 - normalizedBase) / normalizedBase) * 100
}

/**
 * 가격 정보 포맷팅 (디버깅/표시용)
 *
 * @param price 가격
 * @param taxType 과세 구분
 * @param vatIncluded VAT 포함 여부
 * @returns 포맷된 가격 정보 문자열
 */
export function formatPriceInfo(price: number, taxType: TaxType, vatIncluded: VatIncluded): string {
  const normalized = normalizePrice(price, taxType, vatIncluded)
  const supplyPrice = getSupplyPrice(price, taxType, vatIncluded)
  const vatAmount = getVatAmount(price, taxType, vatIncluded)

  if (taxType === 'tax-free') {
    return `${price.toLocaleString()}원 (면세)`
  }

  if (vatIncluded) {
    return `${price.toLocaleString()}원 (공급가: ${supplyPrice.toLocaleString()}원 + VAT: ${vatAmount.toLocaleString()}원)`
  } else {
    return `${price.toLocaleString()}원 (VAT별도) → ${normalized.toLocaleString()}원 (VAT포함)`
  }
}
