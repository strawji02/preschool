import type { ComparisonItem } from '@/types/audit'

/**
 * 동일 품목 매칭 전파 (2026-07-05)
 *
 * 사용자가 한 품목을 신세계 상품으로 확정하면, **동일한 품목명**을 가진 다른
 * 미확정 품목들에 같은 매칭을 자동 적용·확정해 반복 확정(재작업)을 없앤다.
 *   예) "특등급국산콩콩나물_1kg(500g*2ea)"가 여러 행에 있을 때 하나만 확정하면 나머지도 자동.
 *
 * 안전장치:
 *   - 품목명 **정확 일치**(공백/대소문자 정규화)만 대상 — 오매칭 방지
 *   - 이미 확정된 품목은 건드리지 않음(사용자가 다른 매칭을 골랐을 수 있음)
 *   - (2026-07-16) 비교불가(is_excluded)는 대상에 **포함** — 대개 "매칭 못 찾음"으로
 *     붙은 상태이므로, 동일 품명 쌍둥이가 확정되면 함께 매칭·비교불가 해제한다.
 *     (applyPropagation이 is_excluded=false로 되돌린다)
 */

/** 품목명 정규화 — 앞뒤 공백 제거 + 연속 공백 1칸 + 소문자 */
export function normalizeItemName(s?: string | null): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 유사도 비교용 정규화 — 규격/포장/숫자단위/구분자를 제거해 "품목 본질명"만 남긴다.
 *   "특등급국산콩콩나물_1kg(500g*2ea)" → "특등급국산콩콩나물"
 *   "특등급국산콩나물_500g"            → "특등급국산콩나물"
 */
