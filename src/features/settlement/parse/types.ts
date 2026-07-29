/**
 * 원천 데이터 정규화 타입 (docs/systems/settlement.md §5)
 *
 * 신세계는 **품목 단위**, CJ는 **사업장×식당 집계 단위**로 레벨이 다르다.
 * 공통 정규화 지점은 **사업장×식당×과세구분**이고, 아래 형태로 통일한다.
 */

/** 원천 구분. 두 원천의 사업장코드 체계가 달라서 매핑 키에 반드시 포함해야 한다. */
export type SettlementSource = 'shinsegae' | 'cj'

/** 과세/면세 분해. 정산 산식의 `costTotal`/`costVat` 입력이 여기서 나온다. */
export interface TaxBreakdown {
  /** 과세 공급가 */
  taxableSupply: number
  /** 과세 부가세 */
  vat: number
  /** 면세 금액 */
  exempt: number
  /** 합계 = 과세공급가 + 부가세 + 면세 */
  total: number
}

/** 정규화 단위 — 사업장(유치원) × 식당 */
export interface NormalizedVenue {
  source: SettlementSource
  businessCode: string
  businessName: string
  restaurantCode: string
  restaurantName: string
  /** 원가(매입) — 신세계 '납품', CJ '원가' */
  cost: TaxBreakdown
  /** 단가(유치원 청구) — 신세계 '가맹점', CJ '단가' */
  price: TaxBreakdown
}

export interface ParseResult {
  venues: NormalizedVenue[]
  /** 사람이 확인해야 하는 이상 징후. 비어 있어야 정상. */
  warnings: string[]
}

/**
 * 매핑 키 — `"<원천>:<사업장코드>"`.
 *
 * 신세계 `88689`와 CJ `1008`처럼 코드 체계가 완전히 다르므로 원천을 접두로 붙인다.
 * (2026-07-29 실측: 두 원천의 담당 유치원은 겹치지 않는다)
 */
export type VenueMappingKey = `${SettlementSource}:${string}`

/**
 * 사업장 → 영업자 매핑. docs §10의 "매핑 키 = 사업장 코드"를 원천별로 확장한 형태.
 *
 * 값의 의미를 셋으로 구분한다 — **누락과 의도적 제외를 섞으면 마감 검증이 무의미해진다**:
 * - `'김영수'` 등 영업자 ID → 그 영업자에게 집계
 * - `null` → **의도적 정산 제외** (예: `키즈웰에듀푸드(본사)`). 경고하지 않는다.
 * - 키 자체가 없거나 빈 문자열 → **매핑 누락**. 경고하고 마감을 막는다.
 */
export type PartnerMapping = Record<string, string | null>

export function venueMappingKey(
  source: SettlementSource,
  businessCode: string
): VenueMappingKey {
  return `${source}:${businessCode}`
}

/** 영업자별 집계 결과. 그대로 `calcSettlement` 입력으로 쓸 수 있다. */
export interface PartnerTotals {
  partnerId: string
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
  /** 근거가 되는 사업장×식당 목록 — 내역서 출력·검증에 쓴다 */
  venues: NormalizedVenue[]
}

export interface AggregateResult {
  partners: PartnerTotals[]
  /** 담당 영업자를 못 찾은 사업장. 하나라도 있으면 월 마감을 막아야 한다 (docs §8). */
  unmapped: NormalizedVenue[]
  /** 의도적으로 정산에서 뺀 사업장 (매핑값 `null`). 정상 상태이므로 경고하지 않는다. */
  excluded: NormalizedVenue[]
  warnings: string[]
}
