/**
 * 신세계 월별 단가표 — **정산·비교 양쪽이 쓰는 공용 데이터.**
 *
 * 신세계가 매달 10일 전에 보내는 품목 카탈로그다. 26년 6월 7,798개.
 *
 * ```
 * 정산   거래명세표의 원산지를 채운다            docs/systems/settlement/단가표.md §21
 * 비교   세션 기준월의 신세계 단가로 절감액 계산   docs/systems/comparison.md §9
 * ```
 *
 * ★ **`features/shared`에 있는 이유** — CLAUDE.md 모듈 경계 규칙상
 * `features/settlement` ↔ `features/comparison` 직접 import가 금지다.
 * 2026-08-14에 양쪽이 쓰기로 정해져 settlement에서 여기로 옮겼다.
 *
 * ⚠️ **서버 전용이다** (`data.ts`가 service_role을 쓴다). 클라이언트에서
 * import하면 빌드가 실패한다. 화면은 API를 거친다.
 */
export {
  parsePriceBookSheet,
  checkPriceBookPeriod,
  normalizeProductCode,
  type PriceBookItem,
  type PriceBookResult,
  type PeriodCheckResult,
} from './parse'

export {
  PriceBookError,
  savePriceBook,
  loadPriceLookup,
  loadPriceBookPrices,
  listPriceBooks,
  previousPeriod,
  type PriceBookSummary,
  type PriceLookup,
} from './data'
