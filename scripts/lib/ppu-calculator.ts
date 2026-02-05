/**
 * PPU (Price Per Unit) Calculator
 * Calculates standardized price per unit (g, ml, or ea)
 */

export interface PPUResult {
  standardUnit: 'g' | 'ml' | 'ea'
  ppu: number | null
  capacity: number | null // standardized capacity in g/ml/ea
}

/**
 * Convert capacity to standardized units
 * - Weight: kg → g, g → g
 * - Volume: L → ml, ml → ml
 * - Count: ea → ea
 */
function standardizeCapacity(quantity: number, unit: string): PPUResult {
  const unitUpper = unit.toUpperCase()

  // Weight units → grams
  if (unitUpper === 'KG') {
    return {
      standardUnit: 'g',
      ppu: null,
      capacity: quantity * 1000,
    }
  }
  if (unitUpper === 'G') {
    return {
      standardUnit: 'g',
      ppu: null,
      capacity: quantity,
    }
  }

  // Volume units → milliliters
  if (unitUpper === 'L') {
    return {
      standardUnit: 'ml',
      ppu: null,
      capacity: quantity * 1000,
    }
  }
  if (unitUpper === 'ML') {
    return {
      standardUnit: 'ml',
      ppu: null,
      capacity: quantity,
    }
  }

  // Count units → each
  if (unitUpper === 'EA' || unitUpper === '개' || unitUpper === '입' || unitUpper === '마리') {
    return {
      standardUnit: 'ea',
      ppu: null,
      capacity: quantity,
    }
  }

  // Unknown unit → treat as ea
  return {
    standardUnit: 'ea',
    ppu: null,
    capacity: 1,
  }
}

/**
 * Calculate PPU from parsed spec
 * @param price - Total price
 * @param specQuantity - Parsed quantity from spec
 * @param specUnit - Parsed unit from spec
 * @returns PPU result with standardized unit and price per unit
 */
export function calculatePPUFromSpec(
  price: number,
  specQuantity: number | null,
  specUnit: string | null
): PPUResult {
  // If spec parsing failed or invalid data
  if (!specQuantity || !specUnit || specQuantity <= 0 || price <= 0) {
    return {
      standardUnit: 'ea',
      ppu: price, // Treat as price per ea
      capacity: 1,
    }
  }

  // Standardize the capacity
  const standardized = standardizeCapacity(specQuantity, specUnit)

  // Calculate PPU: price / standardized capacity
  if (standardized.capacity && standardized.capacity > 0) {
    standardized.ppu = price / standardized.capacity
  }

  return standardized
}

/**
 * Calculate PPU for CJ products
 * Priority: Use existing "단가(g당)" column if valid (>0), otherwise calculate from spec
 *
 * @param price - Product price
 * @param pricePerGram - Existing "단가(g당)" value from Excel
 * @param specQuantity - Parsed spec quantity
 * @param specUnit - Parsed spec unit
 */
export function calculateCJPPU(
  price: number,
  pricePerGram: number | null,
  specQuantity: number | null,
  specUnit: string | null
): PPUResult {
  // Priority 1: Use existing "단가(g당)" if valid and > 0
  if (pricePerGram && pricePerGram > 0) {
    // The column is already per gram, so use it directly
    return {
      standardUnit: 'g',
      ppu: pricePerGram,
      capacity: price / pricePerGram, // Reverse calculate capacity
    }
  }

  // Priority 2: Calculate from parsed spec
  return calculatePPUFromSpec(price, specQuantity, specUnit)
}

/**
 * Calculate PPU for Shinsegae products
 * Always calculate from parsed spec (no pre-existing price per gram column)
 *
 * @param price - Product price
 * @param specQuantity - Parsed spec quantity
 * @param specUnit - Parsed spec unit
 */
export function calculateShinsegaePPU(
  price: number,
  specQuantity: number | null,
  specUnit: string | null
): PPUResult {
  // Always calculate from spec for Shinsegae
  return calculatePPUFromSpec(price, specQuantity, specUnit)
}
