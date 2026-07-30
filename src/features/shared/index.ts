/**
 * features/shared — 정산·비교 양쪽이 함께 쓰는 도메인.
 *
 * CLAUDE.md 규칙: features/settlement ↔ features/comparison 직접 import 금지.
 * 공유가 필요하면 여기 또는 lib을 경유한다.
 */
export * from './auth'

// 시스템별 배포 버전 (docs §16)
export {
  SETTLEMENT_VERSION,
  COMPARISON_VERSION,
  type SystemVersion,
} from './version'