export function stripSpecName(s?: string | null): string {
  return (s ?? '')
    .replace(/\([^)]*\)/g, ' ') // 괄호 안 (규격/원산지)
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|ml|l|ea|개|입|팩|봉|박스|매|절|호)\b/gi, ' ') // 숫자+단위
    .replace(/[_/*×xX]+/g, ' ') // 구분자
    .replace(/[0-9]+/g, ' ') // 남은 숫자
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Levenshtein 편집거리 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[i], dp[i - 1]) + 1
      prev = tmp
    }
  }
  return dp[m]
}

/** 이름 유사도 (0~1). 규격 제거 후 편집거리 기반. 완전 동일 = 1 */
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const x = stripSpecName(a)
  const y = stripSpecName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const dist = levenshtein(x, y)
  return 1 - dist / Math.max(x.length, y.length)
}

/**
 * 확정된 source의 매칭을 전파할 대상 품목 id 목록을 반환한다.
 * 대상 = source와 품목명이 정확히 같고, 아직 미확정인 품목.
 *   (2026-07-16) 비교불가(is_excluded)도 대상 — 동일 품명이면 함께 매칭·해제한다.
 */
export function findPropagationTargets(items: ComparisonItem[], sourceId: string): string[] {
  const source = items.find((i) => i.id === sourceId)
  if (!source || !source.ssg_match) return []
  const key = normalizeItemName(source.extracted_name)
  if (!key) return []
  return items
    .filter(
      (t) =>
        t.id !== sourceId &&
        t.is_confirmed !== true &&
        normalizeItemName(t.extracted_name) === key,
    )
    .map((t) => t.id)
}

/**
 * source의 신세계 매칭을 targetIds 품목에 복사하고 확정 상태로 만든 새 items 배열을 반환.
 * 규격이 달라도 estimateSsgTotal이 각 품목 수량·규격 기준으로 환산하므로 상품(id·단가)만 복사한다.
 */
export function applyPropagation(
  items: ComparisonItem[],
  sourceId: string,
  targetIds: string[],
): ComparisonItem[] {
  const source = items.find((i) => i.id === sourceId)
  if (!source || !source.ssg_match || targetIds.length === 0) return items
  const targetSet = new Set(targetIds)
  return items.map((item) => {
    if (!targetSet.has(item.id)) return item
    // ssg_match(SupplierMatch)에 id·standard_price·match_score가 모두 포함되어 이것만 복사하면 충분.
    // 규격 차이는 estimateSsgTotal이 각 품목 수량·규격 기준으로 환산한다.
    return {
      ...item,
      ssg_match: source.ssg_match,
      is_confirmed: true,
      ssg_confirmed: true,
      match_status: 'manual_matched' as const,
      is_excluded: false,
    }
  })
}

/* ────────────────────────────────────────────────────────── */
/* 상이 매칭 충돌 감지 (2026-07-05)                              */
/*   동일 품목명인데 서로 다른 신세계 상품으로 확정된 경우를 찾아   */
/*   사용자에게 알리고 하나로 통일(수정 컨펌)할 수 있게 한다.       */
/* ────────────────────────────────────────────────────────── */

export interface MatchConflictOption {
  productId: string
  productName: string
  itemIds: string[]
  count: number
}
export interface MatchConflict {
  nameKey: string // 정규화 품목명 (그룹 키)
  displayName: string // 대표 표시명(원본)
  options: MatchConflictOption[] // count 내림차순
  majorityProductId: string // 다수결 상품(기본 추천)
  totalItems: number
}

/**
 * 동일 품목명인데 확정 매칭 상품이 2개 이상으로 갈린 그룹을 반환한다.
 *   - 확정(is_confirmed) + 매칭(ssg_match) 품목만 대상
 *   - 정규화 품목명으로 그룹 → 상품 id가 여러 개면 충돌
 *   - options는 건수 내림차순, majority = 최다 건수 상품(동수 시 첫 번째)
 */
export function findMatchConflicts(items: ComparisonItem[]): MatchConflict[] {
  const groups = new Map<string, { display: string; byProduct: Map<string, MatchConflictOption> }>()
  for (const it of items) {
    if (it.is_confirmed !== true || !it.ssg_match?.id) continue
    const key = normalizeItemName(it.extracted_name)
    if (!key) continue
    let g = groups.get(key)
    if (!g) {
      g = { display: it.extracted_name, byProduct: new Map() }
      groups.set(key, g)
    }
    const pid = it.ssg_match.id
    let opt = g.byProduct.get(pid)
    if (!opt) {
      opt = { productId: pid, productName: it.ssg_match.product_name ?? '', itemIds: [], count: 0 }
      g.byProduct.set(pid, opt)
    }
    opt.itemIds.push(it.id)
    opt.count += 1
  }

  const conflicts: MatchConflict[] = []
  for (const [key, g] of groups) {
    if (g.byProduct.size < 2) continue // 상품이 하나면 충돌 아님
    const options = [...g.byProduct.values()].sort((a, b) => b.count - a.count)
    conflicts.push({
      nameKey: key,
      displayName: g.display,
      options,
      majorityProductId: options[0].productId,
      totalItems: options.reduce((s, o) => s + o.count, 0),
    })
  }
  // 충돌 심한 순(갈린 상품 수 → 건수)
  return conflicts.sort((a, b) => b.options.length - a.options.length || b.totalItems - a.totalItems)
}

/** 유사 품목 제안 임계값 (규격 제거 후 이름 유사도) */
export const SIMILAR_SUGGEST_THRESHOLD = 0.8

/**
 * 확정된 source와 **유사하지만 정확히 같지는 않은** 미확정·미매칭 품목 id 목록.
 * 이들에는 매칭을 "제안"만 하고 확정은 사용자가 직접 한다(applySuggestions).
 *   - 정확 일치는 제외(그건 applyPropagation이 자동 확정 처리)
 *   - 이미 매칭이 있는 품목도 제외(사용자가 고른 매칭을 덮지 않음)
 */
export function findSimilarSuggestions(
  items: ComparisonItem[],
  sourceId: string,
  threshold: number = SIMILAR_SUGGEST_THRESHOLD,
): string[] {
  const source = items.find((i) => i.id === sourceId)
  if (!source || !source.ssg_match) return []
  const exactKey = normalizeItemName(source.extracted_name)
  return items
    .filter(
      (t) =>
        t.id !== sourceId &&
        t.is_confirmed !== true &&
        t.is_excluded !== true &&
        !t.ssg_match && // 아직 매칭 없는 품목만
        normalizeItemName(t.extracted_name) !== exactKey && // 정확 일치는 propagation 담당
        nameSimilarity(t.extracted_name, source.extracted_name) >= threshold,
    )
    .map((t) => t.id)
}

/**
 * source의 매칭을 target들에 "제안"으로 적용 — ssg_match만 채우고 **미확정 유지**.
 * 사용자가 검토 후 Confirm 버튼을 눌러야 최종 확정된다.
 */
export function applySuggestions(
  items: ComparisonItem[],
  sourceId: string,
  targetIds: string[],
): ComparisonItem[] {
  const source = items.find((i) => i.id === sourceId)
  if (!source || !source.ssg_match || targetIds.length === 0) return items
  const targetSet = new Set(targetIds)
  return items.map((item) => {
    if (!targetSet.has(item.id)) return item
    return {
      ...item,
      ssg_match: source.ssg_match,
      match_status: 'auto_matched' as const, // 매칭됐으나 미확정(사용자 확정 대기)
      // is_confirmed는 그대로 false — 최종 컨펌은 사용자가 누른다
    }
  })
}
