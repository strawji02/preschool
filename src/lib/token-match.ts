import { expandWithSynonyms } from '@/lib/synonyms'

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

  // 토큰 매칭: query 토큰 또는 그 동의어가 product 텍스트에 substring으로 포함되는지
  // 예: "소앞다리" 토큰의 동의어 "부채살" → "부채살 호주 냉동" 매칭 ✅
  const queryTokens = tokenize(query)
  let matched = 0
  for (const t of queryTokens) {
    if (n.includes(t)) {
      matched += 1
      continue
    }
    // 동의어 확장 매칭 (예: 소앞다리 → 부채살, 소부채살, 우부채살)
    let synMatched = false
    const syns = expandWithSynonyms(t)
    for (const s of syns) {
      const sLower = s.toLowerCase()
      if (sLower.length >= 2 && sLower !== t && n.includes(sLower)) {
        synMatched = true
        break
      }
    }
    if (synMatched) {
      matched += 1
      continue
    }
    // 4자 이상 토큰: prefix 2~4자가 product에 substring으로 포함되면 부분 매칭 (0.5점)
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


/* ────────────────────────────────────────────────────────── */
/* 원산지 정규화 + 매칭 (백엔드/프론트 공통)                      */
/* ────────────────────────────────────────────────────────── */

/**
 * 원산지 정규화 — origin 컬럼 값 또는 텍스트 (extracted_name/extracted_spec/product_name)에서 ISO 풍 코드 추출.
 * "국내산" / "국내제조" / "한국" → KR
 * "중국" → CN
 * 등 16종 + UNKNOWN
 */
export function normalizeOrigin(text: string | undefined | null): string {
  if (!text) return 'UNKNOWN'
  const t = text.toLowerCase()
  if (/국내산|한국산|국산|한국|국내제조/.test(t)) return 'KR'
  if (/중국/.test(t)) return 'CN'
  if (/미국|usa/.test(t)) return 'US'
  if (/호주|aus/.test(t)) return 'AU'
  if (/일본|일산/.test(t)) return 'JP'
  if (/러시아|러산/.test(t)) return 'RU'
  if (/eu|유럽|네덜란드|독일|프랑스|스페인|이태리|이탈리아|벨기에/.test(t)) return 'EU'
  if (/베트남/.test(t)) return 'VN'
  if (/태국/.test(t)) return 'TH'
  if (/캐나다/.test(t)) return 'CA'
  if (/말레이시아/.test(t)) return 'MY'
  if (/페루/.test(t)) return 'PE'
  if (/칠레/.test(t)) return 'CL'
  if (/외국산|수입/.test(t)) return 'IMPORT'
  return 'UNKNOWN'
}

/**
 * 원산지 매칭 점수 (정렬 가중치용)
 *  - 1.0: 완전 일치 (KR == KR)
 *  - 0.5: 한쪽이 미상 (정보 부족, 중립)
 *  - 0.0: 불일치 (KR vs CN)
 */
export function originMatchScore(itemOrigin: string | undefined | null, candOrigin: string | undefined | null): number {
  const a = normalizeOrigin(itemOrigin)
  const b = normalizeOrigin(candOrigin)
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 0.5
  return a === b ? 1.0 : 0.0
}
