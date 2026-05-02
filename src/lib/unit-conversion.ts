/**
 * 단위 환산 유틸 — 정밀 검수 (PrecisionView)에서 1kg당 단가로 비교 (2026-05-04)
 *
 * 시나리오:
 *  - 기존 업체: "400G/봉, 120봉, ₩9,544/kg, 총 ₩458,112"
 *  - 신세계:    "220G/BAG, 100EA, 환산 단가 ₩8,720/kg, 총 ₩436,000"
 *  - 절감:      ₩22,112 (4.8%)
 *
 * 기준 단위: 그램(g)
 *  - kg → g 변환: × 1000
 *  - 1kg당 단가: 봉당가격 / 봉당그램 × 1000  또는  ppu × 1000 (ppu가 원/g인 경우)
 */

/**
 * spec 문자열에서 단위 중량(g)을 추출.
 * 예: "400g/봉" → 400, "1kg/EA" → 1000, "5KG" → 5000, "100G" → 100
 * 추출 불가 시 null 반환.
 */
export function parseSpecToGrams(spec: string | undefined | null): number | null {
  if (!spec) return null
  const text = spec.toLowerCase()

  // KG 매칭 (kg, Kg, KG)
  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*kg/i)
  if (kgMatch) return Math.round(parseFloat(kgMatch[1]) * 1000)

  // G 매칭 (g, G — 단 'kg' 매칭은 위에서 처리됨)
  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  if (gMatch) return parseFloat(gMatch[1])

  // ML/L (액체) — 1ml = 1g 가정 (식자재 대부분 정확)
  const lMatch = text.match(/(\d+(?:\.\d+)?)\s*l(?![a-z])/i)
  if (lMatch) return Math.round(parseFloat(lMatch[1]) * 1000)
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml/i)
  if (mlMatch) return parseFloat(mlMatch[1])

  return null
}

/**
 * 1kg당 단가 (₩/kg) — 정밀 비교용 표준 지표
 * @param totalPrice 총 가격 (예: 한 봉 가격)
 * @param weightGrams 그 가격에 해당하는 중량 (g)
 */
export function pricePerKg(totalPrice: number, weightGrams: number): number {
  if (!weightGrams || weightGrams <= 0) return 0
  return Math.round((totalPrice / weightGrams) * 1000)
}

/**
 * 1g당 단가 (₩/g) — products.ppu와 동일 단위
 */
export function pricePerGram(totalPrice: number, weightGrams: number): number {
  if (!weightGrams || weightGrams <= 0) return 0
  return totalPrice / weightGrams
}

/**
 * 신세계 제품 정보로 환산 단가 계산
 *  - products.ppu가 원/g 단위인 경우: ppu × 1000 = 1kg당 단가
 *  - spec_quantity + spec_unit으로 직접 계산도 가능
 */
export function computeShinsegaePerKg(
  standardPrice: number,
  spec: { quantity: number | null | undefined; unit: string | null | undefined } | null,
  ppu?: number | null,
): number | null {
  // ppu가 있으면 우선 사용 (단위가 g인 경우 × 1000)
  if (ppu != null && ppu > 0) {
    // ppu 단위 추정: standard_unit이 g면 원/g, ea면 원/ea
    // 실용 처리: ppu가 작은 값(< 1000)이면 원/g, 큰 값이면 원/ea로 추정
    if (ppu < 1000) {
      return Math.round(ppu * 1000)
    }
  }
  // spec_quantity + spec_unit으로 계산
  if (spec?.quantity && spec.unit) {
    const qty = spec.quantity
    const unit = spec.unit.toUpperCase()
    if (unit === 'KG') return Math.round(standardPrice / qty)
    if (unit === 'G') return Math.round((standardPrice / qty) * 1000)
    if (unit === 'L') return Math.round(standardPrice / qty)
    if (unit === 'ML') return Math.round((standardPrice / qty) * 1000)
  }
  return null
}

/**
 * 절감액 + 절감률 계산
 */
export function computeSavings(originalTotal: number, newTotal: number): {
  amount: number
  percent: number
  isSaving: boolean
} {
  const amount = originalTotal - newTotal
  const percent = originalTotal > 0 ? (amount / originalTotal) * 100 : 0
  return {
    amount,
    percent,
    isSaving: amount > 0,
  }
}
