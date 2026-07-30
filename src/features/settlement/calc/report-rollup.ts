import type { SettlementSource } from '../parse/types'
import type { ClosingVenueRow } from './closing'

/**
 * 경영 보고서 집계 (docs/systems/settlement.md §13-2 ①).
 *
 * 마감 스냅샷의 **식당 단위** 행을 유치원 단위·공급사 단위로 묶는다.
 * 순수 함수라 테스트로 고정할 수 있다.
 *
 * ⚠️ **정산제외 사업장은 매출이 아니다** — 계산서를 발행하지 않는다 (docs §13-4).
 * 다만 **매입은 그대로 센다.** 본사 마케팅비도 실제로 신세계에서 사온 물건이라,
 * 매입 통계에서 빼면 공급사 명세와 대조가 맞지 않는다.
 */

export interface KindergartenRollup {
  source: SettlementSource
  businessCode: string
  /** 원천 사업장명 (예: `키즈웰에듀푸드(해밀유치원)`) */
  businessName: string
  /** 계산서 상호 (예: `해밀유치원`). 없으면 null */
  companyName: string | null
  /** 화면에 쓰는 이름 — 상호가 있으면 그걸, 없으면 원천 사업장명 */
  label: string
  partnerName: string | null
  isExcluded: boolean
  exclusionReason: string | null
  restaurantCount: number

  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
  priceTaxableSupply: number
  priceExempt: number
  /** 차액 = 청구 − 매입 */
  margin: number
  /** 매출 대비 마진율 (0~1). 매출이 0이면 0 */
  marginRate: number
}

export function rollupByKindergarten(
  venues: readonly ClosingVenueRow[]
): KindergartenRollup[] {
  const map = new Map<string, KindergartenRollup>()

  for (const v of venues) {
    const key = `${v.source}:${v.businessCode}`
    let row = map.get(key)
    if (!row) {
      row = {
        source: v.source,
        businessCode: v.businessCode,
        businessName: v.businessName,
        companyName: v.companyName,
        label: v.companyName ?? v.businessName,
        // 사업장 = 유치원 1곳이므로 담당자는 하나다. 섞였다면 마스터 불정합이고
        // 마감 게이트에서 이미 걸렸어야 한다 — 보고서가 임의로 판단하지 않는다.
        partnerName: v.partnerName,
        isExcluded: v.isExcluded,
        exclusionReason: v.exclusionReason,
        restaurantCount: 0,
        costTotal: 0,
        costVat: 0,
        priceTotal: 0,
        priceVat: 0,
        priceTaxableSupply: 0,
        priceExempt: 0,
        margin: 0,
        marginRate: 0,
      }
      map.set(key, row)
    }
    row.restaurantCount += 1
    row.costTotal += v.cost.total
    row.costVat += v.cost.vat
    row.priceTotal += v.price.total
    row.priceVat += v.price.vat
    row.priceTaxableSupply += v.price.taxableSupply
    row.priceExempt += v.price.exempt
  }

  const rows = [...map.values()]
  for (const r of rows) {
    r.margin = r.priceTotal - r.costTotal
    // 0으로 나누지 않는다 — 그 달에 거래가 없던 유치원도 목록에 남는다
    r.marginRate = r.priceTotal === 0 ? 0 : r.margin / r.priceTotal
  }

  // 보고서는 큰 것부터 본다
  return rows.sort((a, b) => b.priceTotal - a.priceTotal)
}

export interface SourceRollup {
  costTotal: number
  priceTotal: number
  margin: number
  restaurantCount: number
  /** 정산제외 사업장의 매입 (마케팅비). 매출에는 안 들어가지만 매입은 실제다 */
  excludedCost: number
}

export type SourceRollups = Record<SettlementSource, SourceRollup>

export function rollupBySource(venues: readonly ClosingVenueRow[]): SourceRollups {
  const empty = (): SourceRollup => ({
    costTotal: 0,
    priceTotal: 0,
    margin: 0,
    restaurantCount: 0,
    excludedCost: 0,
  })
  // 두 원천을 항상 돌려준다 — 화면이 존재 여부를 분기하지 않게 한다
  const out: SourceRollups = { shinsegae: empty(), cj: empty() }

  for (const v of venues) {
    const r = out[v.source]
    r.restaurantCount += 1
    r.costTotal += v.cost.total
    if (v.isExcluded) {
      r.excludedCost += v.cost.total
      continue // 매출에는 넣지 않는다
    }
    r.priceTotal += v.price.total
  }

  for (const r of Object.values(out)) {
    r.margin = r.priceTotal - r.costTotal
  }
  return out
}
