import {
  venueMappingKey,
  type AggregateResult,
  type NormalizedVenue,
  type PartnerMapping,
  type PartnerTotals,
} from './types'

/**
 * 사업장×식당 → **영업자별 합계**로 집계한다 (docs §3 "집계 단위: 영업자 → 유치원×식당").
 *
 * 결과는 그대로 `calcSettlement` 입력이 된다.
 *
 * 매핑 누락은 조용히 넘기지 않는다 — 사업장 하나가 빠지면 그 영업자의 정산액이
 * 그만큼 적게 나오고, 합계만 봐서는 알아채기 어렵다. docs §8의 "마감 전 검증:
 * 매핑 누락 없음"이 바로 이것이므로 `unmapped`가 비어 있지 않으면 마감을 막아야 한다.
 */
export function aggregateByPartner(
  venues: readonly NormalizedVenue[],
  mapping: PartnerMapping
): AggregateResult {
  const warnings: string[] = []
  const unmapped: NormalizedVenue[] = []
  const excluded: NormalizedVenue[] = []
  const byPartner = new Map<string, PartnerTotals>()

  for (const venue of venues) {
    const key = venueMappingKey(venue.source, venue.businessCode)
    const partnerId = mapping[key]

    // `null` = 의도적 제외(본사 등). `undefined`/`''` = 누락. 반드시 구분한다.
    if (partnerId === null) {
      excluded.push(venue)
      continue
    }
    if (!partnerId) {
      unmapped.push(venue)
      continue
    }

    let totals = byPartner.get(partnerId)
    if (!totals) {
      totals = {
        partnerId,
        costTotal: 0,
        costVat: 0,
        priceTotal: 0,
        priceVat: 0,
        venues: [],
      }
      byPartner.set(partnerId, totals)
    }

    totals.costTotal += venue.cost.total
    totals.costVat += venue.cost.vat
    totals.priceTotal += venue.price.total
    totals.priceVat += venue.price.vat
    totals.venues.push(venue)
  }

  if (unmapped.length > 0) {
    const list = unmapped
      .map((v) => `${v.source}:${v.businessCode}(${v.businessName || '이름없음'})`)
      .join(', ')
    warnings.push(
      `담당 영업자 매핑이 없는 사업장 ${unmapped.length}건 — 마감 전에 해결해야 함: ${list}`
    )
  }

  return { partners: [...byPartner.values()], unmapped, excluded, warnings }
}
