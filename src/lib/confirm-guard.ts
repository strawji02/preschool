/**
 * 확정 가드 (A안, 2026-07-23)
 *
 * 문제: 매칭이 없는 품목도 Enter(=확정)로 is_confirmed=true가 되어(초록 체크),
 *   최종 리포트의 비교 대상에 0 절감으로 편입되어 절감률을 희석했다.
 *
 * 원칙: "확정은 매칭이 있어야만 가능."
 *   - supplier 'SHINSEGAE' → ssg_match 필요
 *   - supplier 'CJ'        → cj_match 필요
 *   - supplier 미지정      → 둘 중 하나라도 매칭 필요
 *
 * 다양한 거래명세표가 계속 들어와도 규격/형식과 무관하게 "매칭 존재"만으로 판정하므로
 * 포맷 변화에 영향받지 않는다.
 */
import type { ComparisonItem, Supplier } from '@/types/audit'

export function canConfirmItem(item: ComparisonItem, supplier?: Supplier): boolean {
  if (supplier === 'CJ') return !!item.cj_match
  if (supplier === 'SHINSEGAE') return !!item.ssg_match
  return !!(item.cj_match || item.ssg_match)
}

/**
 * 세션 로드 시 자가치유 — 과거에 매칭 없이 확정된(비제외) 품목을 미확정으로 되돌린다.
 *   - 비교불가(is_excluded)로 처리된 품목은 정당한 "검토 완료"이므로 건드리지 않는다.
 *   - 매칭이 하나라도 있으면 유지.
 * 멱등: 매 로드마다 안전하게 반복 적용 가능.
 */
export function healConfirmedWithoutMatch(items: ComparisonItem[]): ComparisonItem[] {
  return items.map((it) =>
    it.is_confirmed && !it.is_excluded && !canConfirmItem(it)
      ? { ...it, is_confirmed: false, ssg_confirmed: false, cj_confirmed: false }
      : it,
  )
}
