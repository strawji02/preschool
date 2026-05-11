/**
 * 통화 포맷 유틸리티
 */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ko-KR').format(num)
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}


/**
 * 무게 단위 자동 환산 표시 (2026-05-11)
 * - 1000g 이상 → kg (소수 3자리, trailing zero 제거)
 * - 1000g 미만 → g (정수)
 *
 * 예:
 *   formatWeight(16506)  → "16.506kg"
 *   formatWeight(1000)   → "1kg"
 *   formatWeight(1800)   → "1.8kg"
 *   formatWeight(800)    → "800g"
 *   formatWeight(0)      → "0g"
 */
export function formatWeight(g: number | null | undefined): string {
  if (g == null || !Number.isFinite(g)) return '-'
  const abs = Math.abs(g)
  if (abs >= 1000) {
    // 1.5kg, 16.506kg, 1kg 등 — trailing zero 제거
    const kg = g / 1000
    const formatted = kg.toFixed(3).replace(/\.?0+$/, '')
    return `${formatted}kg`
  }
  return `${Math.round(g)}g`
}

/**
 * 부피 단위 자동 환산 표시 (2026-05-11)
 * - 1000ml 이상 → L
 * - 1000ml 미만 → ml
 *
 * 예:
 *   formatVolume(18000) → "18L"
 *   formatVolume(1800)  → "1.8L"
 *   formatVolume(500)   → "500ml"
 */
export function formatVolume(ml: number | null | undefined): string {
  if (ml == null || !Number.isFinite(ml)) return '-'
  const abs = Math.abs(ml)
  if (abs >= 1000) {
    const l = ml / 1000
    const formatted = l.toFixed(3).replace(/\.?0+$/, '')
    return `${formatted}L`
  }
  return `${Math.round(ml)}ml`
}
