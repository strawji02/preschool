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
 *
 * 전략 (2026-05-04 개정):
 *  1) "X g/<단위suffix>" 패턴(예: "500g/EA", "1kg/팩")이 있으면 우선 — 단위당 무게 명시
 *  2) 그 외에는 모든 무게/부피 매치 중 최대값 선택
 *     이유: spec에 여러 무게가 있을 때 단위당 무게(EA/팩/봉당)가 통상 가장 큼.
 *     예: "15~20g/개 500g/EA" → 조각=20g, EA=500g → 단위중량은 500g
 *
 * 예시:
 *  "400g/봉"             → 400
 *  "1kg/EA"              → 1000
 *  "5KG"                 → 5000
 *  "15~20g/개 500g/EA"   → 500   (이전: 20)
 *  "1KG, 1.5CM 슬라이스" → 1000
 */
export function parseSpecToGrams(spec: string | undefined | null): number | null {
  if (!spec) return null
  const text = spec.toLowerCase()

  // 모든 무게/부피 매치를 모아 최대값 선택.
  // 이유: spec에 여러 무게가 있을 때 단위당 무게(EA/팩/봉당)가 통상 가장 큼.
  //       예: "15~20g/개 500g/EA" → 조각=20g, EA=500g → 단위중량 500g 채택
  const candidates: number[] = []
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*kg/gi)) {
    candidates.push(Math.round(parseFloat(m[1]) * 1000))
  }
  // l 단독 (kg/ml 제외) — \d 직후 l, l 뒤에 영문 없음
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*l(?![a-z])/gi)) {
    candidates.push(Math.round(parseFloat(m[1]) * 1000))
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*ml/gi)) {
    candidates.push(parseFloat(m[1]))
  }
  // g 단독 (kg/mg 등 제외) — \d 앞에 알파벳 없음, g 뒤에 영문 없음
  for (const m of text.matchAll(/(?<![a-z])(\d+(?:\.\d+)?)\s*g(?![a-z])/gi)) {
    candidates.push(parseFloat(m[1]))
  }

  if (candidates.length === 0) return null
  return Math.max(...candidates)
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
