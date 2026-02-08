/**
 * 단위 환산 유틸리티
 */

export type NormalizedUnit = 'g' | 'kg' | 'ml' | 'L' | 'EA'
export type UnitCategory = 'weight' | 'volume' | 'count' | 'unknown'

/**
 * 단위의 카테고리를 반환
 */
export function getUnitCategory(unit: string): UnitCategory {
  const normalizedUnit = unit.toLowerCase()

  // 무게 단위
  if (normalizedUnit === 'g' || normalizedUnit === 'kg') {
    return 'weight'
  }

  // 부피 단위
  if (normalizedUnit === 'ml' || normalizedUnit === 'l') {
    return 'volume'
  }

  // 개수 단위
  if (normalizedUnit === 'ea' || normalizedUnit === '개') {
    return 'count'
  }

  // 알 수 없는 단위 (BAG, BOX, 등)
  return 'unknown'
}

/**
 * 단위를 그램(g) 또는 밀리리터(ml) 기준으로 변환
 */
export function convertToBaseUnit(quantity: number, unit: string): number {
  const normalizedUnit = unit.toLowerCase()

  // 무게 단위
  if (normalizedUnit === 'kg') {
    return quantity * 1000 // kg → g
  }
  if (normalizedUnit === 'g') {
    return quantity
  }

  // 부피 단위
  if (normalizedUnit === 'l') {
    return quantity * 1000 // L → ml
  }
  if (normalizedUnit === 'ml') {
    return quantity
  }

  // 개수 단위
  if (normalizedUnit === 'ea' || normalizedUnit === '개') {
    return quantity
  }

  // 알 수 없는 단위는 그대로 반환
  return quantity
}

/**
 * 단위 문자열 파싱 (예: "1kg", "500g", "2개")
 */
export function parseUnitString(unitStr: string): { quantity: number; unit: string } | null {
  const match = unitStr.match(/^([\d.]+)\s*([a-zA-Z가-힣]+)$/)
  if (!match) {
    return null
  }

  const quantity = parseFloat(match[1])
  const unit = match[2]

  return { quantity, unit }
}

/**
 * 가격을 특정 단위로 환산
 *
 * @param price 원래 가격
 * @param fromUnit 원래 단위 (예: "1kg")
 * @param toUnit 변환할 단위 (예: "g")
 * @param toQuantity 변환할 수량 (예: 500)
 * @returns 환산된 가격 (환산 불가능한 경우 null)
 */
export function convertPrice(
  price: number,
  fromUnit: string,
  toUnit: NormalizedUnit,
  toQuantity: number
): number | null {
  // fromUnit 파싱 (예: "1kg" → { quantity: 1, unit: "kg" })
  const parsed = parseUnitString(fromUnit)
  if (!parsed) {
    // 파싱 실패 시 환산 불가
    return null
  }

  const { quantity: fromQuantity, unit: fromUnitType } = parsed

  // 단위 카테고리 확인
  const fromCategory = getUnitCategory(fromUnitType)
  const toCategory = getUnitCategory(toUnit)

  // unknown 카테고리이거나 카테고리가 다르면 환산 불가
  if (fromCategory === 'unknown' || toCategory === 'unknown' || fromCategory !== toCategory) {
    return null
  }

  // 두 단위를 기본 단위로 변환
  const fromBase = convertToBaseUnit(fromQuantity, fromUnitType)
  const toBase = convertToBaseUnit(toQuantity, toUnit)

  // 단위당 가격 계산
  const pricePerBaseUnit = price / fromBase

  // 변환된 수량에 대한 가격
  return pricePerBaseUnit * toBase
}

/**
 * 단위가 호환되는지 확인 (무게는 무게끼리, 부피는 부피끼리)
 */
export function areUnitsCompatible(unit1: string, unit2: string): boolean {
  const weightUnits = ['g', 'kg']
  const volumeUnits = ['ml', 'l']
  const countUnits = ['ea', '개']

  const normalized1 = unit1.toLowerCase()
  const normalized2 = unit2.toLowerCase()

  const isWeight1 = weightUnits.includes(normalized1)
  const isWeight2 = weightUnits.includes(normalized2)
  const isVolume1 = volumeUnits.includes(normalized1)
  const isVolume2 = volumeUnits.includes(normalized2)
  const isCount1 = countUnits.includes(normalized1)
  const isCount2 = countUnits.includes(normalized2)

  return (
    (isWeight1 && isWeight2) ||
    (isVolume1 && isVolume2) ||
    (isCount1 && isCount2)
  )
}
