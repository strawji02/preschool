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
 *   - 비교불가(is_excluded)로 명시 제외한 품목도 건드리지 않음
 */

/** 품목명 정규화 — 앞뒤 공백 제거 + 연속 공백 1칸 + 소문자 */
export function normalizeItemName(s?: string | null): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 확정된 source의 매칭을 전파할 대상 품목 id 목록을 반환한다.
 * 대상 = source와 품목명이 정확히 같고, 아직 미확정이며 비교불가가 아닌 품목.
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
        t.is_excluded !== true &&
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
