/**
 * calc-food 기능별 설정 플래그 (2026-04-21)
 *
 * Susan 요청 반영:
 * - CJ 비교는 현재 사용하지 않음 → SHOW_CJ=false로 UI 전체에서 숨김
 *   매칭 API와 DB 저장은 유지 (장기적으로 다시 켤 수 있도록)
 */

export const FEATURE_FLAGS = {
  SHOW_CJ: false,          // CJ 공급사 컬럼/카드/탭 표시 여부
  SHOW_SHINSEGAE: true,    // 신세계 공급사 표시
} as const

export function shouldShowSupplier(supplier: 'CJ' | 'SHINSEGAE'): boolean {
  if (supplier === 'CJ') return FEATURE_FLAGS.SHOW_CJ
  if (supplier === 'SHINSEGAE') return FEATURE_FLAGS.SHOW_SHINSEGAE
  return false
}

export function getActiveSuppliers(): Array<'CJ' | 'SHINSEGAE'> {
  const active: Array<'CJ' | 'SHINSEGAE'> = []
  if (FEATURE_FLAGS.SHOW_CJ) active.push('CJ')
  if (FEATURE_FLAGS.SHOW_SHINSEGAE) active.push('SHINSEGAE')
  return active
}
