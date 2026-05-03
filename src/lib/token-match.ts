/**
 * 토큰 기반 매칭 신뢰도 계산 (2026-05-04)
 *
 * 한국어 검색어와 후보 제품명의 의미적 유사도 측정.
 * hybrid_search 점수가 변별력 부족 (0.005~0.05 범위)할 때 보조 신호로 사용.
 *
 * 사용처:
 *  - 백엔드: matching.ts (저장 시 검증), sessions/[id] (복원 시 검증), rematch (재매칭 대상 선별)
 *  - 프론트: PrecisionMatchingView (UI 신뢰도 표시 + 정렬)
 */

/** 한국어 어절 단순 분리 (2자 이상 토큰만) */
export function tokenize(text: string | undefined | null): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .split(/[\s,./()※*+|·#\-\[\]]+/)
    .filter((t) => t.length >= 2)
}

/**
 * 토큰 매칭 비율 (0~1.5)
 *  - 1.5: query가 product에 substring으로 완전 포함 (확실)
 *  - 0.7+: 토큰 70%+ 일치 (강함)
 *  - 0.4+: 토큰 40~70% 일치 (보통)
 *  - 0.0+: 1개 토큰 일치 또는 prefix 부분 매칭 (약함)
 *  - 0.0:  토큰 매칭 없음 (참고)
 */
export function getTokenMatchRatio(
  query: string | undefined | null,
  productName: string | undefined | null,
): number {
  const q = (query ?? '').toLowerCase().replace(/\s+/g, '')
  const n = (productName ?? '').toLowerCase().replace(/\s+/g, '')

  // Full substring match → 확실
  if (q.length >= 2 && (n.includes(q) || q.includes(n))) return 1.5

  // 토큰 매칭 + 한국어 합성어 prefix 부분 매칭
  const queryTokens = tokenize(query)
  const productSet = new Set(tokenize(productName))
  let matched = 0
  for (const t of queryTokens) {
    if (productSet.has(t)) {
      matched += 1
      continue
    }
    // 4자 이상 토큰: prefix 2~4자가 product에 substring 포함되면 부분 매칭 (0.5점)
    // 예: "얼갈이배추" → prefix "얼갈이"가 "얼갈이 국내산"에 포함 → 0.5
    if (t.length >= 4) {
      for (let len = Math.min(t.length, 4); len >= 2; len--) {
        const sub = t.slice(0, len)
        if (sub.length >= 2 && n.includes(sub)) {
          matched += 0.5
          break
        }
      }
    }
  }
  return queryTokens.length > 0 ? matched / queryTokens.length : 0
}

/**
 * 신뢰도 라벨 + 색상 (UI용)
 */
export interface MatchConfidence {
  label: string
  bgColor: string
  textColor: string
  matchRatio: number
  fullContains: boolean
}

export function getMatchConfidence(
  query: string | undefined | null,
  productName: string | undefined | null,
): MatchConfidence {
  const ratio = getTokenMatchRatio(query, productName)
  const fullContains = ratio >= 1.5

  if (fullContains) {
    return { label: '확실', bgColor: 'bg-emerald-200', textColor: 'text-emerald-900', matchRatio: ratio, fullContains: true }
  }
  if (ratio >= 0.7) return { label: '강함', bgColor: 'bg-green-100', textColor: 'text-green-700', matchRatio: ratio, fullContains: false }
  if (ratio >= 0.4) return { label: '보통', bgColor: 'bg-blue-100', textColor: 'text-blue-700', matchRatio: ratio, fullContains: false }
  if (ratio > 0)    return { label: '약함', bgColor: 'bg-amber-100', textColor: 'text-amber-700', matchRatio: ratio, fullContains: false }
  return { label: '참고', bgColor: 'bg-gray-100', textColor: 'text-gray-500', matchRatio: 0, fullContains: false }
}

/**
 * 매칭 저장/유효성 임계값.
 * 토큰 매칭 비율이 이 값 미만이면 의미있는 매칭으로 취급하지 않음 (matched_product_id = NULL).
 */
export const MIN_VALID_MATCH_RATIO = 0.3

/**
 * 텍스트 내 공통 토큰 추출 (highlight용)
 */
export function getCommonTokens(...texts: (string | undefined | null)[]): Set<string> {
  const allSets = texts.filter(Boolean).map((t) => new Set(tokenize(t)))
  if (allSets.length < 2) return new Set()
  const [first, ...rest] = allSets
  const common = new Set<string>()
  for (const tok of first) {
    if (rest.every((s) => s.has(tok))) common.add(tok)
  }
  return common
}
