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

  // 2-tier 전략 (2026-05-04 개정):
  //  Tier 1: 단위 suffix("/EA", "/개", "/팩", "/봉", "/박스" 등)가 명시된 무게 패턴 우선
  //          예: "1Kg/EA, ... (4KG)" → "1Kg/EA"만 채택 → 1000g
  //              "(4KG)"는 이력번호/박스 메타이지 단위중량 아님
  //  Tier 2: Tier 1이 없으면 모든 무게 매치 중 최대값 선택
  //          예: "5KG" → 5000g, "22G*16/352G" → max(22,352)=352g
  //  근거: 명시적 "/EA" "/팩" suffix가 있으면 그게 단위당 무게라는 확증.
  //        없으면 전체 spec에서 가장 큰 무게 = 단위 무게로 가정 (대부분 정답).
  const SUFFIX = '(?:ea|개|입|매|팩|pac|pack|봉|봉지|봉투|박스|box|상자)'
  const tier1: number[] = []
  const perUnitRe = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(kg|g|l|ml)(?![a-z])\\s*\\/\\s*${SUFFIX}`,
    'gi',
  )
  for (const m of text.matchAll(perUnitRe)) {
    const qty = parseFloat(m[1])
    const u = m[2].toLowerCase()
    if (u === 'kg') tier1.push(Math.round(qty * 1000))
    else if (u === 'g') tier1.push(Math.round(qty))
    else if (u === 'l') tier1.push(Math.round(qty * 1000))
    else if (u === 'ml') tier1.push(Math.round(qty))
  }
  if (tier1.length > 0) return Math.max(...tier1)

  // Tier 2: 모든 무게/부피 매치 → 최대값
  const tier2: number[] = []
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*kg/gi)) {
    tier2.push(Math.round(parseFloat(m[1]) * 1000))
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*l(?![a-z])/gi)) {
    tier2.push(Math.round(parseFloat(m[1]) * 1000))
  }
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*ml/gi)) {
    tier2.push(parseFloat(m[1]))
  }
  for (const m of text.matchAll(/(?<![a-z])(\d+(?:\.\d+)?)\s*g(?![a-z])/gi)) {
    tier2.push(parseFloat(m[1]))
  }

  if (tier2.length === 0) return null
  return Math.max(...tier2)
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

/**
 * 매칭된 신세계 항목의 정밀 환산 견적 (₩).
 *
 * 우선순위:
 *  1) ppk × adjusted_unit_weight_g × adjusted_qty (사용자 조정값 우선)
 *  2) ppk × spec_quantity*spec_unit→g × adjusted_qty (DB 단위중량)
 *  3) standard_price × adjusted_qty (정밀 환산 불가)
 *
 * 정밀 환산이 필요한 이유:
 *  - 사용자 발주: 1KG → 신세계 5KG짜리 매칭의 경우
 *  - 단순 (standard_price × qty)는 5KG 한 봉 가격이지만
 *  - 정밀: ppk 환산해서 1KG어치 가격 (5배 차이)
 *
 * 매칭 화면 KPI / 리포트 / 엑셀 다운로드 통일 (2026-05-04).
 */
export function estimateSsgTotal(item: {
  ssg_match?: {
    standard_price?: number
    spec_quantity?: number | null
    spec_unit?: string | null
    ppu?: number | null
  } | null
  extracted_quantity: number
  adjusted_quantity?: number
  adjusted_unit_weight_g?: number
}): number {
  const m = item.ssg_match
  if (!m) return 0
  const ppk = computeShinsegaePerKg(
    m.standard_price ?? 0,
    { quantity: m.spec_quantity ?? null, unit: m.spec_unit ?? null },
    m.ppu ?? null,
  )
  const qty = item.adjusted_quantity ?? item.extracted_quantity
  if (ppk && item.adjusted_unit_weight_g) {
    return Math.round((ppk / 1000) * item.adjusted_unit_weight_g) * qty
  }
  if (ppk && m.spec_quantity && m.spec_unit) {
    const u = m.spec_unit.toUpperCase()
    let g = 0
    if (u === 'KG') g = m.spec_quantity * 1000
    else if (u === 'G') g = m.spec_quantity
    else if (u === 'L') g = m.spec_quantity * 1000
    else if (u === 'ML') g = m.spec_quantity
    if (g > 0) return Math.round((ppk / 1000) * g) * qty
  }
  return (m.standard_price ?? 0) * qty
}
